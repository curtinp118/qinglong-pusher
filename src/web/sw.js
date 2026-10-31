/* Version is injected from asset content by the bundle builder. Never cache API data. */
const CACHE = 'qinglong-pusher-shell-__PWA_VERSION__';
const SHELL = ['/', '/style.css', '/core.js', '/app.js', '/pwa.js', '/manifest.webmanifest'];
const HASHES = __SHELL_HASHES__;
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    // Verify every response before writing: an interrupted QX update must not mix UI versions.
    const responses = await Promise.all(SHELL.map(async path => {
      const response = await fetch(new Request(path, { cache: 'reload' }));
      if (!response.ok || response.redirected) throw new Error('Shell download failed');
      const digest = await crypto.subtle.digest('SHA-256', await response.clone().arrayBuffer());
      const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
      if (hash !== HASHES[path]) throw new Error('Shell version mismatch');
      return [path, response];
    }));
    const cache = await caches.open(CACHE);
    await Promise.all(responses.map(([path, response]) => cache.put(path, response)));
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('qinglong-pusher-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('message', event => {
  if (event.data === 'ACTIVATE_UPDATE') self.skipWaiting();
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.search || !SHELL.includes(url.pathname)) return;
  // Pin the whole UI to one version; activation switches all assets together.
  event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(event.request)) || fetch(event.request)));
});
