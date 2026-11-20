/**
 * Entry point. The theme is applied first (boot-theme), then components register and upgrade the page.
 * The workspace registers last.
 *
 * On nano-core 0.4 the host (host.ts: the one Application, the nano.ui built-ins, import and save of nano.json) takes
 * the place of composable.ts and nano-app: the docks, the explorer and wiring views and the app bar show its app; the
 * File menu saves its nano.json (its `layout.pages` from the page store) and imports one; `?src=<url>` imports that
 * nano.json on load, into the stored document boot-host.ts loaded.
 */
import './boot-theme.ts';
import { host, pages } from './boot-host.ts';   // before the elements are defined: the docks' palettes list what the host can make
import { toast } from '@pritzlaff/nano-elements';
import { clockDriver, timeMachine, type NanoTimeMachine } from '@pritzlaff/nano-ui';
import './boot-workspace-pages.ts';   // before the shell: it reads its routes as it starts
import './components/app-shell.ts';
import { openImportDialog, setImportHost } from './components/import-dialog.ts';
import './components/gallery.ts';
import './components/theme-picker.ts';
import './components/profile-menu.ts';
import { FileMenuEl } from './components/file-menu.ts';
import { askName } from './components/name-dialog.ts';
import './widgets/widgets.ts';
import './widgets/notes-panel.ts';
import './components/workspace-dock.ts';
import { bootAppBar } from './boot-app-bar.ts';   // after the shell (its bus) and the dock: the app bar follows the page and panel focus
import { defineSettings, type SettingsView } from './components/settings-view.ts';
import type { WorkspaceDock } from './components/workspace-dock.ts';
import { defineWires, type Wires } from './wires/index.ts';
import { defineDesk, type Desk } from './desk/index.ts';
import { defineMessages } from './messages/index.ts';
import { bootWiring, hand as handTo } from './boot-wiring.ts';   // after the shell (its bus)
import { shadowCreate } from './history.ts';
import { savedLayout, slotsToOpen } from './layout-data.ts';
import { templateState, type TemplateState } from './lib/layout-templates.ts';
import { icon } from './icons.ts';
import { HOST_PODS } from './host-deploy.ts';

if (!customElements.get('nano-file-menu')) customElements.define('nano-file-menu', FileMenuEl);
if (host) {
  const h = host, target = { app: h.app, registry: h.registry, get calls() { return h.calls(); } };
  const dock = document.querySelector<WorkspaceDock>('workspace-dock#workspace');
  // An import whose nano.json brings a layout for this dock shows it: through the dock's own saved layout and restore().
  const shown = async (r: Promise<{ ok: boolean }>, before: string) => {
    const done = await r;
    const l = dock && h.data().layout?.[dock.id], key = dock?.getAttribute('storage-key');
    if (done.ok && l && key && JSON.stringify(l) !== before) { try { dock!.storage.setItem(key, JSON.stringify(l)); templateState(dock!.storage, key).set((l as { template?: TemplateState }).template ?? null); } catch { /* no storage: the layout is not shown */ } dock!.restore(); }
    // A file from another engine: its neutral slots, a panel each, in order.
    const open = done.ok && dock ? slotsToOpen(h.data(), dock.id) : [];
    if (open.length) { dock!.reset(); for (const pod of open) dock!.openPod(pod); }
    return done;
  };
  const layoutNow = () => JSON.stringify(dock && h.data().layout?.[dock.id]);
  setImportHost({ ...host, importUrl: (url, chosen) => { const before = layoutNow(); return shown(host!.importUrl(url, chosen), before) as ReturnType<typeof h.importUrl>; } });
  for (const dock of document.querySelectorAll<WorkspaceDock>('workspace-dock')) dock.host = host;
  for (const el of document.querySelectorAll<HTMLElement & { target?: unknown; icon?: unknown }>('nano-explorer, nano-wiring')) { el.target ??= target; if (el.localName === 'nano-explorer') el.icon = icon; }
  bootAppBar(host);
  defineSettings();
  for (const el of document.querySelectorAll<SettingsView>('nano-settings')) el.host = host;

  // The File menu: Save and Download (Reconcile and save: with the calls seen, host.saved(true)) write the app's nano.json (without the host's own pod), with the dock's
  // arrangement as its `layout` under the dock's id; Open and Import import one (and show its layout); New empties it.
  const menu = document.querySelector<FileMenuEl>('nano-file-menu');
  const download = (name: string, reconcile = false) => {
    const a = document.createElement('a');
    const saved = h.saved(reconcile), l = dock?.arrangement();
    const runtimeOf = (pod: string) => Object.entries(saved.runtimes).find(([, r]) => r.pods.includes(pod))?.[0];
    const desk = document.querySelector<Desk>('c-desk')?.layout();
    const was = l && dock ? { ...saved, layout: savedLayout(saved, dock.id, l, runtimeOf, desk) } : desk ? { ...saved, layout: { ...saved.layout, desk } } : saved;
    const file = { ...was, layout: { ...was.layout, pages: pages.list() } };   // the pages are the store's
    a.href = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2) + '\n'], { type: 'application/json' }));
    a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    if (menu) menu.dirty = false;
  };
  host.app.listen(e => { if (e.type === 'applied' && menu) menu.dirty = true; });
  const commands: Record<string, () => unknown> = {
    save: () => download('nano.json'), reconcile: () => download('nano.json', true), download: () => download('nano.json'),
    'save-as': async () => { const name = await askName(document, 'nano'); if (name) download(`${name}.json`); },
    open: () => openImportDialog(document), import: () => openImportDialog(document),
    // New: an apply of an empty deployment (the host's own pods stay; providers stay loaded), and the dock's
    // starting layout. BACKLOG(8): the old New also started a working copy.
    new: async () => {
      const d = h.data(), r = await h.apply({ ...d, pods: Object.fromEntries(HOST_PODS.map(p => [p, d.pods[p]!])), runtimes: { main: { pods: [...HOST_PODS], subscriptions: [] } }, tags: {}, views: {}, layout: undefined });
      if (!r.ok) return;
      dock?.reset();
      if (menu) menu.dirty = false;
    },
  };
  for (const [c, run] of Object.entries(commands)) document.addEventListener(`file:${c}`, () => void run());
  // File › Examples: an example shipped with the workspace (examples/<name>/nano.json, on this origin), imported as Open does
  document.addEventListener('file:example', e => { const { name } = (e as CustomEvent<{ name: string }>).detail; void shown(h.importUrl(new URL(`examples/${name}/nano.json`, location.href).href), layoutNow()); });

  // Connections: <c-wires> around the dock hears its `dock:connections` and tilts the dock to show the cables behind it.
  defineWires();
  for (const w of document.querySelectorAll<Wires>('c-wires')) w.host = host;
  // The wiring view asks for a rack component back on the front: the dock's panel for that pod.
  document.addEventListener('wires:open-panel', e => {
    const { name } = (e as CustomEvent<{ kind: string; name: string }>).detail;
    ((e.target as Element).querySelector<WorkspaceDock>('workspace-dock') ?? document.querySelector<WorkspaceDock>('workspace-dock'))?.openPod(name);
  });

  // The Desk page: <c-desk> over the app, and a link to the last workspace's Connections.
  defineDesk();
  for (const d of document.querySelectorAll<Desk>('c-desk')) d.host = host;
  bootWiring(document, async () => [{ id: '/workspace' }]);

  // The page's one time machine over host.history, and its clock driver, handed to every <nano-time-machine>. Reset
  // makes both afresh: a time machine's index does not survive the history being cleared.
  let tm = await timeMachine(h.history), driver = clockDriver(h.app, h.registry, tm);
  const bars = document.querySelectorAll<NanoTimeMachine>('nano-time-machine');
  defineMessages();
  // The Ring's filter: the implementations in the deployment's `layout.ring.show`, read when drawn (absent: every pod).
  const show = (_pod: string, impl: string) => { const s = (h.data().layout?.ring as { show?: unknown } | undefined)?.show; return !Array.isArray(s) || s.includes(impl); };
  const ring = { app: h.app, registry: h.registry, create: shadowCreate(h.registry), show };
  // the host's view map (as the dock's panels use), handed again on each apply: an import brings its modules' views
  const hand = () => handTo(document, { tm, store: h.history.store, driver }, { ...ring, views: h.defaults() });
  hand();
  h.app.listen(e => { if (e.type === 'applied') hand(); });
  let resetting: Promise<void> | undefined;   // one Reset at a time: a second click while one runs joins it
  for (const b of bars) b.addEventListener('reset', () => resetting ??= (async () => {
    driver.close(); tm.close();   // first: a live driver would advance the restarted clock unrecorded
    const r = await h.history.reset();
    if (!r.ok) toast(r.fail.reason, { variant: 'bad' });
    tm = await timeMachine(h.history); driver = clockDriver(h.app, h.registry, tm);
    hand();
  })().finally(() => { resetting = undefined; }));

  const src = new URL(location.href).searchParams.get('src');
  // Only a URL on this page's origin: a crafted link must not open the import prompt on load.
  if (src && new URL(src, location.href).origin !== location.origin) toast(`${src} is not on this origin`, { variant: 'bad' });
  else if (src && (await shown(host.importUrl(new URL(src, location.href).href), layoutNow())).ok) {   // a failure is shown as a toast
    const at = new URL(location.href); at.searchParams.delete('src'); history.replaceState(history.state, '', at);   // imported into the stored document: a reload must not import it again
  }
}
