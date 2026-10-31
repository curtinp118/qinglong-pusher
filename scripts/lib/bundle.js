import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
export async function assets(baseURL) {
  const read = path => readFile(new URL('../../' + path, import.meta.url), 'utf8');
  const [html, css, app, core, local, capture, pwa, worker, iconsJSON] = await Promise.all(['src/web/index.html', 'src/web/style.css', 'src/web/app.js', 'src/shared/core.js', 'src/quantumult/local.js', 'src/quantumult/capture.js', 'src/web/pwa.js', 'src/web/sw.js', 'src/web/pwa-icons.json'].map(read));
  const icons = JSON.parse(iconsJSON);
  const manifest = JSON.stringify({ id: '/', name: '青龙推送', short_name: '青龙推送', lang: 'zh-CN', start_url: '/', scope: '/', display: 'standalone', background_color: '#f7f7f5', theme_color: '#f7f7f5', icons: [
    { src: icons.small, sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: icons.large, sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
  ] });
  const files = { '/': [html.replace('__APPLE_ICON__', icons.apple), 'text/html'], '/style.css': [css, 'text/css'], '/app.js': [app, 'text/javascript'], '/core.js': [core, 'text/javascript'], '/pwa.js': [pwa, 'text/javascript'], '/manifest.webmanifest': [manifest, 'application/manifest+json'] };
  const version = createHash('sha256').update(JSON.stringify(files) + worker).digest('hex').slice(0, 16);
  files['/pwa.js'][0] = pwa.replace('__PWA_VERSION__', version);
  const hashes = Object.fromEntries(Object.entries(files).map(([path, [body]]) => [path, createHash('sha256').update(body).digest('hex')]));
  files['/sw.js'] = [worker.replace('__PWA_VERSION__', version).replace('__SHELL_HASHES__', JSON.stringify(hashes)), 'text/javascript'];
  const backend = await read('src/quantumult/backend.js');
  const captureSource = core + '\n' + capture;
  return { files, backend: 'const QP_CAPTURE_SOURCE = ' + JSON.stringify(captureSource) + ';\n' + core + '\n' + backend, local: 'const QP_BASE = ' + JSON.stringify(baseURL) + ';\nconst QP_ASSETS = ' + JSON.stringify(files) + ';\nconst QP_CAPTURE_SOURCE = ' + JSON.stringify(captureSource) + ';\n' + core + '\n' + local, capture: captureSource };
}
