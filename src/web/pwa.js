(() => {
  const status = document.getElementById('pwa-status');
  const install = document.getElementById('pwa-install');
  const update = document.getElementById('pwa-update');
  const check = document.getElementById('pwa-check');
  const banner = document.getElementById('pwa-banner');
  const bannerText = document.getElementById('pwa-banner-text');
  const bannerUpdate = document.getElementById('pwa-banner-update');
  document.getElementById('pwa-version').textContent = '界面版本 ' + '__PWA_VERSION__';
  const standalone = matchMedia('(display-mode: standalone)');
  let promptEvent, registration, activating = false, checking = false, lastCheck = 0, reloadPending = false, activationTimer;
  let hadController = !!navigator.serviceWorker?.controller;
  function message(text) { status.textContent = text; bannerText.textContent = text; }
  function ready() {
    const available = !!registration?.waiting || reloadPending;
    update.hidden = !available; banner.hidden = !available;
    update.disabled = activating; bannerUpdate.disabled = activating;
    update.textContent = reloadPending ? '刷新使用新版' : activating ? '正在切换…' : '更新并刷新';
    bannerUpdate.textContent = reloadPending ? '刷新' : activating ? '更新中' : '更新';
    if (available && !activating) message(reloadPending ? '新版已启用，刷新后使用' : '新版本已就绪');
  }
  async function checkUpdate(manual = false) {
    if (!registration || checking || (!manual && Date.now() - lastCheck < 60000)) return;
    if (navigator.onLine === false) { if (manual) message('当前离线，联网后重试'); return; }
    checking = true; check.disabled = true; lastCheck = Date.now();
    if (manual) message('正在检查更新…');
    try {
      await registration.update();
      ready();
      if (manual && !registration.waiting && !reloadPending) message(registration.installing ? '正在下载新版本…' : '未发现新版本；发布后请先更新 QX 入口脚本缓存');
    } catch (_) { if (manual) message('检查失败，请确认 QX 已开启后重试'); }
    finally { checking = false; check.disabled = false; }
  }
  check.addEventListener('click', () => checkUpdate(true));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkUpdate(); });
  window.addEventListener('pageshow', () => checkUpdate());
  window.addEventListener('online', () => checkUpdate());
  setInterval(() => { if (!document.hidden) checkUpdate(); }, 300000);
  function showMode() {
    const installed = standalone.matches || navigator.standalone === true;
    status.textContent = installed ? '正在主屏幕独立窗口中运行' : 'iPhone：Safari → 分享 → 添加到主屏幕';
    install.hidden = installed || !promptEvent;
  }
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault(); promptEvent = event; showMode();
  });
  window.addEventListener('appinstalled', () => { promptEvent = null; showMode(); });
  standalone.addEventListener('change', showMode);
  install.addEventListener('click', async () => {
    if (!promptEvent) return;
    const event = promptEvent; promptEvent = null; install.hidden = true;
    await event.prompt(); await event.userChoice;
  });
  function activate() {
    if (activating || (!registration?.waiting && !reloadPending)) return;
    if (!window.qpCanUpdate?.()) { message('请先保存或放弃当前编辑，再更新'); return; }
    if (!confirm('新版本已就绪，立即更新并刷新页面？')) return;
    if (reloadPending) { location.reload(); return; }
    activating = true;
    ready();
    activationTimer = setTimeout(() => {
      activating = false; ready(); message('切换超时，请重试或关闭应用后重新打开');
    }, 15000);
    try { registration.waiting.postMessage('ACTIVATE_UPDATE'); }
    catch (_) { clearTimeout(activationTimer); activating = false; ready(); message('切换失败，请重试'); }
  }
  update.addEventListener('click', activate);
  bannerUpdate.addEventListener('click', activate);
  navigator.serviceWorker?.addEventListener('controllerchange', () => {
    clearTimeout(activationTimer);
    if (activating && window.qpCanUpdate?.()) { location.reload(); return; }
    if (!navigator.serviceWorker.controller) return;
    if (!hadController) { hadController = true; return; }
    activating = false; reloadPending = true; ready();
  });
  showMode();
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).then(reg => {
      registration = reg;
      check.disabled = false;
      ready();
      const watch = () => {
        const worker = reg.installing;
        if (!worker) return;
        message('正在下载并校验界面资源…');
        worker.addEventListener('statechange', () => {
          ready();
          if (worker.state === 'redundant') message('新版本下载或校验失败，仍使用当前版本；可重新检查');
          else if (worker.state === 'activated' && !reloadPending) message('界面缓存已就绪');
        });
      };
      watch();
      reg.addEventListener('updatefound', watch);
      checkUpdate();
    }).catch(() => { status.textContent = '离线缓存不可用；仍可通过 Safari 添加到主屏幕，检查 QX 入口与 HTTPS 信任。'; });
  } else status.textContent = '当前环境不支持离线缓存，请用 HTTPS Safari 打开本地控制台。';
})();
