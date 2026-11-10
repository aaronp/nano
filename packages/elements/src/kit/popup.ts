// Pop-ups are [popover] elements: in the top layer, so a docked panel's overflow never clips them. These place one
// against its anchor (below it, or above when there's no room) or at a point (a context menu).

/** Shows `pop` under `anchor` (at least as wide), or at `at` in viewport coordinates. */
export function place(pop: HTMLElement, anchor: Element, at?: { x: number; y: number }) {
  try { pop.showPopover?.() } catch { /* already open, or not in the document */ }
  const r = at ? { left: at.x, top: at.y, bottom: at.y, width: 0 } : anchor.getBoundingClientRect()
  const w = pop.offsetWidth, h = pop.offsetHeight
  pop.style.minWidth = r.width ? `${r.width}px` : ''
  pop.style.left = `${Math.max(4, Math.min(r.left, innerWidth - w - 4))}px`
  pop.style.top = `${r.bottom + 4 + h > innerHeight && r.top - h - 4 > 0 ? r.top - h - 4 : r.bottom + 4}px`
}

/** Hides `pop` if it's showing. */
export const hide = (pop: HTMLElement) => { try { pop.hidePopover?.() } catch { /* not open */ } }
