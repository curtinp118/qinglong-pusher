/* Only the QX runtime handles captured headers. Nothing is sent to the asset server. */
(function () {
  'use strict';
  class SafeError extends Error {}
  const core = globalThis.QPCore;
  let LEASE, STATUS;
  const owner = Date.now() + ':' + Math.random();
  const started = Date.now();
  const runId = started.toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  const totals = { created: 0, updated: 0, unchanged: 0 };
  let appId = null, stage = 'configuration', outcome = 'running';
  function log(event, details = {}) {
    try { console.log('[qinglong-pusher] ' + JSON.stringify({ run: runId, app: appId, event, elapsedMs: Date.now() - started, ...details })); } catch (_) {}
  }
  function skip(reason) { outcome = 'skipped'; log('skip', { reason }); }
  let acquired = false;
  let timer;
  const deadline = Date.now() + 10000;
  const remaining = () => Math.max(1, deadline - Date.now());
  async function run() {
    log('start');
    const profiles = core.profiles(JSON.parse($prefs.valueForKey(core.PROFILES_KEY) || '[]'));
    const matches = profiles.filter(item => item.rules.some(rule => rule.enabled && new RegExp(core.pattern(rule.url).regex).test($request.url || '')));
    const sourcePath = typeof $environment !== 'undefined' ? $environment.sourcePath || '' : '';
    const fragment = sourcePath.split('#').slice(1).join('#');
    const binding = /(?:^|&)qp=([^&]*)/.exec(fragment);
    const id = typeof QP_PROFILE_ID !== 'undefined' ? QP_PROFILE_ID : binding ? binding[1] : null;
    // A missing/deleted explicit binding must never run another App's rules.
    const config = id !== null ? profiles.find(item => item.id === id) : matches.length === 1 ? matches[0] : null;
    if (!config) return skip(id !== null ? 'bound_app_missing' : matches.length ? 'ambiguous_match' : 'no_matching_app');
    appId = config.id;
    log('app_selected', { binding: id !== null ? 'explicit' : 'url_match' });
    LEASE = 'qinglong_pusher_lease_' + config.id;
    STATUS = 'qinglong_pusher_last_result_' + config.id;
    const rules = config.rules.filter(rule => rule.enabled && new RegExp(core.pattern(rule.url).regex).test($request.url || ''));
    log('rules_matched', { count: rules.length });
    if (!rules.length) return skip('no_enabled_matching_rule');
    stage = 'panel_configuration';
    let credentials;
    try { credentials = core.panel(JSON.parse($prefs.valueForKey(core.PANEL_KEY) || 'null')); }
    catch (_) { throw new SafeError('请先在控制台设置中配置 HTTPS 青龙地址及应用凭据。'); }
    const base = credentials.url;
    const panel = /^(https:\/\/([a-z0-9.-]+)(?::[0-9]{1,5})?)(\/[^\s?#]*)?$/i.exec(base);
    if (($request.url || '').toLowerCase().startsWith(panel[1].toLowerCase() + '/')) return skip('panel_request');
    const requestHeaders = $request.headers || {};
    const values = rules.map(rule => {
      if (rule.headerMode === 'all') {
        const entries = Object.entries(requestHeaders).filter(([, value]) => typeof value === 'string');
        return { rule, value: entries.length ? JSON.stringify(Object.fromEntries(entries)) : '' };
      }
      const key = Object.keys(requestHeaders).find(key => key.toLowerCase() === rule.header);
      return { rule, value: requestHeaders[key] };
    }).filter(item => typeof item.value === 'string' && item.value.trim());
    log('headers_selected', { ready: values.length, missing: rules.length - values.length });
    if (!values.length) return skip('missing_or_empty_headers');
    stage = 'lease';
    let lease;
    try { lease = JSON.parse($prefs.valueForKey(LEASE) || 'null'); } catch (_) { /* Ignore expired/corrupt leases. */ }
    if (lease && lease.until > Date.now() && lease.until < Date.now() + 20000) return skip('active_lease');
    // QX has no compare-and-swap: this lease only reduces duplicate concurrent writes.
    if (!$prefs.setValueForKey(JSON.stringify({ owner, until: Date.now() + 15000 }), LEASE)) throw new SafeError('无法获取本地同步锁。');
    acquired = true;
    log('lease_acquired');
    async function api(method, path, token, body) {
      stage = path.startsWith('/auth/token') ? 'auth' : method === 'GET' ? 'env_lookup' : method === 'POST' ? 'env_create' : 'env_update';
      const requestStarted = Date.now();
      log('api_start', { stage, method });
      if (Date.now() >= deadline) throw new SafeError('同步超时，请稍后重新打开目标 App。');
      let response;
      let timeout;
      try {
        response = await Promise.race([
          $task.fetch({ url: base + '/open' + path, method, headers: { Accept: 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), opts: { redirection: false, 'skip-cert-verify': false, 'auto-cookie': false } }),
          new Promise((_, reject) => { timeout = setTimeout(() => reject(new SafeError('青龙请求超时。')), remaining()); })
        ]);
      } catch (_) { log('api_failed', { stage, reason: 'network_or_timeout', durationMs: Date.now() - requestStarted }); throw new SafeError('青龙连接失败或超时，请检查网络与证书。'); }
      finally { clearTimeout(timeout); }
      let data;
      try { data = JSON.parse(response.body); } catch (_) { log('api_failed', { stage, reason: 'invalid_json' }); throw new SafeError('青龙响应格式无效。'); }
      log('api_response', { stage, httpStatus: Number(response.statusCode) || null, code: Number(data?.code) || null, durationMs: Date.now() - requestStarted });
      if (Number(response.statusCode) < 200 || Number(response.statusCode) >= 300 || Number(data.code) !== 200) throw new SafeError('青龙拒绝请求，请检查应用凭据和环境变量权限。');
      return data.data;
    }
    const auth = await api('GET', '/auth/token?client_id=' + encodeURIComponent(credentials.clientId) + '&client_secret=' + encodeURIComponent(credentials.clientSecret));
    if (!auth || typeof auth.token !== 'string' || !auth.token) throw new SafeError('青龙未返回有效令牌。');
    const written = [];
    let lastResult;
    for (const { rule, value } of values) {
      log('variable_start', { variable: rule.name, mode: rule.headerMode === 'all' ? 'all_headers' : 'single_header' });
      const envs = await api('GET', '/envs?searchValue=' + encodeURIComponent(rule.name), auth.token);
      if (!Array.isArray(envs)) throw new SafeError('青龙变量列表格式无效。');
      const matches = envs.filter(env => env && env.name === rule.name);
      if (matches.length > 1) throw new SafeError('存在同名多账号变量，已停止覆盖。');
      const env = matches[0];
      let action = 'unchanged';
      if (!env || env.value !== value) {
        const payload = { name: rule.name, value };
        if (env) {
          if (env.id == null && env._id == null) throw new SafeError('青龙变量缺少 ID，已停止覆盖。');
          if (env.id != null) payload.id = env.id; else payload._id = env._id;
          if (env.remarks !== undefined) payload.remarks = env.remarks;
          if (env.labels !== undefined) payload.labels = env.labels;
        }
        await api(env ? 'PUT' : 'POST', '/envs', auth.token, env ? payload : [payload]);
        action = env ? 'updated' : 'created';
        written.push((env ? '更新：' : '新增：') + rule.name);
      }
      totals[action]++;
      log('variable_result', { variable: rule.name, action });
      lastResult = { name: rule.name, action, time: new Date().toISOString(), ...(written.length ? { notification: 'pending' } : {}) };
      $prefs.setValueForKey(JSON.stringify(lastResult), STATUS);
    }
    if (written.length) {
      // Notify once only after the whole batch succeeds; never include captured values.
      let notification = 'failed';
      try {
        $notify('qinglong-pusher', config.title + ' · 推送成功', written.join('\n'));
        notification = 'requested';
      } catch (_) { /* A confirmed write stays successful even if notification fails. */ }
      // QX provides no delivery receipt: requested does not mean iOS displayed a banner.
      try { $prefs.setValueForKey(JSON.stringify({ ...lastResult, notification }), STATUS); } catch (_) {}
      log('notification', { result: notification });
    }
    outcome = written.length ? 'success' : 'unchanged';
  }
  const work = run().catch(error => {
    // Error messages are locally authored. Never log upstream bodies, headers or credentials.
    const safe = error instanceof SafeError ? error.message : '本地配置无效，请重新保存。';
    outcome = 'error';
    log('error', { stage, message: safe, ...totals });
    try { if (STATUS) $prefs.setValueForKey(JSON.stringify({ action: 'error', message: safe, time: new Date().toISOString() }), STATUS); } catch (_) {}
    try { $notify('qinglong-pusher', '同步未完成', safe); log('notification', { result: 'requested', type: 'error' }); }
    catch (_) { log('notification', { result: 'failed', type: 'error' }); }
  });
  Promise.race([work, new Promise(resolve => { timer = setTimeout(resolve, remaining() + 250); })]).finally(() => {
    clearTimeout(timer);
    if (acquired) {
      try {
        if (JSON.parse($prefs.valueForKey(LEASE) || 'null')?.owner === owner) log('lease_release', { removed: $prefs.removeValueForKey(LEASE) !== false });
        else log('lease_release', { reason: 'owner_changed' });
      } catch (_) { log('lease_release', { reason: 'storage_error' }); }
    }
    log('finish', { outcome: outcome === 'running' ? 'deadline_exceeded' : outcome, ...totals });
    $done({});
  });
})();
