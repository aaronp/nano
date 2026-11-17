/**
 * Entry point. The theme is applied first (boot-theme), then components register and upgrade the page.
 * The workspace registers last so the drawer's "add widget" links exist when it wires them up.
 *
 * On nano-core 0.4 the host (host.ts: the one Application, the nano.ui built-ins, import and save of nano.json) takes
 * the place of composable.ts and nano-app: the docks, the explorer and wiring views and the app bar show its app; the
 * File menu saves its nano.json and imports one; `?src=<url>` imports that nano.json on load.
 */
import './boot-theme.ts';
import { host } from './boot-host.ts';   // before the elements are defined: the docks' palettes list what the host can make
import { toast } from '@pritzlaff/nano-elements';
import './components/app-shell.ts';
import './components/split-pane.ts';
import './components/component-drawer.ts';
import { openImportDialog, setImportHost } from './components/import-dialog.ts';
import './components/gallery.ts';
import './components/theme-picker.ts';
import { FileMenuEl } from './components/file-menu.ts';
import { askName } from './components/name-dialog.ts';
import './widgets/widgets.ts';
import './widgets/notes-panel.ts';
import './components/workspace-dock.ts';
import { bootAppBar } from './boot-app-bar.ts';   // after the shell (its bus) and the dock: the app bar follows the page and panel focus
import { showStatus } from './lib/status.ts';
import type { WorkspaceDock } from './components/workspace-dock.ts';
import { defineWires, type Wires } from './wires/index.ts';

if (!customElements.get('nano-file-menu')) customElements.define('nano-file-menu', FileMenuEl);
if (host) {
  const h = host, target = { app: h.app, registry: h.registry };
  setImportHost(host);
  for (const dock of document.querySelectorAll<WorkspaceDock>('workspace-dock')) dock.host = host;
  for (const el of document.querySelectorAll<HTMLElement & { target?: unknown }>('nano-explorer, nano-wiring')) el.target ??= target;
  bootAppBar(host);

  // The File menu: Save and Download write the app's nano.json (without the host's own pod); Open and Import import one.
  const menu = document.querySelector<FileMenuEl>('nano-file-menu');
  const download = (name: string) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(h.saved(), null, 2) + '\n'], { type: 'application/json' }));
    a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    if (menu) menu.dirty = false;
  };
  host.app.listen(e => { if (e.type === 'applied' && menu) menu.dirty = true; });
  const commands: Record<string, () => unknown> = {
    save: () => download('nano.json'), download: () => download('nano.json'),
    'save-as': async () => { const name = await askName(document, 'nano'); if (name) download(`${name}.json`); },
    open: () => openImportDialog(document), import: () => openImportDialog(document),
    // BACKLOG(8): New started an empty app document (and kept the working copy); 0.4's host has no "new".
    new: () => showStatus(document, 'New is not available yet.'),
  };
  for (const [c, run] of Object.entries(commands)) document.addEventListener(`file:${c}`, () => void run());

  // Connections: <c-wires> around the dock hears its `dock:connections` and tilts the dock to show the cables behind it.
  defineWires();
  for (const w of document.querySelectorAll<Wires>('c-wires')) w.host = host;
  // The wiring view asks for a rack component back on the front: the dock's panel for that pod.
  document.addEventListener('wires:open-panel', e => {
    const { name } = (e as CustomEvent<{ kind: string; name: string }>).detail;
    ((e.target as Element).querySelector<WorkspaceDock>('workspace-dock') ?? document.querySelector<WorkspaceDock>('workspace-dock'))?.openPod(name);
  });
  // BACKLOG(3): Save as workspace… and + (new workspace) made saved workspaces, each its own system and route.
  document.addEventListener('dock:save-as', () => showStatus(document, 'Saved workspaces are not available yet.'));
  document.querySelector('[data-new-workspace]')?.addEventListener('click', () => showStatus(document, 'Saved workspaces are not available yet.'));

  const src = new URL(location.href).searchParams.get('src');
  // Only a URL on this page's origin: a crafted link must not open the import prompt on load.
  if (src && new URL(src, location.href).origin !== location.origin) toast(`${src} is not on this origin`, { variant: 'bad' });
  else if (src) await host.importUrl(new URL(src, location.href).href);   // a failure is shown as a toast
}
