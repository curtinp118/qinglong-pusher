import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { assets } from '../scripts/lib/bundle.js';
const bundle = await assets('https://static.example/release');
const profile = { id: 'app-first', title: 'First', rules: [{ name: 'HEADERS', url: 'https://api.example.com/user/*', headerMode: 'all', header: '', enabled: true }] };
function request(url, profiles = [profile], method = 'GET') {
  let result;
  vm.runInNewContext(bundle.backend, {
    $request: { url, method },
    $prefs: { valueForKey: () => JSON.stringify(profiles) },
    $done: value => { assert.equal(result, undefined); result = value; }
  });
  return result;
}
test('loopback backend returns an app-bound parser resource with no outbound calls', () => {
  const url = 'http://127.0.0.1:9999/qinglong-pusher/scripts/app-first.js';
  const result = request(url);
  assert.match(result.status, /200/);
  assert.ok(result.body.includes('url script-request-header ' + url));
  assert.ok(result.body.includes('const QP_PROFILE_ID = "app-first";'));
  assert.doesNotThrow(() => new vm.Script(result.body));
  assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.ok(!result.body.includes('qlpush.com/scripts/app-first.js'));
  const removed = request(url, []);
  assert.match(removed.status, /200/);
  assert.ok(!removed.body.includes('script-request-header'));
});
test('backend cannot expose APIs or serve resources via public hosts', () => {
  for (const url of ['https://qlpush.com/qinglong-pusher/scripts/app-first.js', 'http://evil.example:9999/qinglong-pusher/scripts/app-first.js', 'http://127.0.0.1:9999/api/status', 'http://127.0.0.1:9999/api/panel']) assert.match(request(url).status, /404/);
  assert.match(request('http://127.0.0.1:9999/qinglong-pusher/scripts/app-first.js', [], 'POST').status, /404/);
});
