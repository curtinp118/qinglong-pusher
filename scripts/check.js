import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
async function sources(directory) {
  const entries = await readdir(new URL(directory + '/', new URL('../', import.meta.url)), { withFileTypes: true });
  const files = await Promise.all(entries.map(entry => entry.isDirectory()
    ? sources(directory + '/' + entry.name)
    : entry.name.endsWith('.js') ? [directory + '/' + entry.name] : []));
  return files.flat().sort();
}
function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
for (const directory of ['src', 'scripts', 'tests']) {
  for (const file of await sources(directory)) run(['--check', file]);
}
run(['--test']);
