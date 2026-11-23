/**
 * <nano-picker>: a popover, anchored at the control that opened it, for choosing what fills a place: picker-grid.ts's
 * content (a focused filter, runtime pills, the providers' tiles, Views). Light DOM; `pick` makes and awaits it, and
 * closes it on Esc, a press outside, focus leaving, or the page changing.
 */
import { pickerGrid } from './picker-grid.ts';

class NanoPicker extends HTMLElement {}
if (!customElements.get('nano-picker')) customElements.define('nano-picker', NanoPicker);

type Entries = Parameters<typeof pickerGrid>[1];
const WIDTH = 280;   // app.css

/** Opens the picker at `anchor`; resolves with the chosen tile (and runtime), or null on Esc / a press outside. */
export function pick(anchor: HTMLElement, entries: Entries): ReturnType<typeof pickerGrid> {
  const doc = anchor.ownerDocument, p = doc.createElement('nano-picker'), r = anchor.getBoundingClientRect();
  p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', 'Add a component');
  p.style.left = `${Math.max(8, Math.min(r.left, innerWidth - WIDTH - 8))}px`; p.style.top = `${r.bottom + 4}px`;
  doc.body.append(p);
  const grid = pickerGrid(p, entries);
  p.querySelector<HTMLElement>('.np-filter')!.focus();
  // no room below the anchor: above it, kept in view
  if (r.bottom + 4 + p.offsetHeight > innerHeight - 8) p.style.top = `${Math.max(8, r.top - 4 - p.offsetHeight)}px`;

  return new Promise((resolve) => {
    const close = (choice: Awaited<typeof grid>) => {
      p.remove();
      doc.removeEventListener('pointerdown', outside, true); doc.defaultView?.removeEventListener('hashchange', gone);
      resolve(choice);
    };
    const outside = (e: Event) => { if (!p.contains(e.target as Node | null)) close(null); }, gone = () => close(null);   // gone: the page changed (Back)
    void grid.then(close);
    p.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault(); e.stopPropagation();
      close(null);
      if (anchor.isConnected) anchor.focus();
    });
    p.addEventListener('focusout', (e) => { if (e.relatedTarget instanceof Node && !p.contains(e.relatedTarget)) close(null); });
    doc.addEventListener('pointerdown', outside, true); doc.defaultView?.addEventListener('hashchange', gone);
  });
}
