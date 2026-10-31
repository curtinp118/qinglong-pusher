import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { assets } from '../scripts/lib/bundle.js';
const bundle = await assets('https://static.example/release');
test('PWA assets are embedded for QX with standalone manifest and real PNG icons', () => {
  const files = bundle.files;
  const manifest = JSON.parse(files['/manifest.webmanifest'][0]);
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  for (const item of manifest.icons) {
    const png = Buffer.from(item.src.split(',')[1], 'base64');
    assert.equal(png.toString('ascii', 1, 4), 'PNG');
    assert.equal(png.readUInt32BE(16), Number(item.sizes.split('x')[0]));
  }
  assert.ok(!files['/'][0].includes('__APPLE_ICON__'));
  assert.ok(!files['/sw.js'][0].includes('__PWA_VERSION__'));
  for (const path of ['/sw.js', '/pwa.js', '/manifest.webmanifest']) assert.ok(bundle.local.includes(path));
});
test('service worker intercepts only static shell GETs, never config, auth, scripts or subscriptions', () => {
  const handlers = {};
  let calls = 0;
  vm.runInNewContext(bundle.files['/sw.js'][0], {
    self: { location: { origin: 'https://qlpush.com' }, addEventListener: (type, fn) => { handlers[type] = fn; } },
    URL, caches: { open: async () => ({ match: async () => 'cached' }) }, fetch: () => { throw new Error('unexpected'); }
  });
  for (const [path, method] of [['/api/status','GET'], ['/api/panel','POST'], ['/api/panel/test','POST'], ['/api/preview','POST'], ['/profiles/app-first.conf','GET'], ['/scripts/app-first.js','GET'], ['/qx/local.js','GET'], ['/?token=fixture','GET'], ['/style.css','POST']]) {
    handlers.fetch({ request: { url: 'https://qlpush.com' + path, method }, respondWith: () => { calls++; } });
  }
  assert.equal(calls, 0);
  handlers.fetch({ request: { url: 'https://qlpush.com/style.css', method: 'GET' }, respondWith: () => { calls++; } });
  assert.equal(calls, 1);
});

test('PWA checks on foreground and manual action, protects drafts and reloads only after consent', async () => {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { hidden: true, disabled: true, textContent: '', handlers: {}, addEventListener(type, fn) { this.handlers[type] = fn; } });
    return elements.get(id);
  };
  const windowHandlers = {}, documentHandlers = {}, workerHandlers = {};
  let checks = 0, messages = 0, reloads = 0, safe = false, confirmCount = 0, now = 100000;
  const reg = { waiting: { postMessage: () => { messages++; } }, update: async () => { checks++; }, addEventListener() {} };
  const window = { isSecureContext: true, qpCanUpdate: () => safe, addEventListener: (type, fn) => { windowHandlers[type] = fn; } };
  const document = { hidden: false, getElementById: element, addEventListener: (type, fn) => { documentHandlers[type] = fn; } };
  vm.runInNewContext(bundle.files['/pwa.js'][0], {
    window, document, navigator: { serviceWorker: { register: async () => reg, addEventListener: (type, fn) => { workerHandlers[type] = fn; } } },
    matchMedia: () => ({ matches: true, addEventListener() {} }),
    setInterval: () => {}, Date: { now: () => now }, location: { reload: () => { reloads++; } },
    confirm: () => { confirmCount++; return true; }
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(checks, 1);
  await element('pwa-check').handlers.click();
  assert.equal(checks, 2);
  now += 61000;
  documentHandlers.visibilitychange();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(checks, 3);
  element('pwa-update').handlers.click();
  assert.equal(messages, 0);
  assert.equal(confirmCount, 0);
  safe = true;
  element('pwa-update').handlers.click();
  assert.equal(messages, 1);
  workerHandlers.controllerchange();
  assert.equal(reloads, 1);
});
