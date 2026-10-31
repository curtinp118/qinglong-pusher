(() => {
  const status = document.getElementById('pwa-status');
  const install = document.getElementById('pwa-install');
  const update = document.getElementById('pwa-update');
  const standalone = matchMedia('(display-mode: standalone)');
  let promptEvent, registration;
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
    // No automatic refresh: let the normal unload guard protect unsaved forms.
    if (!registration?.waiting || !confirm('更新会重新加载页面，请先保存正在编辑的内容。继续更新？')) return;
    registration.waiting.postMessage('ACTIVATE_UPDATE');
  });
  navigator.serviceWorker?.addEventListener('controllerchange', () => {
    status.textContent = '新版本已就绪，保存修改后刷新页面即可使用';
    update.hidden = true;
  });
  showMode();
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).then(reg => {
      registration = reg;
      function ready() { update.hidden = !reg.waiting; }
      ready();
      reg.addEventListener('updatefound', () => reg.installing?.addEventListener('statechange', ready));
      reg.update().catch(() => {});
    }).catch(() => { status.textContent = '离线缓存不可用；仍可通过 Safari 添加到主屏幕，检查 QX 入口与 HTTPS 信任。'; });
  } else status.textContent = '当前环境不支持离线缓存，请用 HTTPS Safari 打开本地控制台。';
})();
