import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import vm from 'node:vm';
import { publish } from '../scripts/build-release.js';

test('static release contains a complete local console without a running server', async () => {
  await mkdir('.tmp', { recursive: true });
  const directory = await mkdtemp('.tmp/publish-test-');
  try {
    await publish('https://static.example/repo/main/release/', directory);
    const conf = await readFile(directory + '/qinglong-pusher.conf', 'utf8');
    const script = await readFile(directory + '/qx/local.js', 'utf8');
    const capture = await readFile(directory + '/qx/capture.js', 'utf8');
    assert.doesNotThrow(() => new vm.Script(capture));
    assert.ok(!capture.startsWith('const QP_PROFILE_ID'));
    assert.ok(conf.includes('https://static.example/repo/main/release/qx/local.js'));
    assert.ok(!conf.includes('localhost'));
    let response;
    vm.runInNewContext(script, {
      $request: { method: 'GET', url: 'https://qlpush.com/scripts/app-first.js' },
      $prefs: { valueForKey: () => JSON.stringify([{ id: 'app-first', title: 'First', rules: [] }]) },
      $done: value => { response = value; }
    });
    assert.match(response.status, /200/);
    assert.ok(response.body.startsWith('/*\nFirst\n'));
    assert.ok(response.body.includes('const QP_PROFILE_ID = "app-first";'));
    assert.doesNotThrow(() => new vm.Script(response.body));
    for (const base of ['http://host/a', 'https://qlpush.com/', 'https://host/a,b', 'https://host/a?q=1']) {
      await assert.rejects(publish(base, directory));
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
