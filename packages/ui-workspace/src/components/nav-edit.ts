/**
 * The nav's edit mode: ✎ beside the app's title toggles [data-editing] on <app-shell>, Esc leaves. A workspace row's
 * name, clicked, becomes an input (Enter or blur keeps, Esc cancels, empty keeps the old); its icon opens a grid of
 * ICONS; a row's Remove (not Main's) removes its page and the pages under it (`without`, after asking if there are any;
 * pods are left alone; focus goes to the row shown before it). `save` keeps a row's new title and icon; the Outline's
 * change relabels the nav. Moves are nav-moves.ts's, rows and toggles nav-tree.ts's.
 */
import type { Outline } from '@pritzlaff/nano-outline';
import { ICONS } from '../lib/icons.ts';
import { applyPages, subtree, without } from '../lib/pages.ts';
import { askConfirm } from './name-dialog.ts';

const ROW = '[data-saved]';
const nameOf = (row: Element) => row.querySelector('[data-name]')?.textContent ?? '';

export function navEdit(doc: Document, outline: ReturnType<typeof Outline.create>, save: (row: HTMLElement, title: string, icon: string) => void) {
  const editing = () => doc.querySelector('app-shell[data-editing]') !== null;
  outline.listen(() => controls());   // a page changed from elsewhere is relabelled: its controls come back
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
  const commit = (row: HTMLElement, title: string, icon: string, refocus = true) => {
    save(row, title, icon);
    row.parentNode?.insertBefore(row, row.nextSibling);
    controls();
    if (refocus && editing()) row.querySelector<HTMLElement>('[data-name]')?.focus();
  };
  /** The row's name as an input, in place. */
  const rename = (row: HTMLElement) => {
    const a = row.querySelector<HTMLAnchorElement>(':scope > a'), span = a?.querySelector('[data-name]');
    if (!a || !span) return;
    const old = span.textContent ?? '', input = doc.createElement('input');
    input.value = old; input.dataset.rename = ''; input.setAttribute('aria-label', 'Workspace name');
    let done = false;
    const end = (keep: boolean, refocus: boolean) => {   // a blur leaves focus where it went
      if (done) return; done = true;
      const title = input.value.trim();
      input.replaceWith(span);
      if (keep && title && title !== old) commit(row, title, a.dataset.icon ?? '', refocus);
      else { controls(); if (refocus && editing()) (span as HTMLElement).focus(); }
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); end(true, true); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); end(false, true); }
    });
    input.addEventListener('blur', () => end(true, false));
    input.addEventListener('click', (e) => e.preventDefault());   // inside the link: typing is not navigating
    span.replaceWith(input);
    input.focus(); input.select();
  };
  /** The icon grid, anchored under the row's icon. */
  let pop: HTMLElement | null = null;
  // cleared first: removing the focused grid fires focusout at once, which must not remove it again
  const closePop = () => { const p = pop; pop = null; p?.remove(); };
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
    p.addEventListener('mousedown', (e) => e.preventDefault());   // a click keeps focus inside (Safari doesn't focus buttons)
    p.addEventListener('focusout', (e) => { if (pop === p && !p.contains(e.relatedTarget as Node | null)) closePop(); });
    doc.body.append(p);
    (p.querySelector<HTMLElement>('[aria-selected="true"]') ?? p.querySelector('button'))?.focus();
  };
  const open = (t: Element, row: HTMLElement, a: HTMLAnchorElement) => {
    if (t.closest('[data-name]')) rename(row); else if (t.closest('[data-glyph]')) pick(row, a);
  };
  const remove = async (row: HTMLElement) => {
    const id = row.dataset.saved!, n = subtree(outline.document().doc, id).length - 1;
    if (n && !(await askConfirm(doc, `Remove ${nameOf(row)} and its ${n} page${n === 1 ? '' : 's'}?`, 'Remove'))) return;
    let before = row.previousElementSibling as HTMLElement | null;
    while (before?.hidden) before = before.previousElementSibling as HTMLElement | null;
    const next = without(outline.document().doc, id);
    if (next && applyPages(outline, next).ok) before?.querySelector<HTMLElement>('[data-name]')?.focus();
  };
  doc.addEventListener('click', (e) => {
    const t = e.target as Element | null;
    if (pop && !pop.contains(t)) closePop();
    if (t?.closest?.('[data-edit-nav]')) return setEditing(!editing());
    const gone = t?.closest?.('[data-remove]')?.closest<HTMLElement>(ROW);
    if (gone && editing()) return void remove(gone);
    const row = t?.closest?.<HTMLElement>(ROW), a = t?.closest?.<HTMLAnchorElement>('a');
    if (!editing() || !row || !a || !row.contains(a)) return;
    e.preventDefault();   // in edit mode a workspace link edits, it does not navigate
    open(t!, row, a);
  });

  doc.addEventListener('keydown', (e) => {
    const t = e.target as Element | null;
    if (e.key === 'Escape' && editing() && !e.defaultPrevented && !t?.closest?.('dialog')) { closePop(); setEditing(false); return; }
    const ctl = t?.closest?.('[data-glyph][role="button"], [data-name][role="button"]'), own = ctl?.closest<HTMLElement>(ROW);
    if (ctl && own && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(ctl, own, ctl.closest('a')!); }
  });
  return { rename };
}
