import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, generate, links, bootstrap } from '../src/server/rewrite-config.js';
import { createServer, validateBase } from '../src/server/dev-server.js';
const rule = { name: 'MY_TOKEN', url: 'https://api.example.com/user/*', header: 'Cookie', enabled: true };
const input = { rules: [rule] };
test('validates mappings, deduplicates hosts and anchors escaped URL patterns', () => {
  assert.equal(normalize(input).rules[0].header, 'cookie');
  const conf = generate(input, 'https://assets.example/qx/capture/app-first.js');
  assert.ok(conf.includes('hostname = api.example.com\n'));
  assert.ok(conf.includes('^https://api\\.example\\.com/user/.*$ url script-request-header'));
  assert.ok(!generate({ rules: [{ ...rule, enabled: false }] }, 'x').includes('hostname'));
  assert.equal(normalize({ rules: [] }).rules.length, 0);
  assert.equal(generate({ rules: [rule, { ...rule, name: 'OTHER' }] }, 'x').split('url script-request-header').length, 2);
});
test('rejects unsafe patterns, secret fields, duplicate variables and invalid headers', () => {
  for (const url of ['https://*.com/*', 'https://user:pass@host/a', 'https://host/a?token=x', 'https://host/#x', 'https://host/a,b', 'https://host/a\nhostname = *', 'https://host:99999/a', 'ftp://host/a', 'https://host\\evil/a', 'https://-host/a', 'https://HOST/a', 'http://127.1/a', 'http://0177.0.0.1/a', 'https://qlpush.com/a', 'https://a.qlpush.com/a', 'https://host']) assert.throws(() => normalize({ rules: [{ ...rule, url }] }), undefined, url);
  for (const data of [{ rules: Array(11).fill(rule) }, { rules: [rule, rule] }, { rules: [{ ...rule, header: 'cookie\nx' }] }, { rules: [{ ...rule, name: 'BAD NAME' }] }, { rules: [{ ...rule, enabled: 'true' }] }, { rules: [rule], secret: 'x' }, { urls: [] }, null]) assert.throws(() => normalize(data));
});
test('stable local subscription and separate bootstrap with request-body handling', () => {
  const data = links({ id: 'app-first', title: 'First', ...input }, 'https://assets.example');
  assert.equal(data.subscriptionUrl, 'https://qlpush.com/scripts/app-first.js');
  assert.deepEqual(JSON.parse(new URL(data.importUrl).searchParams.get('remote-resource')).rewrite_remote, ['https://qlpush.com/scripts/app-first.js, tag=First, opt-parser=true, enabled=true']);
  const conf = bootstrap('https://assets.example');
  assert.ok(conf.indexOf('script-analyze-echo-response') < conf.indexOf(' url script-echo-response'));
  assert.ok(conf.includes('hostname = qlpush.com'));
  assert.ok(!conf.includes('boxjs-scripts'));
});
test('base origin validation', () => {
  for (const base of ['https://user:pass@host', 'https://host/path', 'https://host/?x=1', 'file:///', 'https://a,b.com']) assert.throws(() => validateBase(base));
});
test('import uses the current app name and enables the resource parser without changing its subscription', () => {
  const original = links({ id: 'app-first', title: 'First', ...input });
  for (const title of ['成都地铁', 'Metro App', '地铁 & 出行']) {
    const renamed = links({ id: 'app-first', title, ...input });
    assert.equal(renamed.subscriptionUrl, original.subscriptionUrl);
    assert.deepEqual(JSON.parse(new URL(renamed.importUrl).searchParams.get('remote-resource')).rewrite_remote,
      [original.subscriptionUrl + ', tag=' + title + ', opt-parser=true, enabled=true']);
  }
});
async function withServer(fn, options) {
  const server = await createServer({ baseURL: 'https://assets.example', ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
test('HTTP assets, standalone bundles, preview and no persistence', async () => withServer(async base => {
  for (const route of ['/', '/app.js', '/style.css', '/core.js', '/healthz', '/qinglong-pusher.conf', '/qx/local.js', '/qx/capture/app-first.js']) assert.equal((await fetch(base + route)).status, 200, route);
  const script = await (await fetch(base + '/qx/local.js')).text();
  assert.ok(script.includes('QP_ASSETS'));
  assert.ok(script.includes('我的应用'));
  assert.ok(script.includes('result-dialog'));
  const response = await fetch(base + '/api/profiles', { method: 'POST', headers: { 'content-type': 'application/json', host: 'evil.example' }, body: JSON.stringify({ id: 'app-first', title: 'First', ...input }) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  const data = await response.json();
  assert.equal(data.preview, true);
  assert.equal(data.js, globalThis.QPCore.profileScript(data.profile, await (await fetch(base + '/qx/capture.js')).text()));
  assert.ok(!data.js.startsWith('const QP_PROFILE_ID'));
  assert.ok(data.conf.includes('https://qlpush.com/scripts/app-first.js'));
  assert.deepEqual((await (await fetch(base + '/api/status')).json()).profiles, []);
  assert.equal((await fetch(base + '/rewrite.conf')).status, 404);
  assert.equal((await fetch(base + '/api/panel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 404);
}));
test('rejects cross-site, invalid JSON, oversized and non-JSON requests', async () => withServer(async base => {
  const post = (body, headers) => fetch(base + '/api/profiles', { method: 'POST', headers, body });
  assert.equal((await post('{}', { 'content-type': 'application/json', origin: 'https://evil.example' })).status, 403);
  assert.equal((await post('{}', { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await post('{', { 'content-type': 'application/json' })).status, 400);
  assert.equal((await post('a'.repeat(9000), { 'content-type': 'application/json' })).status, 413);
}));
test('rate limiting', async () => withServer(async base => {
  assert.equal((await fetch(base + '/missing')).status, 404);
  assert.equal((await fetch(base + '/missing')).status, 429);
}, { rateLimit: 1 }));
test('glob intersection detects collisions but allows distinct paths on same host', () => {
  const { overlaps, profiles } = globalThis.QPCore;
  assert.equal(overlaps('https://host/a*', 'https://host/*b'), true);
  assert.equal(overlaps('https://host/a*', 'https://host/b*'), false);
  assert.equal(overlaps('https://host/a', 'https://host/a*'), true);
  assert.equal(overlaps('https://host/a', 'https://host/b'), false);
  assert.equal(profiles([{ id: 'app-first', title: 'First', rules: [rule] }, { id: 'app-second', title: 'Second', rules: [{ ...rule, name: 'OTHER', url: 'https://api.example.com/other/*' }] }]).length, 2);
});

test('regex is preserved in rewrite and matches path groups, query strings and escaped slashes', () => {
  const url = String.raw`^https?:\/\/api\.example\.com\/(?:user|account)\/\d+\?page=\d{1,3}$`;
  const parsed = globalThis.QPCore.pattern(url);
  assert.equal(parsed.host, 'api.example.com');
  assert.equal(parsed.regex, url);
  assert.ok(new RegExp(parsed.regex).test('https://api.example.com/user/42?page=2'));
  assert.ok(!new RegExp(parsed.regex).test('https://api.example.com/other/42?page=2'));
  const conf = generate({ rules: [{ ...rule, url }] }, 'https://assets.example/script.js');
  assert.ok(conf.includes(url + ' url script-request-header'));
  assert.ok(conf.includes('hostname = api.example.com'));
});
test('invalid or scope-escaping regexes are rejected', () => {
  for (const url of [String.raw`^https://api.example.com/a`, String.raw`^https://.*\/a`, String.raw`^https://api\.example\.com/a|https://other`, String.raw`^https://api\.example\.com/(a+)+$`, String.raw`^https://api\.example\.com/(?=a)a`, String.raw`^https://api\.example\.com/[`, '^https://api\\.example\\.com/a\n', String.raw`^http?://api\.example\.com/a`]) {
    assert.throws(() => globalThis.QPCore.pattern(url), undefined, url);
  }
});
test('regex conflicts conservatively reject unknown overlap and allow disjoint prefixes', () => {
  const { overlaps } = globalThis.QPCore;
  assert.equal(overlaps(String.raw`^https://api\.example\.com/user/\d+$`, String.raw`^https://api\.example\.com/order/\d+$`), false);
  assert.equal(overlaps(String.raw`^https://api\.example\.com/(?:user|order)/.*`, String.raw`^https://api\.example\.com/user/42$`), true);
});

test('Chengdu metro optional suffix and query groups are accepted and preserved', () => {
  const url = String.raw`^https://app\.cdmetro\.chengdurail\.cn/platform/users/user/sign-in-integral(-day)?(\?.*)?$`;
  const { pattern } = globalThis.QPCore;
  const parsed = pattern(url);
  assert.equal(parsed.host, 'app.cdmetro.chengdurail.cn');
  assert.equal(parsed.regex, url);
  const regex = new RegExp(parsed.regex);
  const base = 'https://app.cdmetro.chengdurail.cn/platform/users/user/sign-in-integral';
  for (const suffix of ['', '-day', '?page=1', '-day?page=1', '?', '-day?']) assert.ok(regex.test(base + suffix), suffix);
  for (const value of [base + '-other', base + '/day', base.replace('https:', 'http:'), base.replace('app.cdmetro.', 'evil.cdmetro.')]) assert.equal(regex.test(value), false);
  assert.ok(generate({ rules: [{ ...rule, url }] }, 'https://assets.example/script.js').includes(url + ' url script-request-header'));
  assert.doesNotThrow(() => pattern(String.raw`^https://api\.example\.com/a(?:-day)?(?:\?.*)?$`));
  assert.throws(() => pattern(String.raw`^https://api\.example\.com/(a+)+$`));
  assert.throws(() => pattern(String.raw`^https://api\.example\.com/(a*)*$`));
});
