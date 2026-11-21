/**
 * Entry point. The theme is applied first (boot-theme), then components register and upgrade the page.
 * The workspace registers last.
 *
 * On nano-core 0.4 the host (host.ts: the one Application, the nano.ui built-ins, import and save of nano.json) takes
 * the place of composable.ts and nano-app: the docks, the explorer and wiring views and the app bar show its app; the
 * File menu saves `{ app, outline }` (its nano.json and the Outline's pages) and opens or imports either that (or the older `{ app, platform }`) or a nano.json; `?src=<url>` imports that
 * nano.json on load, into the stored document boot-host.ts loaded.
 */
import './boot-theme.ts';
import { host, outline } from './boot-host.ts';   // before the elements are defined: the docks' palettes list what the host can make
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
import { icon } from './icons.ts';
import { HOST_PODS } from './host-deploy.ts';
import { showStatus } from './lib/status.ts';
import { applyPages, MAIN, metaOf, withMeta } from './lib/pages.ts';
import { Coord } from '@pritzlaff/nano-core';
import type { Page } from '@pritzlaff/nano-outline';

if (!customElements.get('nano-file-menu')) customElements.define('nano-file-menu', FileMenuEl);
if (host && outline) {
  const h = host, p = outline, target = { app: h.app, registry: h.registry, get calls() { return h.calls(); } };
  // Main's page (the Outline's): written, never its dock, which shows it once built (it may not be: a deep link elsewhere).
  const placedIn = (pod: string) => Object.entries(h.data().runtimes).find(([, r]) => r.pods.includes(pod))?.[0];
  /** The pages with Main's replaced by `edit(Main)`; a refusal shown. */
  const toMain = (edit: (m: Page) => Page) => { const d = p.document().doc, r = applyPages(p, { ...d, pages: { ...d.pages, [MAIN]: edit(d.pages[MAIN]!) } }); if (!r.ok) showStatus(document, r.fail.reason); };
  setImportHost(host);   // its importUrl applies the file's pages too (boot-host.ts)
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
    const saved = h.saved(reconcile), desk = document.querySelector<Desk>('c-desk')?.layout();
    const file = { app: desk ? { ...saved, layout: { ...saved.layout, desk } } : saved, outline: p.document().doc };   // the pages are the Outline's
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
    // New: an apply of an empty deployment (the host's own pods stay; providers stay loaded), and Main's page emptied
    // (its dock's starting layout shows). BACKLOG(8): the old New also started a working copy.
    new: async () => {
      const d = h.data(), r = await h.apply({ ...d, pods: Object.fromEntries(HOST_PODS.map(p => [p, d.pods[p]!])), runtimes: { main: { pods: [...HOST_PODS], subscriptions: [] } }, tags: {}, views: {}, layout: undefined });
      if (!r.ok) return;
      toMain(m => { const { icon } = metaOf(m), { workspace: _, ...layout } = (m.layout ?? {}) as Record<string, unknown>;   // other clients' layout and meta kept
        return withMeta({ ...(m.title !== undefined && { title: m.title }), slots: {}, ...(m.children && { children: m.children }), ...(Object.keys(layout).length && { layout }), ...(m.meta !== undefined && { meta: m.meta }) }, { icon }); });
      if (menu) menu.dirty = false;
    },
  };
  for (const [c, run] of Object.entries(commands)) document.addEventListener(`file:${c}`, () => void run());
  // File › Examples: an example shipped with the workspace (examples/<name>/nano.json, on this origin), imported as Open does
  document.addEventListener('file:example', e => { const { name } = (e as CustomEvent<{ name: string }>).detail; void h.importUrl(new URL(`examples/${name}/nano.json`, location.href).href); });

  // Connections: <c-wires> around the dock hears its `dock:connections` and tilts the dock to show the cables behind it.
  defineWires();
  for (const w of document.querySelectorAll<Wires>('c-wires')) w.host = host;
  // The wiring view asks for a rack component back on the front: the dock's panel for that pod.
  document.addEventListener('wires:open-panel', e => {
    const { name } = (e as CustomEvent<{ kind: string; name: string }>).detail;
    const d = (e.target as Element).querySelector<WorkspaceDock>('workspace-dock') ?? document.querySelector<WorkspaceDock>('workspace-dock'), runtime = placedIn(name);
    if (d?.querySelector(':scope > .dock-area')) d.openPod(name, runtime);
    else if (runtime && !Object.values(p.document().doc.pages[MAIN]!.slots).some(s => s.kind === 'pod' && s.pod.pod === name))   // not built: Main's page
      toMain(m => ({ ...m, slots: { ...m.slots, [name]: { kind: 'pod', pod: Coord.pod(Coord.parse('implementation', h.data().pods[name]!.implementation), Coord.runtime(runtime), name) } } }));
  });

  // The Desk page: <c-desk> over the app, and a link to the last workspace's Connections.
  defineDesk();
  for (const d of document.querySelectorAll<Desk>('c-desk')) d.host = host;
  bootWiring(document, async () => [{ id: '/p/workspace' }]);

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
  else if (src && (await host.importUrl(new URL(src, location.href).href)).ok) {   // a failure is shown as a toast
    const at = new URL(location.href); at.searchParams.delete('src'); history.replaceState(history.state, '', at);   // imported into the stored document: a reload must not import it again
  }
}
