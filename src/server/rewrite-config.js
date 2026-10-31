import '../shared/core.js';
export const { normalize, pattern, generate, importURL, profile, profiles, profileLinks } = globalThis.QPCore;
export const LOCAL_ORIGIN = 'https://qlpush.com';
export function links(input, baseURL) {
  return profileLinks(input, baseURL);
}
export function bootstrap(baseURL) {
  return '# qinglong-pusher | local console\n' +
    '# Enable Rewrite and MitM, then open https://qlpush.com/\n' +
    '# Merge [http_backend] into the QX main configuration if a rewrite reference does not load it.\n' +
    '[rewrite_local]\n' +
    '^http://qlpush\\.com(?:/.*)?$ url 302 https://qlpush.com/\n' +
    '^https://qlpush\\.com/api/(?:preview|profiles(?:/[a-z0-9-]+/delete)?|panel(?:/(?:delete|test))?)$ url script-analyze-echo-response ' + baseURL + '/qx/local.js\n' +
    '^https://qlpush\\.com(?:/.*)?$ url script-echo-response ' + baseURL + '/qx/local.js\n\n' +
    '[mitm]\nhostname = qlpush.com\n\n' +
    '[http_backend]\n' + baseURL + '/qx/backend.js, tag=qinglong-pusher, path=^/qinglong-pusher/scripts/, enabled=true\n';
}
