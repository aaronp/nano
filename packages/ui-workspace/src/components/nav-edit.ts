/**
 * The nav's edit mode: ✎ beside the app's title toggles [data-editing] on <app-shell>, Esc leaves. A workspace row's
 * name, clicked, becomes an input (Enter or blur keeps, Esc cancels, empty keeps the old); its icon opens a grid of
 * ICONS; a saved row's handle reorders it, by drag or Alt+↑/↓ (announced). `save` keeps a row's new title and icon;
 * the nav follows the saved list's order.
 */
import { ICONS, savedWorkspaces } from '../lib/saved-workspaces.ts';

const ROW = '[data-workspaces], [data-saved]';
const nameOf = (row: Element) => row.querySelector('[data-name]')?.textContent ?? '';

export function navEdit(doc: Document, save: (row: HTMLElement, title: string, icon: string) => void) {
  const store = savedWorkspaces(localStorage);
  const editing = () => doc.querySelector('app-shell[data-editing]') !== null;
  const setEditing = (on: boolean) => {
    doc.querySelector('app-shell')?.toggleAttribute('data-editing', on);
    doc.querySelector('[data-edit-nav]')?.setAttribute('aria-pressed', String(on));
    controls();
  };
  /** In edit mode a row's icon and name are buttons: focusable, named, opened by click, Enter or Space. */
  const controls = () => {
    for (const row of doc.querySelectorAll(ROW)) for (const [sel, what] of [['[data-glyph]', 'Change icon of'], ['[data-name]', 'Rename']]) {
      const el = row.querySelector(`:scope > a ${sel}`);
      if (el && editing()) { el.setAttribute('role', 'button'); el.setAttribute('tabindex', '0'); el.setAttribute('aria-label', `${what} ${nameOf(row)}`); }
      else for (const x of ['role', 'tabindex', 'aria-label']) el?.removeAttribute(x);
    }
  };
  /** Saves, then puts the row back in place (re-slotted, so <app-shell> re-marks the nav and the bar's label). */
  const commit = (row: HTMLElement, title: string, icon: string) => {
    save(row, title, icon);
    row.parentNode?.insertBefore(row, row.nextSibling);
    controls();
    if (editing()) row.querySelector<HTMLElement>('[data-name]')?.focus();
  };
  /** The row's name as an input, in place. */
  const rename = (row: HTMLElement) => {
    const a = row.querySelector<HTMLAnchorElement>(':scope > a'), span = a?.querySelector('[data-name]');
    if (!a || !span) return;
    const old = span.textContent ?? '', input = doc.createElement('input');
    input.value = old; input.dataset.rename = ''; input.setAttribute('aria-label', 'Workspace name');
    let done = false;
    const end = (keep: boolean) => {
      if (done) return; done = true;
      const title = input.value.trim();
      input.replaceWith(span);
      if (keep && title && title !== old) commit(row, title, a.dataset.icon ?? '');
      else { controls(); if (editing()) (span as HTMLElement).focus(); }
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); end(true); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); end(false); }
    });
    input.addEventListener('blur', () => end(true));
    input.addEventListener('click', (e) => e.preventDefault());   // inside the link: typing is not navigating
    span.replaceWith(input);
    input.focus(); input.select();
  };
  /** The icon grid, anchored under the row's icon. */
  let pop: HTMLElement | null = null;
  const closePop = () => { pop?.remove(); pop = null; };
  const pick = (row: HTMLElement, a: HTMLAnchorElement) => {
    const glyph = a.querySelector<HTMLElement>('[data-glyph]')!, p = pop = doc.createElement('div'), r = glyph.getBoundingClientRect();
    p.className = 'icon-pop'; p.setAttribute('role', 'listbox'); p.setAttribute('aria-label', `Icon for ${nameOf(row)}`);
    p.innerHTML = Object.keys(ICONS).map((k) => `<button type="button" role="option" data-icon="${k}" aria-label="${k}" title="${k}"
      aria-selected="${k === a.dataset.icon}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[k]}"/></svg></button>`).join('');
    p.style.left = `${r.left}px`; p.style.top = `${r.bottom + 4}px`;
    p.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLElement>('[data-icon]');
      if (b) { closePop(); commit(row, nameOf(row), b.dataset.icon!); }
    });
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -6, ArrowDown: 6 };   // 6 columns (app.css)
    p.addEventListener('keydown', (e) => {
      const all = [...p.querySelectorAll<HTMLElement>('button')], i = all.indexOf(e.target as HTMLElement);
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePop(); glyph.focus(); }
      else if (e.key in step && i >= 0) { e.preventDefault(); all[Math.max(0, Math.min(all.length - 1, i + step[e.key]!))]!.focus(); }
    });
    p.addEventListener('focusout', (e) => { if (pop === p && !p.contains(e.relatedTarget as Node | null)) closePop(); });
    doc.body.append(p);
    (p.querySelector<HTMLElement>('[aria-selected="true"]') ?? p.querySelector('button'))?.focus();
  };
  const open = (t: Element, row: HTMLElement, a: HTMLAnchorElement) => {
    if (t.closest('[data-name]')) rename(row); else if (t.closest('[data-glyph]')) pick(row, a);
  };
  doc.addEventListener('click', (e) => {
    const t = e.target as Element | null;
    if (pop && !pop.contains(t)) closePop();
    if (t?.closest?.('[data-edit-nav]')) return setEditing(!editing());
    const row = t?.closest?.<HTMLElement>(ROW), a = t?.closest?.<HTMLAnchorElement>('a');
    if (!editing() || !row || !a || !row.contains(a)) return;
    e.preventDefault();   // in edit mode a workspace link edits, it does not navigate
    open(t!, row, a);
  });

  // Reorder: Alt+↑/↓ on a focused handle, or drag a handle onto another saved row. Main stays first.
  const live = doc.createElement('div');
  live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite');
  live.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)';
  doc.body.append(live);
  const index = (path: string) => store.list().findIndex((w) => w.path === path);
  const arrange = () => {
    let prev = doc.querySelector('[data-workspaces]');
    for (const w of store.list()) {
      const r = doc.querySelector(`[data-saved="${w.path}"]`);
      if (r && prev && prev.nextElementSibling !== r) prev.after(r);
      prev = r ?? prev;
    }
  };
  const savedRow = (t: EventTarget | null) => (t as Element | null)?.closest?.<HTMLElement>('[data-saved]') ?? null;
  doc.addEventListener('keydown', (e) => {
    const t = e.target as Element | null;
    if (e.key === 'Escape' && editing() && !e.defaultPrevented && !t?.closest?.('dialog')) { closePop(); setEditing(false); return; }
    const ctl = t?.closest?.('[data-glyph][role="button"], [data-name][role="button"]'), own = ctl?.closest<HTMLElement>(ROW);
    if (ctl && own && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); return open(ctl, own, ctl.closest('a')!); }
    const handle = (e.target as Element | null)?.closest?.<HTMLElement>('[data-handle]'), row = savedRow(handle ?? null);
    if (!handle || !row || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const up = e.key === 'ArrowUp', path = row.dataset.saved!;
    if (!store.move(path, index(path) + (up ? -1 : 1))) return;
    arrange(); handle.focus();
    live.textContent = '';   // cleared first so a repeat is announced again
    setTimeout(() => { live.textContent = `Moved ${nameOf(row)} ${up ? 'up' : 'down'}`; }, 50);
  });
  let dragged = '';
  const clear = () => { for (const x of doc.querySelectorAll('[data-drop]')) x.removeAttribute('data-drop'); };
  doc.addEventListener('dragstart', (e) => {
    const row = savedRow((e.target as Element | null)?.closest?.('[data-handle]') ?? null);
    if (!row) return;
    dragged = row.dataset.saved!;
    e.dataTransfer?.setData('text/plain', dragged);
    e.dataTransfer?.setDragImage(row, 0, 0);
  });
  doc.addEventListener('dragover', (e) => {
    const row = savedRow(e.target);
    if (!dragged || !row) return;
    e.preventDefault(); clear();
    // it lands where the target is: above it from below, below it from above
    if (row.dataset.saved !== dragged) row.dataset.drop = index(dragged) > index(row.dataset.saved!) ? 'before' : 'after';
  });
  doc.addEventListener('drop', (e) => {
    const row = savedRow(e.target);
    if (!dragged || !row) return;
    e.preventDefault();   // dropping on a link must not navigate
    if (store.move(dragged, index(row.dataset.saved!))) arrange();
    dragged = ''; clear();
  });
  doc.addEventListener('dragend', () => { dragged = ''; clear(); });
  return { rename };
}
