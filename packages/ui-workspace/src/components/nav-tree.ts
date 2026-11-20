/**
 * The nav's rows as the Outline's tree (ADR-0040). A page's row (`fill`) holds its drag handle (not Main's), its toggle,
 * its link (icon and name) and, shown in edit mode, Add child and Remove (not Main's). `navTree` gives each row its
 * level (`data-level`, 1 for a root; app.css indents by `--level`) and keeps which parents are collapsed: local UI
 * state, never in the document. `show` hides the rows under a collapsed parent; `reveal(id)` opens page `id`'s
 * parents, as a route change does for the current page's.
 */
import type { Outline } from '@pritzlaff/nano-outline';
import { ICONS } from '../lib/icons.ts';
import { MAIN, parentOf, routeOf } from '../lib/pages.ts';

/** A page as its nav row shows it. */
export type Row = { id: string; title: string; icon?: string };

export const button = (doc: Document, action: string, label: string, text: string) => {
  const b = doc.createElement('button');
  b.type = 'button'; b.dataset[action] = ''; b.setAttribute('aria-label', label); b.title = label; b.textContent = text;
  return b;
};

/** Page `p`'s row content, (re)made when its title or icon changed: the link's icon (named in data-icon) and name, which edit mode makes controls; the title is the rail's tooltip. */
export const fill = (doc: Document, row: HTMLElement, p: Row) => {
  const main = p.id === MAIN, icon = p.icon ?? (main ? 'panels' : 'window'), was = row.querySelector<HTMLAnchorElement>(':scope > a');
  if (row.dataset.saved === p.id && was?.dataset.icon === icon && was.title === p.title) return;
  const a = doc.createElement('a'), handle = button(doc, 'handle', `Move ${p.title}`, '⠿');
  a.href = `#${routeOf(p.id)}`; a.dataset.icon = icon; a.title = p.title;
  a.innerHTML = `<span data-glyph><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${Object.hasOwn(ICONS, icon) ? ICONS[icon] : ''}"/></svg></span><span data-name></span>`;
  a.querySelector('[data-name]')!.textContent = p.title;
  handle.draggable = true;
  row.dataset.saved = p.id;
  row.replaceChildren(...(main ? [] : [handle]), button(doc, 'toggle', `Pages under ${p.title}`, '▾'), a,
    button(doc, 'addChild', `Add a page under ${p.title}`, '+'), ...(main ? [] : [button(doc, 'remove', `Remove ${p.title}`, '✕')]));
};

export function navTree(doc: Document, outline: ReturnType<typeof Outline.create>) {
  const shut = new Set<string>();
  const show = () => {
    const d = outline.document().doc, rows = new Map([...doc.querySelectorAll<HTMLElement>('[data-saved]')].map((r) => [r.dataset.saved!, r]));
    const visit = (ids: readonly string[], level: number, hidden: boolean): void => { for (const id of ids) {
      const row = rows.get(id), kids = d.pages[id]?.children ?? [], open = !shut.has(id), t = row?.querySelector<HTMLElement>(':scope > [data-toggle]');
      if (row) { row.hidden = hidden; row.dataset.level = String(level); row.style.setProperty('--level', String(level - 1)); }
      if (t) { t.hidden = !kids.length; t.setAttribute('aria-expanded', String(open)); t.textContent = open ? '▾' : '▸'; }
      visit(kids, level + 1, hidden || !open);
    } };
    visit(d.roots, 1, false);
  };
  const reveal = (id: string | undefined) => {
    const d = outline.document().doc;
    for (let p = id === undefined ? undefined : parentOf(d, id); p !== undefined; p = parentOf(d, p)) shut.delete(p);
    show();
  };
  doc.defaultView?.addEventListener('hashchange', () => reveal(Object.keys(outline.document().doc.pages).find((id) => `#${routeOf(id)}` === location.hash)));
  doc.addEventListener('click', (e) => {
    const id = (e.target as Element | null)?.closest?.('[data-toggle]')?.closest<HTMLElement>('[data-saved]')?.dataset.saved;
    if (id === undefined) return;
    if (!shut.delete(id)) shut.add(id);
    show();
  });
  return { show, reveal };
}
