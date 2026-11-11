/** A small dismissible message for the person (`role="status"`), one at a time: what start-up or autosave could not do. */
export function showStatus(doc: Document, text: string) {
  let el = doc.querySelector<HTMLElement>('[data-nano-status]')
  if (!el) {
    el = doc.createElement('div'); el.setAttribute('data-nano-status', ''); el.setAttribute('role', 'status')
    el.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:1000;max-width:min(40rem,calc(100vw - 24px));display:flex;gap:8px;align-items:flex-start;padding:8px 12px;border:1px solid var(--nano-border,currentColor);border-radius:6px;background:var(--nano-surface,Canvas);color:var(--nano-fg,CanvasText);font:14px/1.4 system-ui,sans-serif'
    const msg = doc.createElement('span'), b = doc.createElement('button')
    b.type = 'button'; b.textContent = 'Dismiss'; b.addEventListener('click', () => el!.remove())
    el.append(msg, b); doc.body.append(el)
  }
  // the region exists empty first, so a screen reader announces the text set on the next frame
  const msg = el.firstElementChild!, set = () => { msg.textContent = text }
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(set); else setTimeout(set, 16)
}
