/**
 * Saved workspace pages: each a nav row (link, Duplicate and Edit) and a route holding a components drawer beside a
 * dock of Main's widgets, its layout under layoutKey(Main's storage-key, path). Saved ones are mounted at start, before
 * <app-shell> reads its routes. Duplicate (⧉, on Main too) copies a page's arrangement into a new one, as the dock's
 * "Save as workspace…" does; + makes an empty one; Edit (✎) renames a saved one, moving its keys with a new route.
 */
import { ICONS, layoutKey, savedWorkspaces, type SavedWorkspace } from '../lib/saved-workspaces.ts';
import { templateState } from '../lib/layout-templates.ts';
import { askWorkspace } from './workspace-dialog.ts';
import type { WorkspaceDock } from './workspace-dock.ts';
import type { Wires } from '../wires/wires.ts';

const mainDock = (doc: Document) => doc.querySelector<WorkspaceDock>('workspace-dock#workspace');
const mainKey = (doc: Document) => mainDock(doc)?.getAttribute('storage-key') ?? 'workspace';
const pageDock = (doc: Document, path: string) => doc.querySelector<WorkspaceDock>(`app-route[path="${path}"] workspace-dock`);

const button = (doc: Document, action: string, label: string, text: string) => {
  const b = doc.createElement('button');
  b.type = 'button'; b.dataset[action] = ''; b.setAttribute('aria-label', label); b.title = label; b.textContent = text;
  return b;
};

/** A saved page's nav row: its link, then Duplicate and Edit. */
const fill = (doc: Document, row: HTMLElement, ws: SavedWorkspace) => {
  const a = doc.createElement('a');
  a.href = `#${ws.path}`;
  a.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[ws.icon] ?? ''}"/></svg>`;
  a.append(ws.title);
  row.dataset.saved = ws.path;
  row.replaceChildren(a, button(doc, 'duplicate', `Duplicate ${ws.title}`, '⧉'), button(doc, 'edit', `Edit ${ws.title}`, '✎'));
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
  route.setAttribute('path', ws.path); route.setAttribute('bleed', '');
  const id = `ws${ws.path.replace(/\//g, '-')}`;
  const pane = doc.createElement('div'), drawer = doc.createElement('component-drawer');
  pane.className = 'ws-page';
  drawer.setAttribute('for', id);
  const wires = doc.createElement('c-wires') as Wires, dock = doc.createElement('workspace-dock') as WorkspaceDock;
  // made after start (Duplicate, +): the page's host, which main.ts gave Main's dock, before they connect
  if (main.host) { dock.host = main.host; wires.host = main.host; }
  dock.id = id;
  dock.setAttribute('storage-key', layoutKey(mainKey(doc), ws.path));
  dock.setAttribute('open', '');   // a new page starts empty; a saved layout, if any, wins
  for (const t of main.querySelectorAll(':scope > template[data-widget]')) dock.append(t.cloneNode(true));
  wires.append(dock); pane.append(drawer, wires); route.append(pane);
  const fallback = mainRoute.parentElement?.querySelector(':scope > app-route[path="*"]');
  if (fallback) fallback.before(route); else mainRoute.parentElement?.append(route);
}

/** Mounts the saved pages and handles Duplicate, Edit, + and the dock's "Save as workspace…". */
export function bootWorkspacePages(doc: Document, ask = askWorkspace): void {
  const store = savedWorkspaces(localStorage);
  for (const ws of store.list()) mountWorkspace(doc, ws);
  const row = doc.querySelector('[data-workspaces]'), title = row?.querySelector('a')?.textContent?.trim() ?? 'Main';
  row?.querySelector('a')?.after(button(doc, 'duplicate', `Duplicate ${title}`, '⧉'));
  const taken = () => [...doc.querySelectorAll('app-route')].map((r) => r.getAttribute('path') ?? '');

  /** Asks until a choice is kept (`keep` gives a refusal, or null once done) or the dialog is cancelled. */
  const choose = async (heading: string, keep: (ws: SavedWorkspace) => string | null, prev?: SavedWorkspace) => {
    for (let error = ''; ;) {
      const c = await ask(doc, { heading, error, prev });
      if (!c) return null;
      const ws = { path: c.path, title: c.title, icon: c.icon };
      error = keep(ws) ?? '';
      if (!error) return ws;
      prev = ws;
    }
  };
  /** A new page: a copy of `from`'s arrangement (and template), or empty. */
  const duplicate = async (heading: string, from: WorkspaceDock | null) => {
    const ws = await choose(heading, (c) => store.add(c, taken()));
    if (!ws) return;
    if (from) {
      const { template, ...layout } = from.arrangement(), key = layoutKey(mainKey(doc), ws.path);
      try { localStorage.setItem(key, JSON.stringify(layout)); } catch { /* no storage: it starts empty */ }
      templateState(localStorage, key).set(template ?? null);
    }
    mountWorkspace(doc, ws);
    location.hash = `#${ws.path}`;
  };
  const edit = async (row: HTMLElement) => {
    const path = row.dataset.saved!, cur = store.list().find((w) => w.path === path);
    const ws = cur && await choose('Edit workspace', (c) => store.update(path, c, taken(), mainKey(doc)), cur);
    if (!ws) return;
    const dock = pageDock(doc, path);
    fill(doc, row, ws);
    dock?.closest('app-route')?.setAttribute('path', ws.path);
    dock?.setAttribute('storage-key', layoutKey(mainKey(doc), ws.path));
    if (location.hash === `#${path}`) location.hash = `#${ws.path}`;
  };

  doc.addEventListener('click', (e) => {
    const b = (e.target as Element | null)?.closest?.('[data-duplicate], [data-edit], [data-new-workspace]');
    const saved = b?.closest<HTMLElement>('[data-saved]');
    if (!b) return;
    if (b.matches('[data-new-workspace]')) void duplicate('New workspace', null);
    else if (b.matches('[data-edit]')) { if (saved) void edit(saved); }
    else void duplicate('Duplicate workspace', saved ? pageDock(doc, saved.dataset.saved!) : mainDock(doc));
  });
  doc.addEventListener('dock:save-as', (e) => void duplicate('Save as workspace', e.target as WorkspaceDock));
}
