/* Only an explicit panel test makes network calls; pages and configuration stay local. */
(function () {
  'use strict';
  const core = globalThis.QPCore;
  const origin = 'https://qlpush.com';
  const headers = {
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    'X-Frame-Options': 'DENY'
  };
  function send(code, body, type) {
    $done({ status: 'HTTP/1.1 ' + code + (code === 200 ? ' OK' : ' Error'), headers: { ...headers, 'Content-Type': (type || 'application/json') + '; charset=utf-8' }, body: type ? body : JSON.stringify(body) });
  }
  function load() { return core.profiles(JSON.parse($prefs.valueForKey(core.PROFILES_KEY) || '[]')); }
  function panel() {
    try { return core.panel(JSON.parse($prefs.valueForKey(core.PANEL_KEY) || 'null')); } catch (_) { return null; }
  }
  function panelStatus() {
    const saved = panel();
    return saved ? { url: saved.url, clientId: saved.clientId, hasSecret: true } : { url: '', clientId: '', hasSecret: false };
  }
  async function testPanel(saved) {
    class ConnectionError extends Error {}
    const deadline = Date.now() + 8000;
    async function get(path, token, stage) {
      let timer, response;
      try {
        response = await Promise.race([
          $task.fetch({ url: saved.url + '/open' + path, method: 'GET',
            headers: { Accept: 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
            opts: { redirection: false, 'skip-cert-verify': false, 'auto-cookie': false } }),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error()), Math.max(1, deadline - Date.now())); })
        ]);
      } catch (_) { throw new ConnectionError('连接失败或超时，请检查网络、HTTPS 证书与面板地址。'); }
      finally { clearTimeout(timer); }
      let data;
      try { data = JSON.parse(response.body); } catch (_) { throw new ConnectionError('面板响应格式无效，请检查地址是否指向青龙。'); }
      if (Number(response.statusCode) < 200 || Number(response.statusCode) >= 300 || !data || Number(data.code) !== 200) {
        throw new ConnectionError(stage === 'auth' ? '认证失败，请检查 Client ID、Client Secret 和应用状态。' : '环境变量接口访问失败，请检查应用的环境变量权限。');
      }
      return data.data;
    }
    try {
      const auth = await get('/auth/token?client_id=' + encodeURIComponent(saved.clientId) + '&client_secret=' + encodeURIComponent(saved.clientSecret), null, 'auth');
      if (!auth || typeof auth.token !== 'string' || !auth.token) return send(502, { error: '青龙未返回有效访问令牌。' });
      const envs = await get('/envs?searchValue=qinglong_pusher_connection_check', auth.token, 'envs');
      if (!Array.isArray(envs)) return send(502, { error: '环境变量接口响应格式不兼容。' });
      // Do not certify credentials changed by another local page during the request.
      if (JSON.stringify(panel()) !== JSON.stringify(saved)) return send(409, { error: '测试期间面板配置已改变，请重新测试。' });
      return send(200, { connected: true, checkedAt: new Date().toISOString(), message: '连接成功，认证与环境变量读取权限已验证；未验证写入权限。' });
    } catch (error) {
      // Errors from get() are authored locally; never return upstream bodies or credentials.
      return send(502, { error: error instanceof ConnectionError ? error.message : '连接测试失败，请检查配置后重试。' });
    }
  }
  try {
    const request = $request;
    const httpScript = /^http:\/\/qlpush\.com(\/scripts\/[a-z0-9][a-z0-9-]{7,47}\.js)$/.exec(request.url);
    if (!httpScript && !request.url.startsWith(origin + '/') && request.url !== origin) return send(400, { error: '无效的本地入口。' });
    const path = httpScript ? httpScript[1] : request.url.slice(origin.length) || '/';
    const method = request.method || 'GET';
    if (httpScript && method !== 'GET') return send(405, { error: '仅支持 GET。' });
    if (method === 'GET' && QP_ASSETS[path]) return send(200, QP_ASSETS[path][0], QP_ASSETS[path][1]);
    const script = /^\/scripts\/([a-z0-9][a-z0-9-]{7,47})\.js$/.exec(path);
    if (method === 'GET' && script) {
      const item = load().find(item => item.id === script[1]);
      return send(200, item ? core.profileScript(item, QP_CAPTURE_SOURCE) : '/*\n[rewrite_local]\n\n[MITM]\n*/\n$done({});\n', 'text/javascript');
    }
    if (method === 'GET' && path === '/api/status') {
      const profiles = load().map(item => {
        let last = null;
        try { last = JSON.parse($prefs.valueForKey('qinglong_pusher_last_result_' + item.id) || 'null'); } catch (_) {}
        return { ...item, last };
      });
      return send(200, { mode: 'device', configured: !!panel(), panel: panelStatus(), profiles });
    }
    const subscription = /^\/profiles\/([a-z0-9][a-z0-9-]{7,47})\.conf$/.exec(path);
    if (method === 'GET' && subscription) {
      const item = load().find(item => item.id === subscription[1]);
      // An empty resource clears deleted profiles on the next QX refresh.
      return send(200, item ? core.profileLinks(item, QP_BASE).conf : '# qinglong-pusher | profile removed\n', 'text/plain');
    }
    const removal = /^\/api\/profiles\/([a-z0-9][a-z0-9-]{7,47})\/delete$/.exec(path);
    if (method === 'POST' && (path === '/api/preview' || path === '/api/profiles' || removal || path === '/api/panel' || path === '/api/panel/delete' || path === '/api/panel/test')) {
      const incoming = {};
      Object.keys(request.headers || {}).forEach(key => { incoming[key.toLowerCase()] = request.headers[key]; });
      // Custom header prevents cross-origin simple requests; never serve CORS/preflight.
      if (incoming.origin !== origin || incoming['x-qp-local'] !== '1' || !/^application\/json(?:\s*;|$)/i.test(incoming['content-type'] || '')) return send(403, { error: '请从本地控制台保存。' });
      if (typeof request.body !== 'string' || request.body.length > 8192) return send(400, { error: '请求体无效或过大。' });
      const body = JSON.parse(request.body);
      if (path === '/api/panel/test') {
        if (!body || Array.isArray(body) || Object.keys(body).length) return send(400, { error: '测试请求应为空对象，先保存面板配置。' });
        const saved = panel();
        if (!saved) return send(400, { error: '请先保存有效的青龙面板配置。' });
        return testPanel(saved);
      }
      if (path === '/api/panel/delete') {
        if (!body || Array.isArray(body) || Object.keys(body).length) return send(400, { error: '删除请求应为空对象。' });
        if (!$prefs.setValueForKey('', core.PANEL_KEY)) return send(500, { error: '本机清除失败。' });
        return send(200, { panel: panelStatus() });
      }
      if (path === '/api/panel') {
        let saved;
        try { saved = core.panel(body, panel()); } catch (error) { return send(400, { error: error.message }); }
        if (!$prefs.setValueForKey(JSON.stringify(saved), core.PANEL_KEY)) return send(500, { error: '本机保存失败。' });
        return send(200, { panel: panelStatus() });
      }
      const current = load();
      if (removal) {
        if (!body || Object.keys(body).length) return send(400, { error: '删除请求应为空对象。' });
        if (!$prefs.setValueForKey(JSON.stringify(current.filter(item => item.id !== removal[1])), core.PROFILES_KEY)) return send(500, { error: 'QX 本地保存失败。' });
        $prefs.removeValueForKey('qinglong_pusher_last_result_' + removal[1]);
        return send(200, { deleted: removal[1] });
      }
      let item, next;
      try { item = core.profile(body); next = core.profiles([...current.filter(other => other.id !== item.id), item]); }
      catch (error) { return send(400, { error: error.message }); }
      if (path !== '/api/preview' && !$prefs.setValueForKey(JSON.stringify(next), core.PROFILES_KEY)) return send(500, { error: 'QX 本地保存失败，未生成导入结果。' });
      return send(200, { ...core.profileLinks(item, QP_BASE), js: QP_CAPTURE_SOURCE, saved: path !== '/api/preview' });
    }
    return send(404, { error: '本地资源不存在。' });
  } catch (_) { return send(400, { error: '配置无效，请检查规则；本地数据不会自动覆盖。' }); }
})();
