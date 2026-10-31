import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { bootstrap, links, importURL } from './rewrite-config.js';
import { assets } from '../../scripts/lib/bundle.js';

export function validateBase(value) {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/' || /[,\s]/.test(value)) throw new Error('PUBLIC_BASE_URL must be an HTTP(S) origin without credentials or subpath');
  if (url.hostname === 'qlpush.com' || url.hostname.endsWith('.qlpush.com')) throw new Error('PUBLIC_BASE_URL cannot use the intercepted console domain');
  return url.origin;
}
export async function createServer({ baseURL = 'http://localhost:8787', rateLimit = 60 } = {}) {
  const base = validateBase(baseURL);
  const bundle = await assets(base);
  const files = new Map(Object.entries(bundle.files));
  files.set('/qx/local.js', [bundle.local, 'text/javascript']);
  files.set('/qx/backend.js', [bundle.backend, 'text/javascript']);
  files.set('/qx/capture.js', [bundle.capture, 'text/javascript']);
  files.set('/qinglong-pusher.conf', [bootstrap(base), 'text/plain']);
  const buckets = new Map();
  return http.createServer({ requestTimeout: 15000, headersTimeout: 10000, maxHeaderSize: 8192 }, async (req, res) => {
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" };
    const send = (status, body, type = 'application/json') => {
      res.writeHead(status, { ...headers, 'Content-Type': type + '; charset=utf-8' });
      res.end(type === 'application/json' ? JSON.stringify(body) : body);
    };
    try {
      const path = req.url || '/';
      if (path.length > 2000) return send(414, { error: '请求地址过长。' });
      if (req.method === 'GET' && path === '/healthz') return send(200, { ok: true });
      if (req.method === 'GET' && path === '/favicon.ico') { res.writeHead(204, headers); return res.end(); }
      const now = Date.now();
      for (const [key, bucket] of buckets) if (bucket.until <= now) buckets.delete(key);
      const ip = req.socket.remoteAddress;
      if (!buckets.has(ip)) {
        if (buckets.size >= 10000) return send(503, { error: '服务繁忙。' });
        buckets.set(ip, { count: 0, until: now + 60000 });
      }
      if (++buckets.get(ip).count > rateLimit) { res.setHeader('Retry-After', '60'); return send(429, { error: '请求过于频繁。' }); }
      if (req.method === 'GET' && files.has(path)) { const [body, type] = files.get(path); return send(200, body, type); }
      const capture = /^\/qx\/capture\/([a-z0-9][a-z0-9-]{7,47})\.js$/.exec(path);
      if (req.method === 'GET' && capture) return send(200, globalThis.QPCore.captureScript(capture[1], bundle.capture), 'text/javascript');
      if (req.method === 'GET' && path === '/api/status') return send(200, { mode: 'preview', configured: false, profiles: [], bootstrapUrl: base + '/qinglong-pusher.conf', bootstrapImportUrl: importURL(base + '/qinglong-pusher.conf', 'qinglong-pusher-console') });
      if (req.method === 'POST' && (path === '/api/profiles' || path === '/api/preview')) {
        if ((req.headers.origin && req.headers.origin !== base) || req.headers['sec-fetch-site'] === 'cross-site') return send(403, { error: '不允许跨站生成。' });
        if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) return send(415, { error: '使用 application/json。' });
        let size = 0;
        const chunks = [];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 8192) { res.setHeader('Connection', 'close'); return send(413, { error: '请求体过大。' }); }
          chunks.push(chunk);
        }
        try {
          const result = links(JSON.parse(Buffer.concat(chunks).toString('utf8')), base);
          return send(200, { ...result, js: globalThis.QPCore.profileScript(result.profile, bundle.capture), preview: true });
        }
        catch (_) { return send(400, { error: '规则格式无效，请检查变量名、URL 和请求头；不接受凭据字段。' }); }
      }
      return send(404, { error: '资源不存在。' });
    } catch (_) { if (!res.headersSent && !res.destroyed) send(500, { error: '服务暂时不可用。' }); }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const server = await createServer({ baseURL: process.env.PUBLIC_BASE_URL || `http://localhost:${port}` });
  server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`qinglong-pusher listening on port ${port}`));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 10000).unref(); });
}
