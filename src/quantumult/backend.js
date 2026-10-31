/* QX http_backend: serve generated scripts only, never panel or status APIs. */
(function () {
  'use strict';
  const send = (status, body) => $done({ status: 'HTTP/1.1 ' + status, headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' }, body });
  try {
    const match = /^http:\/\/(?:127\.0\.0\.1|localhost|quantumult-x):9999\/qinglong-pusher\/scripts\/([a-z0-9][a-z0-9-]{7,47})\.js$/.exec($request.url);
    if (!match || ($request.method && $request.method !== 'GET')) return send('404 Not Found', '// Not found');
    const core = globalThis.QPCore;
    const profiles = core.profiles(JSON.parse($prefs.valueForKey(core.PROFILES_KEY) || '[]'));
    const item = profiles.find(item => item.id === match[1]);
    return send('200 OK', item ? core.profileScript(item, QP_CAPTURE_SOURCE) : '/*\n[rewrite_local]\n\n[MITM]\n*/\n$done({});\n');
  } catch (_) { return send('400 Bad Request', '// Invalid local configuration'); }
})();
