/* Shared by Node, the browser, and Quantumult X (no browser-only APIs). */
(function (root) {
  'use strict';
  const CONFIG_KEY = 'qinglong_pusher_config_v1';
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function exactKeys(value, allowed) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) {
      throw new Error('配置字段无效，请勿提交凭据。');
    }
  }
  function pattern(value) {
    if (typeof value === 'string' && value.startsWith('^')) return regexPattern(value);
    if (typeof value !== 'string' || value.length > 300 || /[^\x21-\x7e]|[\\,?#]/.test(value)) throw new Error('URL 不允许查询参数、片段、空白或凭据；路径支持 *。');
    const match = /^(https?):\/\/([a-z0-9.-]+)(?::([0-9]{1,5}))?(\/[^\s]*)$/.exec(value);
    if (!match) throw new Error('请填写完整的小写 http(s) 域名和路径，不支持域名通配。');
    const [, scheme, host, port] = match;
    if (host === 'qlpush.com' || host.endsWith('.qlpush.com')) throw new Error('不能抓取本地控制台域名。');
    if (host.length > 253 || host.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) || (port && (!/^[1-9][0-9]*$/.test(port) || +port > 65535))) throw new Error('域名或端口无效。');
    if (/^[0-9.]+$/.test(host) && (host.split('.').length !== 4 || host.split('.').some(part => !/^(0|[1-9][0-9]{0,2})$/.test(part) || +part > 255))) throw new Error('请使用规范 IPv4 地址。');
    if (/^0x/i.test(host) || host.split('.').some(part => /^0x/i.test(part))) throw new Error('请使用规范域名。');
    return { scheme, host, regex: '^' + value.split('*').map(escape).join('.*') + '$' };
  }
  function regexPattern(value) {
    if (value.length > 500 || /[^\x21-\x7e]/.test(value)) throw new Error('正则最多 500 字符，不能包含空白或换行。');
    // Fixed authority makes MitM extraction reliable; the path remains a regex.
    const text = value.replace(/\\\//g, '/');
    const match = /^\^(https\?|https|http):\/\/((?:[a-z0-9-]|\\\.)+)(?::([0-9]{1,5}))?\/(.*)$/.exec(text);
    if (!match) throw new Error('正则须以 ^http://、^https:// 或 ^https?:// 开头，域名中的点使用 \\.，并包含路径。');
    const [, protocol, escapedHost, port, path] = match;
    if (/^[*+?{]/.test(path)) throw new Error('域名后的路径分隔符 / 不能使用量词。');
    const host = escapedHost.replace(/\\\./g, '.');
    pattern('https://' + host + (port ? ':' + port : '') + '/');
    // Reject scope escapes and high-risk constructs rather than evaluating arbitrary patterns.
    let depth = 0, inClass = false;
    for (let i = 0; i < path.length; i++) {
      const char = path[i];
      if (char === '\\') {
        if (/[1-9k]/.test(path[i + 1] || '')) throw new Error('不支持反向引用。');
        i++; continue;
      }
      if (char === '[' && !inClass) { inClass = true; continue; }
      if (char === ']' && inClass) { inClass = false; continue; }
      if (inClass) continue;
      if (char === '(') {
        if (path[i + 1] === '?' && path[i + 2] !== ':') throw new Error('不支持环视或内联标志。');
        depth++;
      }
      if (char === ')') {
        depth--;
        if (/[*+{]/.test(path[i + 1] || '')) throw new Error('支持分组后 ?（可选），暂不支持分组后 *、+ 或 {n} 重复量词。');
      }
      if (char === '|' && depth === 0) throw new Error('路径中的分支请放入 (?:a|b)，不能在顶层使用 |。');
    }
    try { new RegExp(value); } catch (_) { throw new Error('正则表达式语法无效。'); }
    return { scheme: protocol === 'http' ? 'http' : 'https', host, regex: value };
  }
  function normalize(input) {
    exactKeys(input, ['rules']);
    if (!Array.isArray(input.rules) || input.rules.length > 10) throw new Error('最多配置 10 个变量。');
    const names = new Set();
    return { rules: input.rules.map(rule => {
      exactKeys(rule, ['name', 'url', 'header', 'headerMode', 'enabled']);
      if (typeof rule.name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(rule.name)) throw new Error('变量名须以字母或下划线开头，最多 64 个字符。');
      if (names.has(rule.name)) throw new Error('变量名不能重复；暂不支持同名多账号。');
      names.add(rule.name);
      pattern(rule.url);
      const headerMode = rule.headerMode === undefined ? 'single' : rule.headerMode;
      if (!['single', 'all'].includes(headerMode)) throw new Error('请求头保存方式无效。');
      if (headerMode === 'single' && (typeof rule.header !== 'string' || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,64}$/.test(rule.header))) throw new Error('请填写单个有效请求头名。');
      if (typeof rule.enabled !== 'boolean') throw new Error('启用状态无效。');
      return { name: rule.name, url: rule.url, header: headerMode === 'all' ? '' : rule.header.toLowerCase(), ...(headerMode === 'all' ? { headerMode } : {}), enabled: rule.enabled };
    }) };
  }
  function generate(input, scriptURL) {
    const rules = normalize(input).rules.filter(rule => rule.enabled);
    const hosts = [...new Set(rules.map(rule => pattern(rule.url)).filter(item => item.scheme === 'https').map(item => item.host))];
    return '# qinglong-pusher | device-local rules\n# Refresh this resource after changing URL patterns.\n' +
      (hosts.length ? 'hostname = ' + hosts.join(', ') + '\n\n' : '\n') +
      [...new Set(rules.map(rule => pattern(rule.url).regex))].map(regex => regex + ' url script-request-header ' + scriptURL).join('\n') + '\n';
  }
  function importURL(url, tag) {
    return 'https://quantumult.app/x/open-app/add-resource?remote-resource=' + encodeURIComponent(JSON.stringify({ rewrite_remote: [url + ', tag=' + tag + ', opt-parser=true, enabled=true'] }));
  }
  const PROFILES_KEY = 'qinglong_pusher_profiles_v2';
  function profile(input) {
    exactKeys(input, ['id', 'title', 'rules']);
    if (typeof input.id !== 'string' || !/^[a-z0-9][a-z0-9-]{7,47}$/.test(input.id)) throw new Error('App 配置 ID 无效。');
    if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 40 || /[\x00-\x1f\x7f]/.test(input.title)) throw new Error('请填写 1–40 字的 App 名称。');
    return { id: input.id, title: input.title.trim(), ...normalize({ rules: input.rules }) };
  }
  function literalPrefix(regex) {
    let prefix = '';
    for (let i = 1; i < regex.length; i++) {
      const char = regex[i];
      if (char === '\\') {
        if (!/[/.\-_:]/.test(regex[i + 1] || '')) break;
        prefix += regex[++i]; continue;
      }
      if ('*?{'.includes(char)) { prefix = prefix.slice(0, -1); break; }
      if ('.+()[|$'.includes(char)) break;
      prefix += char;
    }
    return prefix;
  }
  // Only prove disjointness from fixed hosts/prefixes; general regex intersection is not attempted.
  function overlaps(a, b) {
    const left = pattern(a), right = pattern(b);
    if (left.host !== right.host) return false;
    const x = literalPrefix(left.regex), y = literalPrefix(right.regex);
    return x.startsWith(y) || y.startsWith(x);
  }
  function profiles(input) {
    if (!Array.isArray(input) || input.length > 20) throw new Error('最多添加 20 个 App 配置。');
    const result = input.map(profile);
    if (new Set(result.map(item => item.id)).size !== result.length) throw new Error('App 配置 ID 重复。');
    for (let i = 0; i < result.length; i++) for (let j = i + 1; j < result.length; j++) {
      for (const a of result[i].rules) for (const b of result[j].rules) {
        if (a.name === b.name) throw new Error('不同 App 不能使用相同青龙变量名，避免互相覆盖。');
        if (overlaps(a.url, b.url)) throw new Error('不同 App 的正则可能重叠，请使用不同域名或明确的不同路径前缀；无法证明独立时拒绝保存。');
      }
    }
    return result;
  }
  function profileLinks(input, base) {
    const item = profile(input), subscriptionUrl = 'http://127.0.0.1:9999/qinglong-pusher/scripts/' + item.id + '.js';
    return { profile: item, subscriptionUrl, importUrl: importURL(subscriptionUrl, item.title), conf: '# App ID: ' + item.id + '\n' + generate({ rules: item.rules }, subscriptionUrl) };
  }
  function profileScript(input, source) {
    const item = profile(input), url = profileLinks(item).subscriptionUrl;
    const rules = item.rules.filter(rule => rule.enabled);
    const hosts = [...new Set(rules.map(rule => pattern(rule.url)).filter(value => value.scheme === 'https').map(value => value.host))];
    // Escape comment terminators without changing the regex matched by QX.
    const rewrites = [...new Set(rules.map(rule => pattern(rule.url).regex))]
      .map(regex => regex.replace(/\*\//g, '*\\/') + ' url script-request-header ' + url);
    return '/*\n' + item.title.replace(/\*\//g, '* /') + '\nApp ID: ' + item.id +
      '\n\n[rewrite_local]\n' + rewrites.join('\n') + '\n\n[MITM]\n' +
      (hosts.length ? 'hostname = ' + hosts.join(', ') + '\n' : '') +
      '*/\n\n' + captureScript(item.id, source);
  }
  function captureScript(id, source) {
    if (!/^[a-z0-9][a-z0-9-]{7,47}$/.test(id)) throw new Error('App 配置 ID 无效。');
    return 'const QP_PROFILE_ID = ' + JSON.stringify(id) + ';\n' + source;
  }
  const PANEL_KEY = 'qinglong_pusher_panel_v1';
  function panel(input, previous) {
    exactKeys(input, ['url', 'clientId', 'clientSecret']);
    if (typeof input.url !== 'string') throw new Error('请填写 HTTPS 青龙地址。');
    const url = input.url.trim().replace(/\/+$/, '').replace(/\/open$/, '');
    const match = /^https:\/\/([a-z0-9.-]+)(?::([1-9][0-9]{0,4}))?(\/[a-zA-Z0-9_/-]*)?$/.exec(url);
    if (!match || (match[2] && +match[2] > 65535) || match[1].length > 253 || match[1].split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) || match[1] === 'qlpush.com' || match[1].endsWith('.qlpush.com') || url.includes('/../') || url.length > 500) throw new Error('请使用有效 HTTPS 青龙地址，不含凭据、查询参数或控制台域名。');
    if (typeof input.clientId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(input.clientId)) throw new Error('请填写有效 Client ID。');
    if (typeof input.clientSecret !== 'string') throw new Error('请填写 Client Secret。');
    const secret = input.clientSecret || (previous && previous.url === url && previous.clientId === input.clientId ? previous.clientSecret : '');
    if (!secret || secret.length > 512 || /[\s\x00-\x1f\x7f]/.test(secret)) throw new Error('首次配置或更改地址、Client ID 时必须填写 Client Secret。');
    return { url, clientId: input.clientId, clientSecret: secret };
  }
  root.QPCore = { CONFIG_KEY, PROFILES_KEY, PANEL_KEY, panel, normalize, pattern, generate, importURL, profile, profiles, overlaps, profileLinks, profileScript, captureScript };
})(globalThis);

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
