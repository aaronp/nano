/**
 * The workspace's pages, shown from the page store (lib/pages.ts): one nav row (a drag handle for edit mode, then its
 * link), one route and one dock of Main's widgets per page, in store order; Main is the page `workspace` at
 * /workspace, its row and dock in index.html. The store's changes mount, unmount, relabel and reorder them, whoever
 * made them (this nav, a pod through HostPages, an import). A page's id is its route and never changes; a rename
 * changes its title. Each dock still keeps its layout under layoutKey(Main's storage-key, path). Beside the app's
 * title, + makes an empty page and ✎ toggles the nav's edit mode (nav-edit.ts); the dock's "Save as workspace…"
 * copies a page into "<title> copy".
 */
import type { Page } from '@pritzlaff/nano-ui';
import { ICONS } from '../lib/icons.ts';
import { layoutKey, slugPath, type pageStore } from '../lib/pages.ts';
import { templateState } from '../lib/layout-templates.ts';
import { navEdit } from './nav-edit.ts';
import type { WorkspaceDock } from './workspace-dock.ts';
import type { Wires } from '../wires/wires.ts';

const MAIN = 'workspace';
const MAIN_ICON = 'panels';   // Main's icon until one is chosen
const mainDock = (doc: Document) => doc.querySelector<WorkspaceDock>('workspace-dock#workspace');
const mainKey = (doc: Document) => mainDock(doc)?.getAttribute('storage-key') ?? 'workspace';
const idOf = (id: string) => `ws_${id}`;

const button = (doc: Document, action: string, label: string, text: string) => {
  const b = doc.createElement('button');
  b.type = 'button'; b.dataset[action] = ''; b.setAttribute('aria-label', label); b.title = label; b.textContent = text;
  return b;
};

/** A nav link's content: its icon (named in data-icon) and its name, which edit mode makes controls; the title is the rail's tooltip. */
const label = (a: HTMLAnchorElement, title: string, icon: string) => {
  a.innerHTML = `<span data-glyph><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[icon] ?? ''}"/></svg></span><span data-name></span>`;
  a.querySelector('[data-name]')!.textContent = title;
  a.dataset.icon = icon; a.title = title;
};

/** A page's nav row: its drag handle (shown in edit mode), then its link. */
const fill = (doc: Document, row: HTMLElement, p: Page) => {
  const a = doc.createElement('a'), handle = button(doc, 'handle', `Move ${p.title}`, '⠿');
  a.href = `#/${p.id}`;
  label(a, p.title, p.icon ?? 'window');
  handle.draggable = true;
  row.dataset.saved = p.id;
  row.replaceChildren(handle, a);
};

/** Adds a page's nav row (after Main's row, or the last saved one) and its route (before the not-found page). */
export function mountWorkspace(doc: Document, p: Page): void {
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
  dock.setAttribute('storage-key', layoutKey(mainKey(doc), `/${p.id}`));
  dock.setAttribute('open', '');   // a new page starts empty; a saved layout, if any, wins
  for (const t of main.querySelectorAll(':scope > template[data-widget]')) dock.append(t.cloneNode(true));
  wires.append(dock); pane.append(wires); route.append(pane);
  const fallback = mainRoute.parentElement?.querySelector(':scope > app-route[path="*"]');
  if (fallback) fallback.before(route); else mainRoute.parentElement?.append(route);
}

/** Shows the store's pages, and handles +, edits in the nav and the dock's "Save as workspace…". */
export function bootWorkspacePages(doc: Document, store: ReturnType<typeof pageStore>): void {
  doc.querySelector('[slot="title"]')?.append(button(doc, 'newWorkspace', 'New workspace', '+'), button(doc, 'editNav', 'Edit workspaces', '✎'));
  doc.querySelector('[data-edit-nav]')?.setAttribute('aria-pressed', 'false');
  const rows = () => [...doc.querySelectorAll<HTMLElement>('[data-saved]')];
  const taken = () => [...doc.querySelectorAll('app-route')].map((r) => r.getAttribute('path') ?? '');

  /** Makes the nav, routes and docks what the store lists: new pages mounted, gone ones unmounted, titles and icons relabelled, order kept. */
  const sync = () => {
    const [main, ...rest] = store.list();
    for (const row of rows()) if (!rest.some((p) => p.id === row.dataset.saved)) {
      const id = row.dataset.saved!;
      row.remove(); doc.querySelector(`app-route[path="/${id}"]`)?.remove();
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
  store.subscribe(sync);
  sync();
  const edit = navEdit(doc, store, (row, title, icon) => {
    const p = store.get(row.dataset.saved ?? MAIN);
    if (p) store.set({ ...p, title, icon });
  });

  /** A new page: `page` under a new id slugged from its title, empty or with `from`'s arrangement; then its rename. */
  const add = (page: Page, from: WorkspaceDock | null) => {
    const id = slugPath(page.title, taken()).slice(1);
    const key = layoutKey(mainKey(doc), `/${id}`);
    if (from) {   // written first: the page's dock reads its keys as the store's change mounts it
      const { template, ...layout } = from.arrangement();
      try { localStorage.setItem(key, JSON.stringify(layout)); } catch { /* no storage: it starts empty */ }
      templateState(localStorage, key).set(template ?? null);
    }
    if (!store.set({ ...page, id }).ok) {   // refused: no orphan keys
      for (const x of ['', '.template']) try { localStorage.removeItem(key + x); } catch { /* none */ }
      return;
    }
    location.hash = `#/${id}`;
    edit.rename(doc.querySelector<HTMLElement>(`[data-saved="${id}"]`)!);
  };

  doc.addEventListener('click', (e) => {
    if ((e.target as Element | null)?.closest?.('[data-new-workspace]')) add({ id: '', title: 'New workspace', icon: 'window', slots: [] }, null);
  });
  doc.addEventListener('dock:save-as', (e) => {
    const dock = e.target as WorkspaceDock, src = store.get(dock.closest('app-route')?.getAttribute('path')?.slice(1) ?? '');
    if (src) add({ ...src, title: `${src.title} copy` }, dock);
  });
}
