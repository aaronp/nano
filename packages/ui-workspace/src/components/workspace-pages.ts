/**
 * The workspace's pages, shown from the Outline's document (ADR-0038, ADR-0040): one nav row (nav-tree.ts: indented by
 * its level, a parent's collapsible), one route (`routeOf`) and one dock of Main's widgets per page, in the tree's order
 * (lib/pages.ts `walk`); Main is the page `workspace` at /workspace, its row (filled here like the others) and dock in
 * index.html. A row's Add child (edit mode) makes an empty page its last child. The Outline's changes mount, unmount,
 * relabel and reorder them, whoever made them (this nav, a pod through HostOutline, an import). A page's id is its
 * route and never changes; a rename changes its `title`. Each dock keeps its page (dock/page-docks.ts: its state
 * the page's `layout`, its panels the page's slots). Beside the app's title, + makes an empty page and ✎ toggles the
 * nav's edit mode (nav-edit.ts); the dock's "Save as workspace…" copies a page (its slots and arrangement) into
 * "<title> copy", its next sibling. Each edit is one `next`, applied by `applyPages` (the workspace's rules checked first).
 */
import type { Page, Outline } from '@pritzlaff/nano-outline';
import { applyPages, childrenOf, metaOf, move, parentOf, routeOf, slugPath, walk, withMeta, MAIN } from '../lib/pages.ts';
import { showStatus } from '../lib/status.ts';
import { keepDocks } from '../dock/page-docks.ts';
import { navEdit } from './nav-edit.ts';
import { navMoves } from './nav-moves.ts';
import { button, fill, navTree, type Row } from './nav-tree.ts';
import type { WorkspaceDock } from './workspace-dock.ts';
import type { Wires } from '../wires/wires.ts';

/** Page `id` of `d` as its nav row shows it. */
const rowOf = (d: Outline, id: string): Row => { const m = metaOf(d.pages[id]); return { id, title: d.pages[id]?.title ?? id, ...(m.icon !== undefined && { icon: m.icon }) }; };
const mainDock = (doc: Document) => doc.querySelector<WorkspaceDock>('workspace-dock#workspace');
const idOf = (id: string) => `ws_${id}`;

/** Adds a page's nav row (after Main's row, or the last saved one) and its route (before the not-found page). */
export function mountWorkspace(doc: Document, p: Row): void {
  const main = mainDock(doc), mainRoute = main?.closest('app-route');
  if (!main || !mainRoute) return;
  const row = doc.createElement('div');
  row.slot = 'nav'; row.className = 'nav-row';
  fill(doc, row, p);
  const saved = doc.querySelectorAll('.nav-row[data-saved]');
  (saved[saved.length - 1] ?? doc.querySelector('[data-workspaces]'))?.after(row);

  const route = doc.createElement('app-route');
  route.setAttribute('path', routeOf(p.id)); route.setAttribute('bleed', ''); route.hidden = true;   // app-shell shows it when current
  const pane = doc.createElement('div');
  pane.className = 'ws-page';
  const wires = doc.createElement('c-wires') as Wires, dock = doc.createElement('workspace-dock') as WorkspaceDock;
  // made after start (+, Save as, a pod): the page's host, which main.ts gave Main's dock, before they connect
  if (main.host) { dock.host = main.host; wires.host = main.host; }
  dock.id = idOf(p.id);
  dock.setAttribute('storage-key', p.id);
  dock.setAttribute('open', '');   // a new page starts empty; a saved layout, if any, wins
  for (const t of main.querySelectorAll(':scope > template[data-widget]')) dock.append(t.cloneNode(true));
  wires.append(dock); pane.append(wires); route.append(pane);
  const fallback = mainRoute.parentElement?.querySelector(':scope > app-route[path="*"]');
  if (fallback) fallback.before(route); else mainRoute.parentElement?.append(route);
}

/** Shows the Outline's pages, and handles +, edits in the nav and the dock's "Save as workspace…". */
export function bootWorkspacePages(doc: Document, outline: ReturnType<typeof Outline.create>): void {
  doc.querySelector('[slot="title"]')?.append(button(doc, 'newWorkspace', 'New workspace', '+'), button(doc, 'editNav', 'Edit workspaces', '✎'));
  doc.querySelector('[data-edit-nav]')?.setAttribute('aria-pressed', 'false');
  const rows = () => [...doc.querySelectorAll<HTMLElement>('[data-saved]')];
  /** The ids a new page's id avoids (as `/<id>`): every page's. */
  const taken = () => Object.keys(outline.document().doc.pages).map((id) => `/${id}`);

  const apply = (next: Outline) => { const r = applyPages(outline, next); if (!r.ok) showStatus(doc, r.fail.reason); return r.ok; };
  const tree = navTree(doc, outline);
  /** Makes the nav, routes and docks what the Outline holds: new pages mounted, gone ones unmounted, titles and icons relabelled, the tree's order and levels kept. */
  const sync = () => {
    const d = outline.document().doc, pages = walk(d).map((id) => rowOf(d, id));
    for (const row of rows()) if (!pages.some((p) => p.id === row.dataset.saved)) {
      const id = row.dataset.saved!;
      row.remove(); [...doc.querySelectorAll('app-route')].find((r) => r.getAttribute('path') === routeOf(id))?.remove();   // by value: no selector to escape
      if (location.hash === `#${routeOf(id)}`) location.hash = `#${routeOf(MAIN)}`;
    }
    let prev: Element | null = null;
    for (const p of pages) {
      const find = () => (p.id === MAIN ? doc.querySelector<HTMLElement>('[data-workspaces]') : rows().find((r) => r.dataset.saved === p.id));
      let row = find();
      if (!row && p.id !== MAIN) { mountWorkspace(doc, p); row = find(); }   // Main's row and route are index.html's
      if (!row) continue;
      fill(doc, row, p);
      if (prev && prev.nextElementSibling !== row) prev.after(row);
      prev = row;
    }
    tree.show();
  };
  outline.listen(sync);
  sync();
  keepDocks(doc, outline);
  navMoves(doc, outline, tree.reveal);
  const edit = navEdit(doc, outline, (row, title, icon) => {
    const d = outline.document().doc, id = row.dataset.saved ?? MAIN, p = d.pages[id];
    if (p) apply({ ...d, pages: { ...d.pages, [id]: withMeta({ ...p, title }, { ...metaOf(p), icon }) } });
  });

  /** A new page at `index` (default: the last) of `parent`'s children (undefined: the roots): `page` under a new id slugged from `title`; then its rename. */
  const add = (title: string, icon: string | undefined, page: Page, parent?: string, index?: number) => {
    const id = slugPath(title, taken()).slice(1), d = outline.document().doc;
    const next = move({ roots: [...d.roots, id], pages: { ...d.pages, [id]: withMeta({ ...page, title }, { ...(icon !== undefined && { icon }) }) } }, id, parent, index ?? childrenOf(d, parent).length);
    if (!next || !apply(next)) return;
    tree.reveal(id);
    location.hash = `#${routeOf(id)}`;
    edit.rename(rows().find((r) => r.dataset.saved === id)!);
  };

  doc.addEventListener('click', (e) => {
    const t = e.target as Element | null, under = t?.closest?.('[data-add-child]')?.closest<HTMLElement>('[data-saved]')?.dataset.saved;
    if (t?.closest?.('[data-new-workspace]')) add('New workspace', 'window', { slots: {} });
    else if (under !== undefined) add('New workspace', 'window', { slots: {} }, under);
  });
  doc.addEventListener('dock:save-as', (e) => {
    const dock = e.target as WorkspaceDock, at = dock.closest('app-route')?.getAttribute('path'), d = outline.document().doc, id = Object.keys(d.pages).find((p) => routeOf(p) === at);
    if (id) { const r = rowOf(d, id), parent = parentOf(d, id); add(`${r.title} copy`, r.icon, { slots: d.pages[id]!.slots, layout: { workspace: dock.arrangement() } }, parent, childrenOf(d, parent).indexOf(id) + 1); }   // the page only, not its children
  });
}
