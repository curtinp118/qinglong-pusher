(() => {
  const status = document.getElementById('pwa-status');
  const install = document.getElementById('pwa-install');
  const update = document.getElementById('pwa-update');
  const check = document.getElementById('pwa-check');
  const standalone = matchMedia('(display-mode: standalone)');
  let promptEvent, registration, activating = false, checking = false, lastCheck = 0;
  async function checkUpdate(manual = false) {
    if (!registration || checking || (!manual && Date.now() - lastCheck < 60000)) return;
    checking = true; check.disabled = true; lastCheck = Date.now();
    try {
      await registration.update();
      update.hidden = !registration.waiting;
      if (manual) status.textContent = registration.waiting ? '新版本已就绪' : registration.installing ? '正在下载新版本…' : '未发现新版本；发布后请先更新 QX 入口脚本缓存';
    } catch (_) { if (manual) status.textContent = '检查失败，请确认 QX 已开启后重试'; }
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
  update.addEventListener('click', () => {
    if (!registration?.waiting) return;
    if (window.qpCanUpdate && !window.qpCanUpdate()) { status.textContent = '请先保存或放弃当前编辑，再更新'; return; }
    if (!confirm('新版本已就绪，立即更新并刷新页面？')) return;
    activating = true;
    registration.waiting.postMessage('ACTIVATE_UPDATE');
  });
  navigator.serviceWorker?.addEventListener('controllerchange', () => {
    if (activating && (!window.qpCanUpdate || window.qpCanUpdate())) { location.reload(); return; }
    status.textContent = '新版本已就绪，保存修改后刷新页面即可使用';
    update.hidden = true;
  });
  showMode();
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).then(reg => {
      registration = reg;
      check.disabled = false;
      function ready() {
        update.hidden = !reg.waiting;
        if (reg.waiting) status.textContent = '发现新版本，点击更新后生效';
      }
      ready();
      const watch = () => reg.installing?.addEventListener('statechange', ready);
      watch();
      reg.addEventListener('updatefound', watch);
      checkUpdate();
    }).catch(() => { status.textContent = '离线缓存不可用；仍可通过 Safari 添加到主屏幕，检查 QX 入口与 HTTPS 信任。'; });
  } else status.textContent = '当前环境不支持离线缓存，请用 HTTPS Safari 打开本地控制台。';
})();
