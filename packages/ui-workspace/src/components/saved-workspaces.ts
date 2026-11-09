/**
 * Saved workspaces on the page. The dock's "Save workspace…" button fires `dock:save-as` with its layout; a dialog
 * asks for a route, title and icon, and the workspace becomes a nav item with its own page: a dock with the same
 * widgets, starting from that layout. Its panels show the same live components (they are named in the layout).
 * Saved ones are mounted at start, before <app-shell> reads its routes.
 */
import { ICONS, savedWorkspaces, type SavedWorkspace } from '../lib/saved-workspaces.ts';

const icon = (name: string) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name] ?? ''}"/></svg>`;
const mainDock = (doc: Document) => doc.querySelector<HTMLElement>('workspace-dock#workspace') ?? doc.querySelector<HTMLElement>('workspace-dock');
/** Where a saved workspace's dock keeps its layout. */
const keyFor = (doc: Document, path: string) => `${mainDock(doc)?.getAttribute('storage-key') ?? 'workspace'}.saved.${path}`;

/** Adds a saved workspace's nav item (after the workspace and its sub-items) and its page (before the not-found one). */
export function mountWorkspace(doc: Document, ws: SavedWorkspace) {
  const main = mainDock(doc), shell = doc.querySelector('app-shell');
  if (!main || !shell) return;
  const a = doc.createElement('a');
  a.slot = 'nav'; a.href = `#${ws.path}`; a.dataset.saved = '';
  a.innerHTML = icon(ws.icon);
  a.append(ws.title);
  const navs = [...shell.querySelectorAll<HTMLAnchorElement>(':scope > a[slot="nav"]')];
  const at = navs.findIndex((n) => n.getAttribute('href') === '#/workspace' && !n.hasAttribute('data-sub'));
  const next = navs.slice(at + 1).find((n) => !n.hasAttribute('data-sub') && !n.hasAttribute('data-saved'));
  if (next) next.before(a); else shell.append(a);

  const route = doc.createElement('app-route');
  route.setAttribute('path', ws.path); route.setAttribute('bleed', '');
  const wires = doc.createElement('c-wires'), dock = doc.createElement('workspace-dock');
  const mainWires = main.closest('c-wires') as (HTMLElement & { runtime?: unknown; catalog?: unknown }) | null;
  if (mainWires) Object.assign(wires, { runtime: mainWires.runtime, catalog: mainWires.catalog });
  dock.id = `ws${ws.path.replace(/\//g, '-')}`;
  dock.setAttribute('label', ws.title);
  dock.setAttribute('storage-key', keyFor(doc, ws.path));
  for (const t of main.querySelectorAll(':scope > template[data-widget]')) dock.append(t.cloneNode(true));
  wires.append(dock); route.append(wires);
  const fallback = shell.querySelector(':scope > app-route[path="*"]');
  if (fallback) fallback.before(route); else shell.append(route);
}

/** The dialog that names a workspace being saved; resolves with the choice, or null if cancelled. */
function ask(doc: Document, error = '', prev?: SavedWorkspace): Promise<SavedWorkspace | null> {
  const d = doc.createElement('dialog');
  d.setAttribute('aria-label', 'Save workspace');
  d.style.cssText = 'border:var(--card-border, 1px solid #ccc); border-radius:var(--radius, 8px); background:var(--surface); color:var(--fg); font:14px var(--font); padding:20px; width:min(380px, 90vw)';
  const field = 'display:flex; flex-direction:column; gap:4px; margin-bottom:12px';
  const input = 'font:inherit; padding:6px 8px; border:var(--card-border, 1px solid #ccc); border-radius:var(--radius, 6px); background:var(--surface-2); color:var(--fg)';
  d.innerHTML = `<form method="dialog">
    <h2 style="margin:0 0 14px; font:600 16px var(--display, inherit)">Save workspace</h2>
    <label style="${field}">Route<input name="path" required placeholder="/my-workspace" style="${input}"></label>
    <label style="${field}">Nav title<input name="title" required placeholder="My Workspace" style="${input}"></label>
    <fieldset style="border:0; padding:0; margin:0 0 12px"><legend style="margin-bottom:6px">Nav icon</legend>
      <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:6px">${Object.keys(ICONS).map((k, i) => `<label title="${k}" style="display:flex; flex-direction:column; align-items:center; gap:2px; padding:6px; border-radius:6px; cursor:pointer; font-size:11px; color:var(--muted)">
        <input type="radio" name="icon" value="${k}" ${i === 0 ? 'checked' : ''} style="margin:0">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[k]}"/></svg>${k}</label>`).join('')}</div>
    </fieldset>
    <p role="alert" style="margin:0 0 12px; color:var(--danger, #c33); min-height:1em">${error}</p>
    <div style="display:flex; justify-content:flex-end; gap:8px"><button value="cancel" formnovalidate>Cancel</button><button value="save">Save</button></div>
  </form>`;
  if (prev) {
    const form = d.querySelector('form')!, set = (n: string, v: string) => { (form.elements.namedItem(n) as HTMLInputElement).value = v; };
    set('path', prev.path); set('title', prev.title);
    const radio = form.querySelector<HTMLInputElement>(`input[name="icon"][value="${prev.icon}"]`); if (radio) radio.checked = true;
  }
  doc.body.append(d);
  d.showModal();
  return new Promise((resolve) => d.addEventListener('close', () => {
    const f = new FormData(d.querySelector('form')!);
    d.remove();
    resolve(d.returnValue === 'save' ? { path: String(f.get('path') ?? '').trim(), title: String(f.get('title') ?? ''), icon: String(f.get('icon') ?? '') } : null);
  }));
}

/** Mounts the saved workspaces, and saves new ones when a dock asks. */
export function bootSavedWorkspaces(doc: Document) {
  const saved = savedWorkspaces(localStorage);
  for (const ws of saved.list()) mountWorkspace(doc, ws);
  doc.addEventListener('dock:save-as', async (e) => {
    const { layout } = (e as CustomEvent<{ layout: unknown }>).detail;
    const taken = [...doc.querySelectorAll('app-route')].map((r) => r.getAttribute('path') ?? '');
    for (let error = '', prev: SavedWorkspace | undefined; ;) {
      const ws = await ask(doc, error, prev);
      if (!ws) return;
      const refused = saved.add(ws, taken);
      if (refused) { error = refused; prev = ws; continue; }
      localStorage.setItem(keyFor(doc, ws.path), JSON.stringify(layout));
      mountWorkspace(doc, ws);
      location.hash = `#${ws.path}`;
      return;
    }
  });
}
