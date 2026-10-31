/* Only the QX runtime handles captured headers. Nothing is sent to the asset server. */
(function () {
  'use strict';
  class SafeError extends Error {}
  const core = globalThis.QPCore;
  let LEASE, STATUS;
  const owner = Date.now() + ':' + Math.random();
  let acquired = false;
  let timer;
  const deadline = Date.now() + 10000;
  const remaining = () => Math.max(1, deadline - Date.now());
  async function run() {
    const profiles = core.profiles(JSON.parse($prefs.valueForKey(core.PROFILES_KEY) || '[]'));
    const matches = profiles.filter(item => item.rules.some(rule => rule.enabled && new RegExp(core.pattern(rule.url).regex).test($request.url || '')));
    // Static download cannot carry a device-generated ID. Fail closed unless one App matches.
    const config = typeof QP_PROFILE_ID !== 'undefined' ? profiles.find(item => item.id === QP_PROFILE_ID) : matches.length === 1 ? matches[0] : null;
    if (!config) return;
    LEASE = 'qinglong_pusher_lease_' + config.id;
    STATUS = 'qinglong_pusher_last_result_' + config.id;
    const rules = config.rules.filter(rule => rule.enabled && new RegExp(core.pattern(rule.url).regex).test($request.url || ''));
    if (!rules.length) return;
    let credentials;
    try { credentials = core.panel(JSON.parse($prefs.valueForKey(core.PANEL_KEY) || 'null')); }
    catch (_) { throw new SafeError('请先在控制台设置中配置 HTTPS 青龙地址及应用凭据。'); }
    const base = credentials.url;
    const panel = /^(https:\/\/([a-z0-9.-]+)(?::[0-9]{1,5})?)(\/[^\s?#]*)?$/i.exec(base);
    if (($request.url || '').toLowerCase().startsWith(panel[1].toLowerCase() + '/')) return;
    const requestHeaders = $request.headers || {};
    const values = rules.map(rule => {
      if (rule.headerMode === 'all') {
        const entries = Object.entries(requestHeaders).filter(([, value]) => typeof value === 'string');
        return { rule, value: entries.length ? JSON.stringify(Object.fromEntries(entries)) : '' };
      }
      const key = Object.keys(requestHeaders).find(key => key.toLowerCase() === rule.header);
      return { rule, value: requestHeaders[key] };
    }).filter(item => typeof item.value === 'string' && item.value.trim());
    if (!values.length) return;
    let lease;
    try { lease = JSON.parse($prefs.valueForKey(LEASE) || 'null'); } catch (_) { /* Ignore expired/corrupt leases. */ }
    if (lease && lease.until > Date.now() && lease.until < Date.now() + 20000) return;
    // QX has no compare-and-swap: this lease only reduces duplicate concurrent writes.
    if (!$prefs.setValueForKey(JSON.stringify({ owner, until: Date.now() + 15000 }), LEASE)) throw new SafeError('无法获取本地同步锁。');
    acquired = true;
    async function api(method, path, token, body) {
      if (Date.now() >= deadline) throw new SafeError('同步超时，请稍后重新打开目标 App。');
      let response;
      let timeout;
      try {
        response = await Promise.race([
          $task.fetch({ url: base + '/open' + path, method, headers: { Accept: 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), opts: { redirection: false, 'skip-cert-verify': false, 'auto-cookie': false } }),
          new Promise((_, reject) => { timeout = setTimeout(() => reject(new SafeError('青龙请求超时。')), remaining()); })
        ]);
      } catch (_) { throw new SafeError('青龙连接失败或超时，请检查网络与证书。'); }
      finally { clearTimeout(timeout); }
      let data;
      try { data = JSON.parse(response.body); } catch (_) { throw new SafeError('青龙响应格式无效。'); }
      if (Number(response.statusCode) < 200 || Number(response.statusCode) >= 300 || Number(data.code) !== 200) throw new SafeError('青龙拒绝请求，请检查应用凭据和环境变量权限。');
      return data.data;
    }
    const auth = await api('GET', '/auth/token?client_id=' + encodeURIComponent(credentials.clientId) + '&client_secret=' + encodeURIComponent(credentials.clientSecret));
    if (!auth || typeof auth.token !== 'string' || !auth.token) throw new SafeError('青龙未返回有效令牌。');
    for (const { rule, value } of values) {
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
      }
      $prefs.setValueForKey(JSON.stringify({ name: rule.name, action, time: new Date().toISOString() }), STATUS);
    }
  }
  const work = run().catch(error => {
    // Error messages are locally authored. Never log upstream bodies, headers or credentials.
    const safe = error instanceof SafeError ? error.message : '本地配置无效，请重新保存。';
    if (STATUS) $prefs.setValueForKey(JSON.stringify({ action: 'error', message: safe, time: new Date().toISOString() }), STATUS);
    $notify('qinglong-pusher', '同步未完成', safe);
  });
  Promise.race([work, new Promise(resolve => { timer = setTimeout(resolve, remaining() + 250); })]).finally(() => {
    clearTimeout(timer);
    if (acquired) {
      try { if (JSON.parse($prefs.valueForKey(LEASE) || 'null')?.owner === owner) $prefs.removeValueForKey(LEASE); } catch (_) { /* Lease will expire. */ }
    }
    $done({});
  });
})();
