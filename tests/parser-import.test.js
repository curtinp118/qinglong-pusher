import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import vm from 'node:vm';
import { links } from '../src/server/rewrite-config.js';
import { publish } from '../scripts/build-release.js';
const base = 'https://assets.example/release';
const rule = { name: 'APP_HEADERS', url: String.raw`^https://app\.example\.com/sign-in(-day)?(\?.*)?$`, headerMode: 'all', header: '', enabled: true };
const profile = { id: 'app-first', title: 'Metro', rules: [rule] };
const cases = [profile,
  { ...profile, rules: [] },
  { ...profile, rules: [{ ...rule, enabled: false }] },
  { ...profile, rules: [{ ...rule, url: String.raw`^http://app\.example\.com/a/\d+\?x=1&y=@$` }] },
  { ...profile, rules: Array.from({ length: 10 }, (_, i) => ({ ...rule, name: 'ENV_' + i, url: String.raw`^https://app${i}\.example\.com/a/\d+\?x=1&y=2$` })) }
];
function replaceLikeKop(content, link) {
  const parameter = link.split('#')[1].split('replace=')[1];
  let lines = content.trim().split('\n');
  for (const pair of parameter.split('+')) {
    const [match, replacement] = pair.split('@').map(decodeURIComponent);
    lines = lines.map(line => line.replace(new RegExp(match, 'gmi'), replacement));
  }
  return lines.join('\n');
}
async function withTemplate(run) {
  await mkdir('.tmp', { recursive: true });
  const directory = await mkdtemp('.tmp/parser-test-');
  try { await publish(base, directory); await run(await readFile(directory + '/app-template.conf', 'utf8')); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
test('static template hash parameters reproduce rules, preserve regex and never request local URLs', () => withTemplate(async template => {
  for (const input of cases) {
    const result = links(input, base);
    assert.equal(replaceLikeKop(template, result.subscriptionUrl), result.conf.trim());
    const url = new URL(result.subscriptionUrl);
    assert.equal(url.origin + url.pathname + url.search, base + '/app-template.conf');
    assert.ok(!result.conf.includes('qlpush.com'));
    assert.ok(!result.subscriptionUrl.includes('Cookie'));
    assert.equal(JSON.parse(new URL(result.importUrl).searchParams.get('remote-resource')).rewrite_remote[0], result.subscriptionUrl + ', tag=Metro, opt-parser=true, enabled=true');
  }
  assert.notEqual(links(profile, base).subscriptionUrl, links({ ...profile, id: 'app-second' }, base).subscriptionUrl);
  assert.notEqual(links(profile, base).subscriptionUrl, links({ ...profile, rules: [] }, base).subscriptionUrl);
}));
// Opt-in integration check: downloaded upstream source stays outside the repository.
test('KOP-XIAO real parser produces the expected application rules', { skip: !process.env.QP_KOP_PARSER_PATH }, () => withTemplate(async template => {
  const source = await readFile(process.env.QP_KOP_PARSER_PATH, 'utf8');
  for (const input of cases) {
    const result = links(input, base);
    let parsed;
    vm.runInNewContext(source, {
      $resource: { link: result.subscriptionUrl, content: template, type: 'rewrite', tag: input.title },
      $environment: { version: 'v1.5.6 build 951' },
      $notify() {}, console: { log() {} }, $done: value => { parsed = value; }
    }, { timeout: 5000 });
    assert.ok(parsed && !parsed.error);
    assert.equal(parsed.content.trim(), result.conf.trim());
  }
}));
