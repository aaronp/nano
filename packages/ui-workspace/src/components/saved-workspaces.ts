/**
 * Saved workspaces on the page, each in a system. The dock's "Save workspace…" button fires `dock:save-as` with its
 * layout, and + (beside Workspaces) makes an empty one in an existing or new system; a dialog
 * asks for a route, title and icon, and the workspace becomes a nav item with its own page: a dock with the same
 * widgets, starting from that layout. Its panels show the same live components (they are named in the layout).
 * Saved ones are mounted at start, before <app-shell> reads its routes.
 */
import { Ops, type Op, type Runtime } from '@pritzlaff/nano-core';
import { PlatformOps as P, runtimeOf } from '@composable/platform';
import { ICONS, SYSTEM, savedWorkspaces, type SavedWorkspace } from '../lib/saved-workspaces.ts';
import { askWorkspace, type WorkspaceChoice } from './workspace-dialog.ts';

const icon = (name: string) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name] ?? ''}"/></svg>`;
const mainDock = (doc: Document) => doc.querySelector<HTMLElement>('workspace-dock#workspace') ?? doc.querySelector<HTMLElement>('workspace-dock');
/** Where a saved workspace's dock keeps its layout. */
export const keyFor = (doc: Document, path: string) => `${mainDock(doc)?.getAttribute('storage-key') ?? 'workspace'}.saved.${path}`;

/** Adds a saved workspace's nav item (top-level, after the others) and its page (after the other workspaces'):
 * a components drawer beside a dock of the same widgets, in the workspace's system. */
export function mountWorkspace(doc: Document, ws: SavedWorkspace) {
  const main = mainDock(doc), shell = doc.querySelector('app-shell');
  if (!main || !shell) return;
  const a = doc.createElement('a');
  a.slot = 'nav'; a.href = `#${ws.path}`; a.dataset.saved = ws.path; a.setAttribute('draggable', 'true');
  a.innerHTML = icon(ws.icon);
  a.append(ws.title);
  // top-level, after the last saved one, else after Main (else the Workspaces row)
  const savedItems = shell.querySelectorAll(':scope > a[data-saved]');
  const last = savedItems[savedItems.length - 1] ?? shell.querySelector(':scope > a[slot="nav"][href="#/workspace"]') ?? shell.querySelector(':scope > [data-workspaces]');
  if (last) last.after(a); else shell.append(a);

  const route = doc.createElement('app-route');
  route.setAttribute('path', ws.path); route.setAttribute('bleed', '');
  const id = `ws${ws.path.replace(/\//g, '-')}`;
  const pane = doc.createElement('div'), drawer = doc.createElement('component-drawer');
  pane.className = 'ws-page';
  drawer.setAttribute('for', id);
  const wires = doc.createElement('c-wires'), dock = doc.createElement('workspace-dock');
  // its system's runtime, from the platform in the host (Main's wiring view runs over the host)
  const mainWires = main.closest('c-wires') as (HTMLElement & { runtime?: Runtime; catalog?: unknown }) | null;
  const host = mainWires?.runtime, rt = host && (runtimeOf(host.registry, ws.system ?? 'host') ?? host);
  if (mainWires) Object.assign(wires, { runtime: rt, host, catalog: mainWires.catalog });
  if (rt) Object.assign(dock, { registry: rt.registry });
  dock.id = id;
  dock.setAttribute('storage-key', keyFor(doc, ws.path));
  dock.setAttribute('system', ws.system ?? 'host');
  dock.setAttribute('open', '');   // a new workspace starts empty; a saved layout, if any, wins
  for (const t of main.querySelectorAll(':scope > template[data-widget]')) dock.append(t.cloneNode(true));
  wires.append(dock); pane.append(drawer, wires); route.append(pane);
  const fallback = shell.querySelector(':scope > app-route[path="*"]');
  if (fallback) fallback.before(route); else shell.append(route);
}

/** Mounts the saved workspaces, and saves new ones when a dock asks. */
const hostOf = (doc: Document) => (mainDock(doc)?.closest('c-wires') as (HTMLElement & { runtime?: Runtime }) | null)?.runtime;

/** Mounts the saved workspaces, saves a dock's layout as a new workspace when it asks, and makes new ones with +. */
export function bootSavedWorkspaces(doc: Document) {
  const saved = savedWorkspaces(localStorage);
  for (const ws of saved.list()) mountWorkspace(doc, ws);
  const taken = () => [...doc.querySelectorAll('app-route')].map((r) => r.getAttribute('path') ?? '');
  const open = (ws: SavedWorkspace) => { mountWorkspace(doc, ws); location.hash = `#${ws.path}`; doc.dispatchEvent(new CustomEvent('nano:changed')); };

  // Reorder: Alt+↑/↓ on a focused item, or drag one onto another. The stored order is the truth; the nav follows it.
  const item = (t: EventTarget | null) => (t as Element | null)?.closest?.('a[data-saved]') as HTMLAnchorElement | null;
  const live = doc.createElement('div');
  live.setAttribute('aria-live', 'polite'); live.setAttribute('role', 'status');
  live.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)';
  const shell = doc.querySelector('app-shell') ?? doc.body;   // listeners live on the shell, not the document
  shell.append(live);
  const arrange = () => {
    let prev: Element | null = null;
    for (const w of saved.list()) {
      const a = doc.querySelector(`a[data-saved="${w.path}"]`);
      if (!a) continue;
      if (prev && prev.nextElementSibling !== a) prev.after(a);
      prev = a;
    }
  };
  const changed = (moved: boolean) => { if (moved) { arrange(); doc.dispatchEvent(new CustomEvent('nano:changed')); } return moved; };
  shell.addEventListener('keydown', (e) => {
    const a = item(e.target), k = (e as KeyboardEvent).key;
    const ke = e as KeyboardEvent;
    if (!a || !ke.altKey || ke.ctrlKey || ke.shiftKey || ke.metaKey || (k !== 'ArrowUp' && k !== 'ArrowDown')) return;
    e.preventDefault();
    const up = k === 'ArrowUp';
    if (changed(saved.move(a.dataset.saved!, up ? -1 : 1))) {
      a.focus();
      live.textContent = '';   // cleared first so a repeat is announced again
      setTimeout(() => { live.textContent = `Moved ${a.textContent} ${up ? 'up' : 'down'}`; }, 50);
    }
  });
  let dragged = '';
  shell.addEventListener('dragstart', (e) => {
    const a = item(e.target); if (!a) return;
    dragged = a.dataset.saved!;
    (e as DragEvent).dataTransfer?.setData('text/plain', dragged);
  });
  const clear = () => { for (const x of doc.querySelectorAll('[data-drop]')) x.removeAttribute('data-drop'); };
  shell.addEventListener('dragover', (e) => {
    const a = item(e.target);
    if (!dragged || !a) return;
    e.preventDefault();
    const paths = saved.list().map((w) => w.path);
    clear();
    // it lands where the target is: above it when coming from below, below it when coming from above
    if (a.dataset.saved !== dragged) a.dataset.drop = paths.indexOf(dragged) > paths.indexOf(a.dataset.saved!) ? 'before' : 'after';
  });
  shell.addEventListener('dragleave', (e) => { if (!shell.contains((e as DragEvent).relatedTarget as Node | null)) clear(); else item(e.target)?.removeAttribute('data-drop'); });
  shell.addEventListener('drop', (e) => {
    const a = item(e.target); if (!dragged || !a) return;
    e.preventDefault();   // dropping a link must not navigate
    changed(saved.moveTo(dragged, saved.list().findIndex((w) => w.path === a.dataset.saved)));
    dragged = ''; clear();
  });
  shell.addEventListener('dragend', () => { dragged = ''; clear(); });

  // Save workspace… (from a dock): its layout, in the dock's own system
  doc.addEventListener('dock:save-as', async (e) => {
    const { layout, system } = (e as CustomEvent<{ layout: unknown; system?: string }>).detail;
    for (let error = '', prev: WorkspaceChoice | undefined; ;) {
      const c = await askWorkspace(doc, { heading: 'Save workspace', error, prev });
      if (!c) return;
      const ws = { path: c.path, title: c.title, icon: c.icon, system: system ?? 'host' };
      const refused = saved.add(ws, taken());
      if (refused) { error = refused; prev = c; continue; }
      localStorage.setItem(keyFor(doc, ws.path), JSON.stringify(layout));
      return open(ws);
    }
  });

  // + (beside Workspaces): an empty workspace, in an existing system or a new one
  doc.addEventListener('click', async (e) => {
    if (!(e.target as Element | null)?.closest?.('[data-new-workspace]')) return;
    const host = hostOf(doc);
    if (!host) return;
    const call = (op: Op, arg: unknown) => host.call({ registry: host.registry.id, instance: 'workspace' }, 'platform', Ops.key(op), arg);
    const systems = (((await call(P.systems, null)) as { value?: { id: string }[] }).value ?? []).map((s) => s.id);
    for (let error = '', prev: WorkspaceChoice | undefined; ;) {
      const c = await askWorkspace(doc, { heading: 'New workspace', systems, error, prev });
      if (!c) return;
      const fresh = c.system === 'new', system = fresh ? (c.newSystem ?? '') : (c.system ?? 'host');
      const refusal = fresh && systems.includes(system) ? `${system} is already a system: choose it from the list.` : fresh && !SYSTEM.test(system) ? 'Name the new system: lower-case letters, digits and dashes.' : null;
      const ws = { path: c.path, title: c.title, icon: c.icon, system };
      const refused = refusal ?? saved.refusal(ws, taken());
      if (refused) { error = refused; prev = c; continue; }
      // the system first: a workspace is only saved once the system it runs in exists
      const made = fresh ? await call(P.createSystem, system) : null;
      if (made && 'error' in made) { error = made.error; prev = c; continue; }
      saved.add(ws, taken());
      return open(ws);
    }
  });
}
