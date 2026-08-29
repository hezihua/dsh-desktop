/** 注入到官方 Harness 页面，与启动页共用同一套标题栏。 */
export const TITLEBAR_CSS = `
#dsh-desktop-titlebar, #dsh-desktop-titlebar * { box-sizing: border-box; }
#dsh-desktop-titlebar {
  position: fixed; inset: 0 0 auto 0; z-index: 2147483646;
  height: 36px; display: flex; align-items: stretch; justify-content: space-between;
  background: #141a22; color: rgba(255,255,255,.92);
  border-bottom: 1px solid rgba(255,255,255,.07);
  font-family: Inter, system-ui, sans-serif; user-select: none;
}
#dsh-desktop-titlebar .drag {
  flex: 1; display: flex; align-items: center; gap: 8px; padding: 0 12px;
  -webkit-app-region: drag;
}
#dsh-desktop-titlebar .mark {
  width: 14px; height: 14px; border-radius: 4px; flex: 0 0 14px;
  background: linear-gradient(135deg, #4f8cff 0%, #6ee7d2 100%);
}
#dsh-desktop-titlebar .title { font-size: 12px; font-weight: 600; letter-spacing: .02em; opacity: .88; }
#dsh-desktop-titlebar .controls { display: flex; -webkit-app-region: no-drag; }
#dsh-desktop-titlebar button {
  width: 46px; height: 36px; margin: 0; padding: 0; border: 0; border-radius: 0;
  background: transparent; color: rgba(255,255,255,.78); cursor: pointer;
  display: grid; place-items: center;
}
#dsh-desktop-titlebar button:hover { background: rgba(255,255,255,.08); color: #fff; }
#dsh-desktop-titlebar button.close:hover { background: #e81123; color: #fff; }
html.dsh-desktop-framed,
html.dsh-desktop-framed body {
  height: 100% !important;
  max-height: 100% !important;
  overflow: hidden !important;
  margin: 0;
}
html.dsh-desktop-framed #root {
  height: 100vh;
  max-height: 100vh;
  padding-top: 36px;
  box-sizing: border-box;
  overflow: hidden;
}
`

export const TITLEBAR_JS = `
(() => {
  if (document.getElementById('dsh-desktop-titlebar')) return;
  document.documentElement.classList.add('dsh-desktop-framed');
  const bar = document.createElement('header');
  bar.id = 'dsh-desktop-titlebar';
  bar.innerHTML = \`
    <div class="drag">
      <span class="mark"></span>
      <span class="title">DeepSeek Harness</span>
    </div>
    <div class="controls">
      <button type="button" data-act="min" aria-label="最小化">
        <svg viewBox="0 0 12 12" width="12" height="12"><rect x="1" y="5.25" width="10" height="1.5" rx="0.4" fill="currentColor"/></svg>
      </button>
      <button type="button" data-act="max" aria-label="最大化">
        <svg viewBox="0 0 12 12" width="12" height="12"><rect x="2.2" y="2.2" width="7.6" height="7.6" rx="0.6" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>
      </button>
      <button type="button" class="close" data-act="close" aria-label="关闭">
        <svg viewBox="0 0 12 12" width="12" height="12"><path d="M2.4 2.4l7.2 7.2M9.6 2.4L2.4 9.6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
      </button>
    </div>
  \`;
  document.body.prepend(bar);
  const api = window.desktop;
  bar.querySelector('.drag')?.addEventListener('dblclick', () => { api?.maximize(); });
  bar.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-act]');
    if (!btn || !api) return;
    const act = btn.getAttribute('data-act');
    if (act === 'min') api.minimize();
    if (act === 'max') api.maximize();
    if (act === 'close') api.close();
  });
})()
`
