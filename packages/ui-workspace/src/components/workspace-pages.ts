/**
 * The workspace's pages, shown from the Platform's document (ADR-0038): one nav row (a drag handle for edit mode, then
 * its link), one route and one dock of Main's widgets per page, in nav order (lib/pages.ts: Main, then `meta.order`);
 * Main is the page `workspace` at /workspace, its row and dock in index.html. The Platform's changes mount, unmount,
 * relabel and reorder them, whoever made them (this nav, a pod through HostPlatform, an import). A page's id is its
 * route and never changes; a rename changes its `meta.title`. Each dock keeps its page (dock/page-docks.ts: its state
 * the page's `layout`, its panels the page's slots). Beside the app's title, + makes an empty page and ✎ toggles the
 * nav's edit mode (nav-edit.ts); the dock's "Save as workspace…" copies a page (its slots and arrangement) into
 * "<title> copy". Each edit is one `next`, applied by `applyPages` (the workspace's rules checked first).
 */
import type { Page, Platform, UIDeployment } from '@pritzlaff/nano-platform';
import { ICONS } from '../lib/icons.ts';
import { applyPages, metaOf, ordered, slugPath, MAIN } from '../lib/pages.ts';
import { showStatus } from '../lib/status.ts';
import { keepDocks } from '../dock/page-docks.ts';
import { navEdit } from './nav-edit.ts';
import type { WorkspaceDock } from './workspace-dock.ts';
import type { Wires } from '../wires/wires.ts';

type Row = { id: string; title: string; icon?: string };
/** Page `id` of `d` as its nav row shows it. */
const rowOf = (d: UIDeployment, id: string): Row => { const m = metaOf(d.pages[id]); return { id, title: m.title ?? id, ...(m.icon !== undefined && { icon: m.icon }) }; };
const MAIN_ICON = 'panels';   // Main's icon until one is chosen
const mainDock = (doc: Document) => doc.querySelector<WorkspaceDock>('workspace-dock#workspace');
const idOf = (id: string) => `ws_${id}`;

const button = (doc: Document, action: string, label: string, text: string) => {
  const b = doc.createElement('button');
  b.type = 'button'; b.dataset[action] = ''; b.setAttribute('aria-label', label); b.title = label; b.textContent = text;
  return b;
};

/** A nav link's content: its icon (named in data-icon) and its name, which edit mode makes controls; the title is the rail's tooltip. */
const label = (a: HTMLAnchorElement, title: string, icon: string) => {
  a.innerHTML = `<span data-glyph><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${Object.hasOwn(ICONS, icon) ? ICONS[icon] : ''}"/></svg></span><span data-name></span>`;
  a.querySelector('[data-name]')!.textContent = title;
  a.dataset.icon = icon; a.title = title;
};

/** A page's nav row: its drag handle (shown in edit mode), then its link. */
const fill = (doc: Document, row: HTMLElement, p: Row) => {
  const a = doc.createElement('a'), handle = button(doc, 'handle', `Move ${p.title}`, '⠿');
  a.href = `#/${p.id}`;
  label(a, p.title, p.icon ?? 'window');
  handle.draggable = true;
  row.dataset.saved = p.id;
  row.replaceChildren(handle, a);
};

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
  route.setAttribute('path', `/${p.id}`); route.setAttribute('bleed', ''); route.hidden = true;   // app-shell shows it when current
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

/** Shows the Platform's pages, and handles +, edits in the nav and the dock's "Save as workspace…". */
export function bootWorkspacePages(doc: Document, platform: ReturnType<typeof Platform.create>): void {
  doc.querySelector('[slot="title"]')?.append(button(doc, 'newWorkspace', 'New workspace', '+'), button(doc, 'editNav', 'Edit workspaces', '✎'));
  doc.querySelector('[data-edit-nav]')?.setAttribute('aria-pressed', 'false');
  const rows = () => [...doc.querySelectorAll<HTMLElement>('[data-saved]')];
  const taken = () => [...doc.querySelectorAll('app-route')].map((r) => r.getAttribute('path') ?? '');

  const apply = (next: UIDeployment) => { const r = applyPages(platform, next); if (!r.ok) showStatus(doc, r.fail.reason); return r.ok; };
  /** Makes the nav, routes and docks what the Platform holds: new pages mounted, gone ones unmounted, titles and icons relabelled, order kept. */
  const sync = () => {
    const d = platform.document().doc, [main, ...rest] = ordered(d).map((id) => rowOf(d, id));
    for (const row of rows()) if (!rest.some((p) => p.id === row.dataset.saved)) {
      const id = row.dataset.saved!;
      row.remove(); [...doc.querySelectorAll('app-route')].find((r) => r.getAttribute('path') === `/${id}`)?.remove();   // by value: no selector to escape
      if (location.hash === `#/${id}`) location.hash = `#/${MAIN}`;
    }
    let prev = doc.querySelector('[data-workspaces]');
    for (const p of rest) {
      let row = rows().find((r) => r.dataset.saved === p.id);
      if (!row) { mountWorkspace(doc, p); row = rows().find((r) => r.dataset.saved === p.id); }
      const a = row?.querySelector('a');
      if (row && a && (a.dataset.icon !== (p.icon ?? 'window') || a.title !== p.title)) fill(doc, row, p);
      if (row && prev && prev.nextElementSibling !== row) prev.after(row);
      prev = row ?? prev;
    }
    const link = doc.querySelector<HTMLAnchorElement>('[data-workspaces] > a');
    if (link && main && (link.title !== main.title || link.dataset.icon !== (main.icon ?? MAIN_ICON))) label(link, main.title, main.icon ?? MAIN_ICON);
  };
  platform.listen(sync);
  sync();
  keepDocks(doc, platform);
  const edit = navEdit(doc, platform, (row, title, icon) => {
    const d = platform.document().doc, id = row.dataset.saved ?? MAIN, p = d.pages[id];
    if (p) apply({ pages: { ...d.pages, [id]: { ...p, meta: { ...metaOf(p), title, icon } } } });
  });

  /** A new page, last: `page` under a new id slugged from `title`; then its rename. */
  const add = (title: string, icon: string | undefined, page: Page) => {
    const id = slugPath(title, taken()).slice(1), d = platform.document().doc;
    const order = Math.max(0, ...Object.values(d.pages).map((p) => metaOf(p).order ?? 0)) + 1;
    if (!apply({ pages: { ...d.pages, [id]: { ...page, meta: { title, ...(icon !== undefined && { icon }), order } } } })) return;
    location.hash = `#/${id}`;
    edit.rename(rows().find((r) => r.dataset.saved === id)!);
  };

  doc.addEventListener('click', (e) => {
    if ((e.target as Element | null)?.closest?.('[data-new-workspace]')) add('New workspace', 'window', { slots: {} });
  });
  doc.addEventListener('dock:save-as', (e) => {
    const dock = e.target as WorkspaceDock, id = dock.closest('app-route')?.getAttribute('path')?.slice(1) ?? '', src = platform.document().doc.pages[id];
    if (src) { const r = rowOf(platform.document().doc, id); add(`${r.title} copy`, r.icon, { slots: src.slots, layout: dock.arrangement() }); }
  });
}
