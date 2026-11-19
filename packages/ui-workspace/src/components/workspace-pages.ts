/**
 * Saved workspace pages: each a nav row (a drag handle for edit mode, then its link) and a route holding a components
 * drawer beside a dock of Main's widgets, its layout under layoutKey(Main's storage-key, path). Saved ones are mounted at
 * start, before <app-shell> reads its routes. Beside the app's title, + makes an empty page and ✎ toggles the nav's edit
 * mode (nav-edit.ts); the dock's "Save as workspace…" copies a page into "<title> copy". Routes follow titles.
 */
import { ICONS, layoutKey, savedWorkspaces, slugPath, type SavedWorkspace } from '../lib/saved-workspaces.ts';
import { templateState } from '../lib/layout-templates.ts';
import { navEdit } from './nav-edit.ts';
import type { WorkspaceDock } from './workspace-dock.ts';
import type { Wires } from '../wires/wires.ts';

const MAIN_ICON = 'panels';   // Main's icon until one is chosen
const mainDock = (doc: Document) => doc.querySelector<WorkspaceDock>('workspace-dock#workspace');
const mainKey = (doc: Document) => mainDock(doc)?.getAttribute('storage-key') ?? 'workspace';
const idOf = (path: string) => `ws${path.replace(/\//g, '_')}`;   // _ is never in a path: /a/b and /a-b differ
const pageDock = (doc: Document, path: string) => doc.querySelector<WorkspaceDock>(`app-route[path="${path}"] workspace-dock`);

const button = (doc: Document, action: string, label: string, text: string) => {
  const b = doc.createElement('button');
  b.type = 'button'; b.dataset[action] = ''; b.setAttribute('aria-label', label); b.title = label; b.textContent = text;
  return b;
};

/** A nav link's content: its icon (named in data-icon) and its name; the title is the rail's tooltip. */
const label = (a: HTMLAnchorElement, title: string, icon: string) => {
  a.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[icon] ?? ''}"/></svg><span data-name></span>`;
  a.querySelector('[data-name]')!.textContent = title;
  a.dataset.icon = icon; a.title = title;
};

/** A saved page's nav row: its drag handle (shown in edit mode), then its link. */
const fill = (doc: Document, row: HTMLElement, ws: SavedWorkspace) => {
  const a = doc.createElement('a'), handle = button(doc, 'handle', `Move ${ws.title}`, '⠿');
  a.href = `#${ws.path}`;
  label(a, ws.title, ws.icon);
  handle.draggable = true;
  row.dataset.saved = ws.path;
  row.replaceChildren(handle, a);
};

/** Adds a saved page's nav row (after Main's row, or the last saved one) and its route (before the not-found page). */
export function mountWorkspace(doc: Document, ws: SavedWorkspace): void {
  const main = mainDock(doc), mainRoute = main?.closest('app-route');
  if (!main || !mainRoute) return;
  const row = doc.createElement('div');
  row.slot = 'nav'; row.className = 'nav-row';
  fill(doc, row, ws);
  const saved = doc.querySelectorAll('.nav-row[data-saved]');
  (saved[saved.length - 1] ?? doc.querySelector('[data-workspaces]'))?.after(row);

  const route = doc.createElement('app-route');
  route.setAttribute('path', ws.path); route.setAttribute('bleed', ''); route.hidden = true;   // app-shell shows it when current
  const id = idOf(ws.path);
  const pane = doc.createElement('div'), drawer = doc.createElement('component-drawer');
  pane.className = 'ws-page';
  drawer.setAttribute('for', id);
  const wires = doc.createElement('c-wires') as Wires, dock = doc.createElement('workspace-dock') as WorkspaceDock;
  // made after start (+, Save as): the page's host, which main.ts gave Main's dock, before they connect
  if (main.host) { dock.host = main.host; wires.host = main.host; }
  dock.id = id;
  dock.setAttribute('storage-key', layoutKey(mainKey(doc), ws.path));
  dock.setAttribute('open', '');   // a new page starts empty; a saved layout, if any, wins
  for (const t of main.querySelectorAll(':scope > template[data-widget]')) dock.append(t.cloneNode(true));
  wires.append(dock); pane.append(drawer, wires); route.append(pane);
  const fallback = mainRoute.parentElement?.querySelector(':scope > app-route[path="*"]');
  if (fallback) fallback.before(route); else mainRoute.parentElement?.append(route);
}

/** Mounts the saved pages and Main's title and icon, and handles +, edits in the nav and the dock's "Save as workspace…". */
export function bootWorkspacePages(doc: Document): void {
  const store = savedWorkspaces(localStorage);
  for (const ws of store.list()) mountWorkspace(doc, ws);
  const mainLink = doc.querySelector<HTMLAnchorElement>('[data-workspaces] > a'), m = store.main();
  if (mainLink) label(mainLink, m?.title ?? mainLink.textContent?.trim() ?? 'Main', m?.icon ?? MAIN_ICON);
  doc.querySelector('[slot="title"]')?.append(button(doc, 'newWorkspace', 'New workspace', '+'), button(doc, 'editNav', 'Edit workspaces', '✎'));
  doc.querySelector('[data-edit-nav]')?.setAttribute('aria-pressed', 'false');
  const taken = () => [...doc.querySelectorAll('app-route')].map((r) => r.getAttribute('path') ?? '');

  /** Moves a saved page's row, route, dock and keys to `ws` (its path may change); a refusal keeps it as it was. */
  const save = (row: HTMLElement, title: string, icon: string) => {
    const a = row.querySelector<HTMLAnchorElement>(':scope > a')!, path = row.dataset.saved;
    if (!path) { if (!store.setMain({ title, icon })) label(a, title, icon); return; }
    const others = taken().filter((p) => p !== path), cur = store.list().find((w) => w.path === path);
    const ws = { path: title === cur?.title ? path : slugPath(title, others), title, icon };
    if (store.update(path, ws, others, mainKey(doc))) return;
    const dock = pageDock(doc, path);
    fill(doc, row, ws);
    if (ws.path === path) return;
    dock?.closest('app-route')?.setAttribute('path', ws.path);
    dock?.setAttribute('storage-key', layoutKey(mainKey(doc), ws.path));
    // the dock's id follows the route, with what names it (the drawer, its add links)
    for (const el of doc.querySelectorAll(`component-drawer[for="${idOf(path)}"]`)) el.setAttribute('for', idOf(ws.path));
    for (const el of doc.querySelectorAll<HTMLElement>(`[data-dock-add="${idOf(path)}"]`)) el.dataset.dockAdd = idOf(ws.path);
    if (dock) dock.id = idOf(ws.path);
    if (location.hash === `#${path}`) location.hash = `#${ws.path}`;
  };
  const edit = navEdit(doc, save);

  /** A new page titled `base` (numbered as its route is), empty or a copy of `from`'s arrangement; then its rename. */
  const create = (base: string, icon: string, from: WorkspaceDock | null) => {
    const path = slugPath(base, taken()), n = path.slice(slugPath(base, []).length + 1);
    const ws = { path, title: n ? `${base} ${n}` : base, icon };
    if (store.add(ws, taken())) return;
    if (from) {
      const { template, ...layout } = from.arrangement(), key = layoutKey(mainKey(doc), path);
      try { localStorage.setItem(key, JSON.stringify(layout)); } catch { /* no storage: it starts empty */ }
      templateState(localStorage, key).set(template ?? null);
    }
    mountWorkspace(doc, ws);
    location.hash = `#${path}`;
    edit.rename(doc.querySelector<HTMLElement>(`[data-saved="${path}"]`)!);
  };

  doc.addEventListener('click', (e) => {
    if ((e.target as Element | null)?.closest?.('[data-new-workspace]')) create('New workspace', 'window', null);
  });
  doc.addEventListener('dock:save-as', (e) => {
    const dock = e.target as WorkspaceDock, path = dock.closest('app-route')?.getAttribute('path');
    const a = doc.querySelector<HTMLAnchorElement>(`.nav-row > a[href="#${path}"]`);
    create(`${a?.querySelector('[data-name]')?.textContent ?? 'Workspace'} copy`, a?.dataset.icon ?? MAIN_ICON, dock);
  });
}
