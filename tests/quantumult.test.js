import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { assets } from '../scripts/lib/bundle.js';
const bundle = await assets('https://assets.example');
const key = 'qinglong_pusher_profiles_v2';
const rule = { name: 'TEST_ENV', url: 'https://api.example.com/user/*', header: 'cookie', enabled: true };
// All credentials/values below are synthetic test fixtures, never read from a real device.
const config = { id: 'app-first', title: 'First', rules: [rule] };
function prefs(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { values, valueForKey: key => values.get(key), setValueForKey(value, key) { values.set(key, value); return true; }, removeValueForKey: key => values.delete(key) };
}
function local(path, { method = 'GET', body, store = prefs(), headers = {} } = {}) {
  let result;
  vm.runInNewContext(bundle.local, { $request: { url: 'https://qlpush.com' + path, method, body, headers }, $prefs: store, $done: data => { assert.equal(result, undefined); result = data; } });
  return result;
}
const panelKey = globalThis.QPCore?.PANEL_KEY || 'qinglong_pusher_panel_v1';
const panelFixture = { url: 'https://panel.example', clientId: 'fixture-client', clientSecret: 'synthetic-panel-secret' };
const saveHeaders = { Origin: 'https://qlpush.com', 'Content-Type': 'application/json', 'X-QP-Local': '1' };
test('QX serves UI/assets without fetch and exposes no auth values', () => {
  const store = prefs({ [panelKey]: JSON.stringify(panelFixture) });
  for (const path of ['/', '/style.css', '/app.js', '/core.js']) assert.match(local(path).status, /200/);
  const status = local('/api/status', { store });
  assert.equal(JSON.parse(status.body).configured, true);
  assert.ok(!status.body.includes(panelFixture.clientSecret));
  assert.equal(status.headers['Access-Control-Allow-Origin'], undefined);
});
test('QX saves rules locally and fixed subscription reflects changes', () => {
  const store = prefs();
  const saved = local('/api/profiles', { method: 'POST', headers: saveHeaders, body: JSON.stringify(config), store });
  assert.match(saved.status, /200/);
  const source = JSON.parse(saved.body).js;
  assert.equal(source, 'const QP_PROFILE_ID = "app-first";\n' + bundle.capture);
  assert.equal(local('/scripts/app-first.js', { store }).body, source);
  assert.doesNotThrow(() => new vm.Script(source));
  assert.deepEqual(JSON.parse(store.values.get(key)), [config]);
  assert.ok(local('/profiles/app-first.conf', { store }).body.includes('api.example.com'));
  local('/api/profiles', { method: 'POST', headers: saveHeaders, body: JSON.stringify({ ...config, rules: [] }), store });
  assert.ok(!local('/profiles/app-first.conf', { store }).body.includes('hostname'));
});
test('QX rejects cross-site saves, unsupported methods and malformed stored state', () => {
  for (const headers of [{}, { ...saveHeaders, Origin: 'https://evil.example' }, { ...saveHeaders, 'X-QP-Local': '' }]) assert.match(local('/api/profiles', { method: 'POST', body: JSON.stringify(config), headers }).status, /403/);
  assert.match(local('/api/profiles', { method: 'OPTIONS' }).status, /404/);
  assert.match(local('/api/profiles', { method: 'POST', headers: saveHeaders, body: JSON.stringify({ ...config, client_secret: 'fixture' }) }).status, /400/);
  assert.match(local('/api/status', { store: prefs({ [key]: '{bad' }) }).status, /400/);
  const store = prefs(); store.setValueForKey = () => false;
  assert.match(local('/api/profiles', { method: 'POST', headers: saveHeaders, body: JSON.stringify(config), store }).status, /500/);
});
async function capture({ envs = [], rules = [rule], request = {}, response, initial = {} } = {}) {
  const store = prefs({ [key]: JSON.stringify([{ ...config, rules }]), [panelKey]: JSON.stringify(panelFixture), ...initial });
  const calls = [], notifications = [];
  let count = 0;
  await new Promise((resolve, reject) => {
    try {
      vm.runInNewContext('const QP_PROFILE_ID = "app-first";\n' + bundle.capture, {
        $request: { url: 'https://api.example.com/user/info', headers: { COOKIE: 'synthetic-value' }, ...request },
        $prefs: store, setTimeout, clearTimeout,
        $task: { fetch: async options => { calls.push(options); return response ? response(options) : { statusCode: 200, body: JSON.stringify({ code: 200, data: options.url.includes('/auth/token') ? { token: 'synthetic-access' } : options.method === 'GET' ? envs : [] }) }; } },
        $notify: (...args) => notifications.push(args),
        $done: data => { count++; assert.equal(JSON.stringify(data), '{}'); resolve(); }
      });
    } catch (error) { reject(error); }
  });
  assert.equal(count, 1);
  return { calls, store, notifications };
}
test('capture creates env, preserves original request and does not persist secrets', async () => {
  const result = await capture();
  assert.equal(result.calls.length, 3);
  assert.equal(result.calls[2].method, 'POST');
  assert.deepEqual(JSON.parse(result.calls[2].body), [{ name: rule.name, value: 'synthetic-value' }]);
  for (const request of result.calls) { assert.ok(request.url.startsWith('https://panel.example/open/')); assert.equal(request.opts.redirection, false); assert.equal(request.opts['auto-cookie'], false); }
  const stored = JSON.stringify([...result.store.values.entries()].filter(([key]) => key !== panelKey));
  assert.ok(!stored.includes('synthetic-value'));
  assert.ok(!stored.includes('synthetic-access'));
});
test('capture updates matching id and preserves labels/remarks', async () => {
  const result = await capture({ envs: [{ name: rule.name, id: 7, value: 'old', remarks: 'keep', labels: ['label'] }] });
  assert.equal(result.calls[2].method, 'PUT');
  assert.deepEqual(JSON.parse(result.calls[2].body), { name: rule.name, id: 7, value: 'synthetic-value', remarks: 'keep', labels: ['label'] });
});
test('unchanged, disabled, missing header, unmatched URL and active lease never write', async () => {
  assert.equal((await capture({ envs: [{ name: rule.name, id: 1, value: 'synthetic-value' }] })).calls.length, 2);
  for (const options of [{ rules: [{ ...rule, enabled: false }] }, { request: { headers: {} } }, { request: { url: 'https://other.example/' } }, { initial: { 'qinglong_pusher_lease_app-first': JSON.stringify({ owner: 'other', until: Date.now() + 14000 }) } }]) assert.equal((await capture(options)).calls.length, 0);
});
test('duplicate exact names, missing IDs and rejected auth fail closed', async () => {
  for (const envs of [[{ name: rule.name }, { name: rule.name }], [{ name: rule.name, value: 'old' }]]) {
    const result = await capture({ envs });
    assert.equal(result.calls.length, 2);
    assert.equal(JSON.parse(result.store.values.get('qinglong_pusher_last_result_app-first')).action, 'error');
    assert.equal(result.store.values.has('qinglong_pusher_lease_app-first'), false);
  }
  const result = await capture({ response: () => ({ statusCode: 401, body: '{"code":401,"message":"private upstream details"}' }) });
  assert.equal(result.calls.length, 1);
  assert.ok(!JSON.stringify(result.notifications).includes('private upstream'));
});
test('capture handles multiple mappings and rejects non-HTTPS panel', async () => {
  const result = await capture({ rules: [rule, { ...rule, name: 'OTHER_ENV' }] });
  assert.equal(result.calls.length, 5);
  assert.equal((await capture({ initial: { [panelKey]: JSON.stringify({ ...panelFixture, url: 'http://panel.example' }) } })).calls.length, 0);
});

test('two App profiles have isolated subscriptions, edits, deletes and capture state', async () => {
  const store = prefs();
  const second = { id: 'app-second', title: 'Second', rules: [{ ...rule, name: 'SECOND_ENV', url: 'https://other.example.com/account/*' }] };
  const save = item => local('/api/profiles', { method: 'POST', headers: saveHeaders, body: JSON.stringify(item), store });
  const firstResult = JSON.parse(save(config).body);
  const secondResult = JSON.parse(save(second).body);
  assert.notEqual(firstResult.subscriptionUrl, secondResult.subscriptionUrl);
  assert.notEqual(firstResult.importUrl, secondResult.importUrl);
  const secondConf = local('/profiles/app-second.conf', { store }).body;
  assert.ok(secondConf.includes('/scripts/app-second.js'));
  assert.ok(!secondConf.includes('api.example.com'));
  save({ ...config, title: 'Renamed', rules: [{ ...rule, enabled: false }] });
  assert.equal(local('/profiles/app-second.conf', { store }).body, secondConf);
  const deletion = local('/api/profiles/app-first/delete', { method: 'POST', headers: saveHeaders, body: '{}', store });
  assert.match(deletion.status, /200/);
  assert.ok(!local('/profiles/app-first.conf', { store }).body.includes('script-request-header'));
  assert.equal(local('/profiles/app-second.conf', { store }).body, secondConf);
  assert.deepEqual(JSON.parse(store.values.get(key)), [second]);
  const captureResult = await capture({ initial: { [key]: JSON.stringify([second]) } });
  assert.equal(captureResult.calls.length, 0, 'deleted profile cannot execute another profile rules');
});
test('cross-App variable and URL overlap conflicts reject without altering either profile', () => {
  const store = prefs({ [key]: JSON.stringify([config]) });
  for (const rules of [[{ ...rule, url: 'https://other.example.com/*' }], [{ ...rule, name: 'OTHER_ENV' }], [{ ...rule, name: 'OTHER_ENV', url: 'https://api.example.com/*' }]]) {
    const result = local('/api/profiles', { method: 'POST', headers: saveHeaders, body: JSON.stringify({ id: 'app-other', title: 'Other', rules }), store });
    assert.match(result.status, /400/);
    assert.deepEqual(JSON.parse(store.values.get(key)), [config]);
  }
});
test('profile leases do not block another App and status uses only its own key', async () => {
  const result = await capture({ initial: { 'qinglong_pusher_lease_app-other': JSON.stringify({ owner: 'other', until: Date.now() + 14000 }) } });
  assert.equal(result.calls.length, 3);
  assert.ok(result.store.values.has('qinglong_pusher_last_result_app-first'));
  assert.ok(!result.store.values.has('qinglong_pusher_last_result_app-other'));
});

test('standalone panel settings save, keep secret, reject cross-origin and clear', () => {
  const store = prefs();
  const save = (body, headers = saveHeaders) => local('/api/panel', { method: 'POST', headers, body: JSON.stringify(body), store });
  assert.match(save(panelFixture, {}).status, /403/);
  assert.match(save({ ...panelFixture, url: 'http://panel.example' }).status, /400/);
  const saved = save(panelFixture);
  assert.match(saved.status, /200/);
  assert.ok(!saved.body.includes(panelFixture.clientSecret));
  assert.equal(JSON.parse(saved.body).panel.hasSecret, true);
  assert.match(save({ ...panelFixture, clientSecret: '' }).status, /200/);
  assert.equal(JSON.parse(store.values.get(panelKey)).clientSecret, panelFixture.clientSecret);
  assert.match(save({ ...panelFixture, url: 'https://new.example', clientSecret: '' }).status, /400/);
  assert.equal(JSON.parse(store.values.get(panelKey)).url, panelFixture.url);
  assert.ok(!local('/api/status', { store }).body.includes(panelFixture.clientSecret));
  const result = local('/api/panel/delete', { method: 'POST', headers: saveHeaders, body: '{}', store });
  assert.match(result.status, /200/);
  assert.equal(JSON.parse(local('/api/status', { store }).body).configured, false);
});
test('panel storage errors do not report success or return submitted secrets', () => {
  const store = prefs(); store.setValueForKey = () => false;
  const result = local('/api/panel', { method: 'POST', headers: saveHeaders, body: JSON.stringify(panelFixture), store });
  assert.match(result.status, /500/);
  assert.ok(!result.body.includes(panelFixture.clientSecret));
});
test('capture uses the supplied regex rather than treating regex tokens as URL literals', async () => {
  const rules = [{ ...rule, url: String.raw`^https://api\.example\.com/user/\d+\?page=\d+$` }];
  assert.equal((await capture({ rules, request: { url: 'https://api.example.com/user/42?page=2' } })).calls.length, 3);
  assert.equal((await capture({ rules, request: { url: 'https://api.example.com/user/nope?page=2' } })).calls.length, 0);
});

test('draft preview generates JS without creating or updating saved profiles', () => {
  const store = prefs({ [key]: JSON.stringify([config]) });
  const before = JSON.stringify([...store.values]);
  const updated = { ...config, title: 'Unsaved title' };
  const result = local('/api/preview', { method: 'POST', headers: saveHeaders, body: JSON.stringify(updated), store });
  assert.match(result.status, /200/);
  assert.equal(JSON.parse(result.body).saved, false);
  assert.equal(JSON.parse(result.body).profile.title, 'Unsaved title');
  assert.ok(JSON.parse(result.body).js.includes('const QP_PROFILE_ID'));
  assert.equal(JSON.stringify([...store.values]), before);
  const fresh = prefs();
  const preview = local('/api/preview', { method: 'POST', headers: saveHeaders, body: JSON.stringify(config), store: fresh });
  assert.match(preview.status, /200/);
  assert.equal(fresh.values.size, 0);
  assert.match(local('/api/preview', { method: 'POST', headers: {}, body: JSON.stringify(config), store }).status, /403/);
});

async function panelTest(fetch, { store = prefs({ [panelKey]: JSON.stringify(panelFixture) }), headers = saveHeaders, timeout = false } = {}) {
  const calls = [];
  const before = JSON.stringify([...store.values]);
  const result = await new Promise((resolve, reject) => {
    try {
      vm.runInNewContext(bundle.local, {
        $request: { method: 'POST', url: 'https://qlpush.com/api/panel/test', headers, body: '{}' },
        $prefs: store, $done: resolve,
        $task: { fetch: async options => { calls.push(options); return fetch(options, calls.length); } },
        setTimeout: timeout ? fn => setTimeout(fn, 1) : setTimeout, clearTimeout
      });
    } catch (error) { reject(error); }
  });
  assert.equal(JSON.stringify([...store.values]), before, 'connection test never persists tokens or variable data');
  return { result, calls };
}
test('panel connection checks auth and environment access without writing or exposing secrets', async () => {
  const { result, calls } = await panelTest((_, n) => ({ statusCode: 200, body: JSON.stringify({ code: 200, data: n === 1 ? { token: 'synthetic-test-token' } : [{ value: 'synthetic-env-value' }] }) }));
  assert.match(result.status, /200/);
  assert.equal(JSON.parse(result.body).connected, true);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.method, 'GET'); assert.equal(call.opts.redirection, false);
    assert.equal(call.opts['skip-cert-verify'], false); assert.equal(call.opts['auto-cookie'], false);
  }
  for (const secret of [panelFixture.clientSecret, 'synthetic-test-token', 'synthetic-env-value']) assert.ok(!result.body.includes(secret));
});
test('panel test rejects auth, permissions, malformed responses, timeouts and cross-site requests', async () => {
  for (const fetch of [
    () => ({ statusCode: 401, body: '{"code":401,"message":"upstream-private"}' }),
    (_, n) => ({ statusCode: n === 1 ? 200 : 403, body: JSON.stringify({ code: n === 1 ? 200 : 403, data: { token: 'synthetic-token' } }) }),
    () => ({ statusCode: 200, body: '<html>upstream-private</html>' }),
    () => { throw new Error('upstream-private'); }
  ]) {
    const { result } = await panelTest(fetch);
    assert.match(result.status, /502/); assert.ok(!result.body.includes('upstream-private'));
  }
  assert.match((await panelTest(() => new Promise(() => {}), { timeout: true })).result.status, /502/);
  const denied = await panelTest(() => { throw new Error('must not fetch'); }, { headers: {} });
  assert.match(denied.result.status, /403/); assert.equal(denied.calls.length, 0);
  const missing = await panelTest(() => {}, { store: prefs() });
  assert.match(missing.result.status, /400/); assert.equal(missing.calls.length, 0);
});
