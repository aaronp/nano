/**
 * The host on nano-core 0.4, started before the elements are defined (where composable.ts was): the one Application
 * (host.ts), nano-ui's views, and a palette template per implementation the host can make, before the dock's
 * hand-written ones, so the docks (and the picker they open) list them when they upgrade. An import that registers
 * new providers adds their templates to every dock, and an open picker hears `catalog:changed`.
 *
 * It boots from the stored document (persist.ts), the app's own (ADR-0034): imported as any file is, so nano.ui and
 * same-origin providers ask nothing and a foreign provider is confirmed first. `pages` (lib/pages.ts) is seeded from its
 * `layout.pages`, else the old keys (`migrate`), else Main alone, and is the run-time truth for pages from then on. The
 * old docks made their pods as they mounted, so a migrated pod slot's pod is placed now, lazy in `main` under its name
 * (its implementation found by the panel's widget id); one with no implementation is dropped, and a status says so.
 * The kept layout holds no `pages` after boot (the store is their only home; an import's own come in with it). The document is saved, debounced, on each `applied` and page change; pod slots whose pod went are pruned on
 * `applied`. A stored document that fails to load is not saved over this session. Storage the page may not use: the
 * app runs in memory, and the first save says so.
 */
import { defineViews, pagesOf, type LayoutSlot } from '@pritzlaff/nano-ui';
import type { Pod } from '@pritzlaff/nano-core';
import { toast } from '@pritzlaff/nano-elements';
import { start, type Host } from './host.ts';
import { implementationTemplates } from './dock/panels.ts';
import { pageStore } from './lib/pages.ts';
import { persisted } from './persist.ts';
import { showStatus } from './lib/status.ts';
import { connected } from './auto-connect.ts';

const KEY = 'nano-workspace.document', SAVE_MS = 300;
const storage = (() => { try { return localStorage; } catch (e) { const no = () => { throw e; }; return { getItem: no, setItem: no, removeItem: no } as unknown as Storage; } })();
const stored = persisted(storage, KEY), doc = stored.load(), kept = pagesOf(doc?.layout), migrated = kept.length ? [] : stored.migrate(storage);
let live: Host | undefined;
const placed = (runtime: string, pod: string) => !!live?.app.deployment().runtimes[runtime]?.pods.includes(pod);
/** The page's pages: the run-time truth for `layout.pages` (lib/pages.ts). */
export const pages = pageStore(kept.length ? kept : migrated, placed);
/** The widget id of the old panel showing `pod`, anywhere in `v` (a page's engine state). */
const widgetOf = (v: unknown, pod: string): string | undefined => {
  if (typeof v !== 'object' || v === null) return undefined;
  const o = v as Record<string, unknown>;
  if (o['name'] === pod && typeof o['widget'] === 'string') return o['widget'];
  for (const x of Object.values(o)) { const w = widgetOf(x, pod); if (w) return w; }
  return undefined;
};

defineViews();
const started = await start(pages);
if (!started.ok) toast(started.fail.reason, { variant: 'bad', duration: 0 });
/** The page's host; undefined if it did not start (a toast says why). */
export const host: Host | undefined = live = started.ok ? started.value : undefined;

if (host) {
  const at = doc && URL.createObjectURL(new Blob([JSON.stringify({ ...doc, layout: { ...doc.layout, pages: undefined } })], { type: 'application/json' }));
  const loaded = at ? await host.importUrl(at).finally(() => URL.revokeObjectURL(at)) : { ok: true };
  const missing = migrated.flatMap(p => p.slots).filter((s): s is LayoutSlot => 'pod' in s && !placed(s.runtime, s.pod));
  if (missing.length) {
    const impl = new Map(implementationTemplates(host, document).map(t => [t.dataset['widget'], t.dataset['implementation']!]));
    const add: Record<string, Pod> = {};
    for (const s of missing) { const c = impl.get(widgetOf(migrated, s.pod)); if (c) add[s.pod] = { implementation: c, eager: false }; }
    const d = host.data(), main = d.runtimes['main']!, names = Object.keys(add);
    if (names.length) await host.apply(connected({ ...d, pods: { ...d.pods, ...add }, runtimes: { ...d.runtimes, main: { ...main, pods: [...main.pods, ...names] } } }, host.registry, names));
    if (pages.prune(placed)) showStatus(document, 'Some panels of your old pages are gone: what they showed is no longer available.');
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = () => { clearTimeout(timer); timer = setTimeout(() => { const d = host.saved(); stored.save({ ...d, layout: { ...d.layout, pages: pages.list() } }); }, SAVE_MS); };
  host.app.listen((e) => { if (e.type === 'applied') { pages.prune(placed); if (loaded.ok) save(); } });
  if (loaded.ok) { pages.subscribe(save); save(); }
  else showStatus(document, 'Your saved workspace did not load (see the message); changes are not saved this session, so it is kept as it was.');
}

if (host) {
  const known = new Set<string>();
  const add = (initial: boolean) => {
    const fresh = implementationTemplates(host, document).filter((t) => !known.has(t.dataset['widget']!));
    if (!fresh.length) return;
    for (const t of fresh) known.add(t.dataset['widget']!);
    for (const dock of document.querySelectorAll<HTMLElement & { addTemplate?(t: HTMLTemplateElement): void }>('workspace-dock')) for (const t of fresh) {
      const copy = t.cloneNode(true) as HTMLTemplateElement;
      if (dock.addTemplate) dock.addTemplate(copy);   // defined: read now
      else dock.prepend(copy);   // not yet defined: read when it connects, before the hand-written ones
    }
    if (!initial) document.dispatchEvent(new CustomEvent('catalog:changed', { detail: { name: fresh[0]!.dataset['package'] } }));
  };
  add(true);
  host.app.listen((e) => { if (e.type === 'applied') add(false); });
}
