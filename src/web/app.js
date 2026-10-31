const byId = id => document.getElementById(id);
const core = globalThis.QPCore;
let mode = 'loading', profiles = [], currentId, original = '', view = 'list', busy = false;
let toastTimer, listScroll = 0, ruleSequence = 0, pendingResult = null;
const profileExists = () => profiles.some(item => item.id === currentId);
const editorChanged = () => JSON.stringify(draft()) !== original;
const cards = () => [...byId('rules').children];
const newId = () => 'app-' + [...crypto.getRandomValues(new Uint8Array(12))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const plain = ({ last, ...item }) => item;
const icon = name => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const use = document.createElementNS(svg.namespaceURI, 'use');
  use.setAttribute('href', '#i-' + name); svg.setAttribute('aria-hidden', 'true'); svg.append(use); return svg;
};
function toast(text) {
  clearTimeout(toastTimer); byId('toast').textContent = text; byId('toast').hidden = false;
  toastTimer = setTimeout(() => { byId('toast').hidden = true; }, 4000);
}
function draft() {
  return { id: currentId, title: byId('profile-title').value.trim(), rules: cards().map(card => Object.fromEntries([...card.querySelectorAll('[data-field]')].map(field => [field.dataset.field, field.type === 'checkbox' ? field.checked : field.value.trim()]))) };
}
let panelOriginal = '', panelConfigured = false, connectionTimer;
function connectionState(state, label) {
  clearTimeout(connectionTimer);
  byId('panel-connection').dataset.state = state; byId('panel-connection-label').textContent = label;
  if (state === 'success') connectionTimer = setTimeout(() => connectionState('idle', '上次测试已超过 5 分钟，请重新测试'), 300000);
}
function updatePanelTest() {
  byId('panel-test').disabled = busy || mode !== 'device' || !panelConfigured || panelDirty();
}
const panelDraft = () => JSON.stringify({ url: byId('panel-url').value, clientId: byId('panel-client').value });
const panelDirty = () => mode === 'device' && (panelDraft() !== panelOriginal || !!byId('panel-secret').value);
const dirty = () => (view === 'editor' && JSON.stringify(draft()) !== original) || (view === 'settings' && panelDirty());
window.qpCanUpdate = () => !busy && !dirty();
function recount() {
  cards().forEach((card, index) => { card.querySelector('.rule-index').textContent = '规则 ' + (index + 1); });
  byId('count').textContent = cards().length + ' / 10';
  byId('add-rule').disabled = busy || cards().length >= 10;
  byId('new-profile').disabled = busy || mode === 'loading' || profiles.length >= 20;
  byId('create-first').disabled = busy || mode === 'loading';
}
function changed() {
  byId('draft-state').textContent = editorChanged() ? '未保存的修改' : profileExists() ? (mode === 'device' ? '已保存到本机' : '已加入预览列表') : '新应用 · 尚未保存';
  byId('form-error').hidden = true;
  document.querySelectorAll('[aria-invalid=true]').forEach(field => field.removeAttribute('aria-invalid'));
  updateActions();
}
function updateActions() {
  byId('save').disabled = busy;
  byId('save-label').textContent = busy ? '处理中…' : '预览 JS';
}
function setBusy(value) {
  busy = value; byId('editor-fields').disabled = value;
  document.querySelectorAll('.profile-open, .profile-delete').forEach(button => { button.disabled = value; });
  for (const id of ['back', 'environment', 'result-save', 'close-result', 'result-back', 'continue-editing']) byId(id).disabled = value;
  byId('form').setAttribute('aria-busy', String(value)); recount(); updateActions();
}
function showView(next) {
  if (view === 'list') listScroll = window.scrollY;
  view = next;
  for (const name of ['list', 'editor', 'settings']) byId(name + '-view').hidden = name !== next;
  byId('tabbar').hidden = next === 'editor';
  for (const [id, selected] of [['apps-tab', next === 'list'], ['settings-tab', next === 'settings']]) {
    if (selected) byId(id).setAttribute('aria-current', 'page'); else byId(id).removeAttribute('aria-current');
  }
  window.scrollTo({ top: next === 'list' ? listScroll : 0, behavior: 'instant' });
  const heading = byId(next === 'list' ? 'list-title' : next === 'settings' ? 'settings-title' : 'editor-title');
  heading.tabIndex = -1; heading.focus({ preventScroll: true });
}
function syncModalState() { document.body.classList.toggle('modal-open', !!document.querySelector('dialog[open]')); }
function ask(title, description, action) {
  if (byId('confirm-dialog').open) return Promise.resolve(false);
  byId('confirm-title').textContent = title; byId('confirm-description').textContent = description; byId('confirm-ok').textContent = action;
  const dialog = byId('confirm-dialog'); dialog.returnValue = ''; dialog.showModal(); syncModalState();
  byId('confirm-cancel').focus();
  return new Promise(resolve => dialog.addEventListener('close', () => { syncModalState(); resolve(dialog.returnValue === 'confirm'); }, { once: true }));
}
byId('confirm-ok').addEventListener('click', () => byId('confirm-dialog').close('confirm'));
byId('confirm-cancel').addEventListener('click', () => byId('confirm-dialog').close('cancel'));
async function leave(next) {
  if (busy) return;
  if (dirty() && !await ask('放弃未保存的修改？', '这次修改不会保留，已经保存的应用配置不会改变。', '放弃修改')) return;
  if (view === 'settings' && panelDirty()) { const saved = JSON.parse(panelOriginal); byId('panel-url').value = saved.url; byId('panel-client').value = saved.clientId; byId('panel-secret').value = ''; }
  showView(next);
}
function addRule(rule = { name: '', url: '', header: 'cookie', enabled: true }) {
  if (cards().length >= 10) return;
  const card = byId('rule-template').content.firstElementChild.cloneNode(true);
  for (const key of ['name', 'url', 'header', 'headerMode', 'enabled']) {
    const field = card.querySelector(`[data-field="${key}"]`); field.id = 'field-' + (++ruleSequence);
    if (key === 'enabled') field.checked = rule[key];
    else if (key === 'headerMode') field.value = rule[key] || 'single';
    else field.value = key === 'url' && rule[key] ? core.pattern(rule[key]).regex : rule[key];
  }
  const update = () => {
    card.classList.toggle('is-disabled', !card.querySelector('[data-field=enabled]').checked);
    const all = card.querySelector('[data-field=headerMode]').value === 'all';
    card.querySelector('.single-header').hidden = all;
    card.querySelector('.all-headers-note').hidden = !all;
    card.querySelector('[data-field=header]').required = !all;
    const value = card.querySelector('[data-field=header]').value.toLowerCase();
    card.querySelectorAll('[data-header]').forEach(button => {
      const selected = button.dataset.header === value; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected));
    });
  };
  card.addEventListener('input', () => { update(); changed(); });
  card.querySelectorAll('[data-header]').forEach(button => button.addEventListener('click', () => {
    card.querySelector('[data-field=header]').value = button.dataset.header; update(); changed();
  }));
  card.querySelector('.remove-rule').addEventListener('click', async () => {
    const hasContent = card.querySelector('[data-field=name]').value.trim() || card.querySelector('[data-field=url]').value.trim();
    if (hasContent && !await ask('移除这条规则？', '保存后生效。不会删除青龙中已经存在的变量。', '移除规则')) return;
    card.remove(); recount(); changed(); byId('add-rule').focus();
  });
  update(); byId('rules').append(card); recount();
}
function lastText(last) {
  if (!last) return '尚无同步记录。导入重写后，打开目标应用触发。';
  const action = { created: '已创建变量', updated: '已更新变量', unchanged: '变量无需更新', error: '同步未完成' }[last.action] || '同步记录';
  const date = new Date(last.time);
  return action + (last.name ? ' · ' + last.name : '') + (last.message ? ' · ' + last.message : '') + (Number.isNaN(date.getTime()) ? '' : ' · ' + date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }));
}
function openProfile(item) {
  if (busy || mode === 'loading') return;
  currentId = item?.id || newId();
  byId('profile-title').value = item?.title || '';
  byId('editor-title').textContent = item ? '编辑应用' : '新建应用';
  byId('draft-state').textContent = item ? '已保存' : '新配置';
  byId('rules').replaceChildren();
  if (item) item.rules.forEach(addRule); else addRule();
  byId('last-result').textContent = lastText(item?.last); byId('last-result').hidden = !item;
  byId('form-error').hidden = true;
  pendingResult = null;
  original = JSON.stringify(draft()); setBusy(false); showView('editor');
}
function renderProfiles() {
  byId('profile-count').textContent = profiles.length;
  byId('search-wrap').hidden = profiles.length < 3;
  const query = byId('search-wrap').hidden ? '' : byId('search').value.trim().toLowerCase();
  const visible = profiles.filter(item => (item.title + ' ' + item.rules.map(rule => rule.name).join(' ')).toLowerCase().includes(query));
  byId('profiles').replaceChildren();
  byId('empty-state').hidden = profiles.length > 0; byId('no-results').hidden = !profiles.length || !!visible.length;
  for (const item of visible) {
    const button = document.createElement('button'); button.className = 'profile-open'; button.type = 'button'; button.setAttribute('aria-label', '编辑 ' + item.title);
    const avatar = document.createElement('span'); avatar.className = 'app-avatar'; avatar.textContent = [...item.title][0].toUpperCase(); avatar.setAttribute('aria-hidden', 'true');
    avatar.dataset.color = String([...item.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 4);
    const copy = document.createElement('span'); copy.className = 'profile-copy';
    const name = document.createElement('strong'); name.textContent = item.title;
    const detail = document.createElement('small'); const enabled = item.rules.filter(rule => rule.enabled).length;
    detail.textContent = item.last?.action === 'error' ? '同步未完成 · 查看详情' : enabled ? enabled + ' 条规则启用 · 独立配置' : '全部规则已停用';
    detail.classList.toggle('error-status', item.last?.action === 'error');
    copy.append(name, detail); button.append(avatar, copy, icon('next'));
    button.addEventListener('click', () => openProfile(item));
    const row = document.createElement('div'); row.className = 'profile-row'; row.append(button);
    const actions = document.createElement('div'); actions.className = 'profile-actions';
    if (mode === 'device') {
      const link = document.createElement('a'); link.className = 'profile-import';
      link.href = core.profileLinks(plain(item)).importUrl;
      link.textContent = '导入 QX'; link.setAttribute('aria-label', '导入 ' + item.title + ' 到 Quantumult X');
      link.addEventListener('click', event => { if (busy) event.preventDefault(); });
      actions.append(link);
    }
    if (mode !== 'device') {
      const unavailable = document.createElement('button'); unavailable.type = 'button'; unavailable.className = 'profile-import'; unavailable.textContent = '导入 QX'; unavailable.disabled = true; unavailable.title = '请在 QX 本地控制台保存后导入'; actions.append(unavailable);
    }
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'profile-delete'; remove.textContent = '删除';
    remove.setAttribute('aria-label', '删除 ' + item.title); remove.disabled = busy;
    remove.addEventListener('click', () => deleteProfile(item)); actions.append(remove);
    button.disabled = busy; row.append(actions); byId('profiles').append(row);
  }
  recount();
}
async function api(path, body) {
  const response = await fetch(path, { ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-QP-Local': '1' }, body: JSON.stringify(body) } : {}), cache: 'no-store', signal: AbortSignal.timeout(12000) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || '请求未完成，请重试。'); return data;
}
async function init() {
  mode = 'loading'; byId('loading').hidden = false; byId('load-error').hidden = true; byId('list-content').hidden = true; recount();
  try {
    const status = await api('/api/status'); if (!['device', 'preview'].includes(status.mode)) throw new Error('Unknown mode');
    const received = status.profiles.map(item => ({ ...core.profile(plain(item)), last: item.last })); core.profiles(received.map(plain));
    mode = status.mode; profiles = received;
    showPanel(status.panel);
    byId('panel-fields').disabled = mode !== 'device';
    byId('mode').textContent = mode === 'device' ? '本机运行' : '预览模式'; byId('environment').dataset.mode = mode;
    byId('connection-title').textContent = mode === 'device' ? 'QX 本地控制台' : '开发预览';
    byId('auth-status').textContent = mode === 'preview' ? '预览不读取认证' : status.configured ? '已检测到配置' : '尚未配置';
    byId('connection-detail').textContent = mode === 'preview' ? '此页面仅供开发预览。用户添加入口 .conf 后访问 qlpush.com，无需启动服务器。' : '认证配置存在不代表连接成功。首次同步前，请确认青龙权限与网络可用。';
    document.querySelector('.empty-footnote').textContent = mode === 'preview' ? '预览数据刷新后清除' : '';
    document.querySelector('.empty-footnote').hidden = mode !== 'preview';
    byId('list-content').hidden = false; renderProfiles();
  } catch (_) {
    mode = 'loading'; byId('mode').textContent = '未连接'; byId('environment').dataset.mode = 'offline';
    byId('connection-title').textContent = '连接失败'; byId('auth-status').textContent = '未读取';
    byId('load-error').hidden = false; byId('panel-fields').disabled = true; recount();
  } finally { byId('loading').hidden = true; }
}
byId('retry').addEventListener('click', init);
byId('search').addEventListener('input', renderProfiles);
byId('profile-title').addEventListener('input', changed);
for (const id of ['new-profile', 'create-first']) byId(id).addEventListener('click', () => openProfile());
byId('back').addEventListener('click', () => leave('list'));
byId('apps-tab').addEventListener('click', () => leave('list'));
for (const id of ['settings-tab', 'environment']) byId(id).addEventListener('click', () => leave('settings'));
byId('home').addEventListener('click', event => { event.preventDefault(); leave('list'); });
byId('add-rule').addEventListener('click', () => {
  addRule(); changed(); cards().at(-1)?.querySelector('[data-field=name]').focus();
});
async function deleteProfile(item) {
  if (busy) return;
  const description = mode === 'device' ? '停止这个应用的后续推送，保留青龙变量。之后请在 QX 中移除它的重写资源。其他应用不受影响。' : '只从当前页面的预览列表中移除，不影响 QX 或青龙变量。';
  if (!await ask('删除「' + item.title + '」？', description, '删除应用')) return;
  byId('list-error').hidden = true; setBusy(true); renderProfiles();
  try {
    if (mode === 'device') await api('/api/profiles/' + item.id + '/delete', {});
    profiles = profiles.filter(other => other.id !== item.id);
    toast(mode === 'device' ? '应用已删除，请移除对应的 QX 重写' : '已从预览列表删除');
  } catch (error) { byId('list-error').textContent = error.message; byId('list-error').hidden = false; }
  finally {
    setBusy(false); renderProfiles();
    (byId('profiles').querySelector('.profile-open') || byId('new-profile')).focus({ preventScroll: true });
  }
}
function validatedDraft() {
  if (!byId('form').reportValidity()) return null;
  for (const card of cards()) {
    const field = card.querySelector('[data-field=url]');
    try {
      if (!field.value.trim().startsWith('^')) throw new Error('URL 正则须以 ^ 开头，例如 ^https://api\\.example\\.com/user/.*$');
      core.pattern(field.value.trim());
    } catch (error) {
      field.setAttribute('aria-invalid', 'true'); field.focus();
      byId('form-error').textContent = error.message; byId('form-error').hidden = false; return null;
    }
  }
  try {
    const item = core.profile(draft()); core.profiles([...profiles.filter(other => other.id !== item.id).map(plain), item]); return item;
  } catch (error) { byId('form-error').textContent = error.message; byId('form-error').hidden = false; return null; }
}
function presentResult(data, saved) {
  const item = data.profile;
  pendingResult = { data, saved };
  byId('preview').value = data.js; byId('conf-preview').textContent = data.conf;
  byId('copy-js').textContent = '复制 JS'; byId('copy').textContent = '复制';
  byId('subscription').value = data.subscriptionUrl;
  byId('import').href = data.importUrl;
  byId('import').hidden = mode !== 'device' || !saved;
  byId('import-help').hidden = mode !== 'device' || !saved;
  byId('result-save').hidden = saved;
  byId('result-save').textContent = mode === 'device' ? '确认保存，下一步导入' : '确认保存到预览列表';
  byId('preview-only').hidden = mode === 'device';
  byId('result-kicker').textContent = saved ? (mode === 'device' ? '已保存到本机' : '仅保留在当前页面') : '草稿预览 · 尚未保存';
  byId('result-title').textContent = saved && mode === 'device' ? '已保存，可以导入 QX' : '检查生成的脚本';
  byId('result-help').textContent = saved ? (mode === 'device' ? '配置已生效。新应用请导入重写；修改过 URL 的已有应用，请在 QX 刷新对应资源。' : '已加入当前页面的预览列表，刷新后清除，不代表保存到了手机。') : '预览不会改变已保存的规则，也不会执行 JS。确认后再保存，或返回继续修改。';
  byId('result-app').textContent = data.profile.title + '.js';
  byId('result-meta').textContent = item.rules.filter(rule => rule.enabled).length + ' 条启用规则 · ' + (saved ? '已保存版本' : '当前草稿');
  byId('result-error').hidden = true;
  if (!byId('result-dialog').open) {
    byId('result-dialog').querySelector('details').open = false;
    byId('result-dialog').showModal(); syncModalState();
    byId('result-dialog').scrollTop = 0; byId('close-result').focus();
  }
}
async function processProfile(save, suppliedItem) {
  if (busy || mode === 'loading') return;
  const item = suppliedItem || validatedDraft(); if (!item) return;
  if (save && !item.rules.some(rule => rule.enabled)) {
    if (!await ask('保存为停用状态？', '此应用没有启用的规则，保存后不会继续推送。青龙中的变量不受影响。', '仍然保存')) return;
  }
  document.activeElement?.blur(); byId('form-error').hidden = true; setBusy(true);
  const modalWasOpen = byId('result-dialog').open;
  try {
    const data = await api(save ? '/api/profiles' : '/api/preview', item);
    const index = profiles.findIndex(other => other.id === item.id);
    if (save) {
      const saved = { ...core.profile(data.profile), last: index >= 0 ? profiles[index].last : undefined };
      if (index >= 0) profiles[index] = saved; else profiles.push(saved);
      original = JSON.stringify(draft()); renderProfiles();
      byId('editor-title').textContent = '编辑应用';
      byId('draft-state').textContent = mode === 'device' ? '已保存到本机' : '已加入预览列表';
    }
    const matchesSaved = index >= 0 && JSON.stringify(core.profile(plain(profiles[index]))) === JSON.stringify(core.profile(item));
    presentResult(data, save || matchesSaved);
  } catch (error) {
    const target = byId(modalWasOpen ? 'result-error' : 'form-error');
    target.textContent = error.name === 'TimeoutError' ? '请求超时，输入已保留。保存结果可能尚未返回，请重新加载确认后重试。' : error.message;
    target.hidden = false;
  } finally { setBusy(false); }
}
byId('form').addEventListener('submit', event => { event.preventDefault(); processProfile(false); });
byId('result-save').addEventListener('click', () => {
  if (pendingResult && !pendingResult.saved) processProfile(true, pendingResult.data.profile);
});
function closeResult() { if (!busy) byId('result-dialog').close(); }
byId('continue-editing').addEventListener('click', closeResult);
byId('result-back').addEventListener('click', closeResult);
byId('result-dialog').addEventListener('cancel', event => { if (busy) event.preventDefault(); });
byId('import').addEventListener('click', event => {
  if (!pendingResult?.saved || mode !== 'device' || busy) { event.preventDefault(); return; }
  byId('import-help').textContent = '已请求打开 QX，请在客户端确认导入。返回此页面不代表导入成功；若未跳转，可复制订阅地址手动添加。';
});
byId('close-result').addEventListener('click', closeResult);
byId('result-dialog').addEventListener('close', () => { pendingResult = null; syncModalState(); byId('save').focus({ preventScroll: true }); });
byId('result-dialog').addEventListener('click', event => {
  const rect = byId('result-dialog').getBoundingClientRect();
  if (!busy && event.target === byId('result-dialog') && (event.clientY < rect.top || event.clientX < rect.left || event.clientX > rect.right)) byId('result-dialog').close();
});
byId('copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(byId('subscription').value); byId('copy').textContent = '已复制'; setTimeout(() => { byId('copy').textContent = '复制'; }, 1800); }
  catch (_) { byId('subscription').focus(); byId('subscription').select(); byId('copy').textContent = '请长按复制'; }
});
window.addEventListener('beforeunload', event => { if (dirty() || busy) { event.preventDefault(); event.returnValue = ''; } });
init();

byId('copy-js').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(byId('preview').value); byId('copy-js').textContent = '已复制'; }
  catch (_) { byId('preview').focus(); byId('preview').select(); byId('copy-js').textContent = '请长按复制'; }
});

function showPanel(panel = {}) {
  byId('panel-url').value = panel.url || '';
  byId('panel-client').value = panel.clientId || '';
  byId('panel-secret').value = '';
  byId('panel-secret').placeholder = panel.hasSecret ? '已保存，留空保持不变' : '首次配置时填写';
  byId('panel-clear').hidden = !panel.hasSecret;
  byId('auth-status').textContent = panel.hasSecret ? '已保存 · 未验证连接' : '尚未配置';
  panelOriginal = panelDraft();
  panelConfigured = !!panel.hasSecret;
  connectionState('idle', panelConfigured ? '配置已保存，尚未测试' : '请先保存面板配置');
  updatePanelTest();
}
function panelMessage(text, error = false) {
  byId('panel-message').textContent = text; byId('panel-message').classList.toggle('error', error);
}
async function savePanel(clear = false) {
  if (mode !== 'device' || busy) return;
  if (clear && !await ask('清除青龙认证？', '停止后续同步，保留 App 配置和青龙已有变量。', '清除认证')) return;
  let input;
  if (!clear) {
    input = { url: byId('panel-url').value.trim(), clientId: byId('panel-client').value.trim(), clientSecret: byId('panel-secret').value };
  }
  busy = true; byId('panel-fields').disabled = true; byId('environment').disabled = true;
  panelMessage(clear ? '正在清除本机认证…' : '正在保存到本机 QX…');
  try {
    const data = await api(clear ? '/api/panel/delete' : '/api/panel', clear ? {} : input);
    showPanel(data.panel);
    panelMessage(clear ? '认证已清除。' : '已保存到本机。点击「测试连接」验证认证与读取权限。');
  } catch (error) { panelMessage(error.name === 'TimeoutError' ? '请求超时，请重新加载确认保存状态。' : error.message, true); }
  finally { input = null; byId('panel-secret').value = ''; busy = false; byId('panel-fields').disabled = false; byId('environment').disabled = false; updatePanelTest(); }
}
byId('panel-form').addEventListener('submit', event => { event.preventDefault(); savePanel(); });
byId('panel-clear').addEventListener('click', () => savePanel(true));

byId('panel-form').addEventListener('input', () => {
  connectionState('idle', '配置已修改，请保存后重新测试'); updatePanelTest();
});
byId('panel-test').addEventListener('click', async () => {
  if (busy || mode !== 'device' || !panelConfigured || panelDirty()) return;
  busy = true; byId('panel-fields').disabled = true; byId('environment').disabled = true;
  byId('panel-test').textContent = '正在测试…';
  connectionState('testing', '正在验证认证与环境变量读取权限…');
  try {
    const result = await api('/api/panel/test', {});
    if (result.connected !== true) throw new Error('未收到有效连接结果，请重试。');
    connectionState('success', '连接成功 · ' + new Date(result.checkedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
    panelMessage('认证和环境变量读取权限正常。测试不会创建或修改变量，写入权限仍需实际同步确认。');
  } catch (error) {
    connectionState('error', '连接未通过');
    panelMessage(error.name === 'TimeoutError' ? '测试超时，请检查网络后重试。' : error.message, true);
  } finally {
    busy = false; byId('panel-fields').disabled = false; byId('environment').disabled = false;
    byId('panel-test').textContent = '测试连接'; updatePanelTest();
  }
});
