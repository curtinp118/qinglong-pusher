import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assets } from './lib/bundle.js';
import { bootstrap } from '../src/server/rewrite-config.js';

export async function publish(baseURL, output) {
  const base = new URL(baseURL);
  if (base.protocol !== 'https:' || /[,\s]/.test(baseURL) || base.username || base.password || base.search || base.hash || base.hostname === 'qlpush.com' || base.hostname.endsWith('.qlpush.com')) {
    throw new Error('Use a public HTTPS static directory, not the intercepted qlpush.com domain.');
  }
  const address = base.href.replace(/\/$/, '');
  const bundle = await assets(address);
  await mkdir(resolve(output, 'qx'), { recursive: true });
  await writeFile(resolve(output, 'qinglong-pusher.conf'), bootstrap(address));
  await writeFile(resolve(output, 'qx/local.js'), bundle.local);
  await writeFile(resolve(output, 'qx/capture.js'), bundle.capture);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [base, output = 'release'] = process.argv.slice(2);
  if (!base) throw new Error('Usage: npm run build -- https://<static-host>/<directory> [output-directory]');
  await publish(base, output);
  console.log('Static release written to ' + resolve(output) + '. Publish qinglong-pusher.conf, qx/local.js and qx/capture.js; no server process is needed.');
}
