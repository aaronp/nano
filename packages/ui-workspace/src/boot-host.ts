/**
 * The host on nano-core 0.4, started before the elements are defined (where composable.ts was): the one Application
 * (host.ts), nano-ui's views, and a palette template per implementation the host can make, before the dock's
 * hand-written ones, so the docks (and the picker they open) list them when they upgrade. An import that registers
 * new providers adds their templates to every dock, and an open picker hears `catalog:changed`.
 *
 * It boots from the stored document (persist.ts), the app's own (ADR-0034): imported as a file the person chose, so
 * nano.ui and same-origin providers ask nothing and a foreign provider's code asks once per session, as any import's.
 * `pages` (lib/pages.ts) is seeded from its `layout.pages`, else the old keys (`migrate`), else Main alone, and is the
 * run-time truth for pages from then on. The document is saved, debounced, on each `applied` and page change; pod
 * slots whose pod went are pruned on `applied`. A stored document that fails to load is not saved over this session.
 */
import { defineViews, pagesOf } from '@pritzlaff/nano-ui';
import { toast } from '@pritzlaff/nano-elements';
import { start, type Host } from './host.ts';
import { implementationTemplates } from './dock/panels.ts';
import { pageStore } from './lib/pages.ts';
import { persisted } from './persist.ts';
import { showStatus } from './lib/status.ts';

const KEY = 'nano-workspace.document', SAVE_MS = 300;
const stored = persisted(localStorage, KEY), doc = stored.load(), kept = pagesOf(doc?.layout);
let live: Host | undefined;
const placed = (runtime: string, pod: string) => !!live?.app.deployment().runtimes[runtime]?.pods.includes(pod);
/** The page's pages: the run-time truth for `layout.pages` (lib/pages.ts). */
export const pages = pageStore(kept.length ? kept : stored.migrate(localStorage), placed);

defineViews();
const started = await start(pages);
if (!started.ok) toast(started.fail.reason, { variant: 'bad', duration: 0 });
/** The page's host; undefined if it did not start (a toast says why). */
export const host: Host | undefined = live = started.ok ? started.value : undefined;

if (host) {
  const at = doc && URL.createObjectURL(new Blob([JSON.stringify(doc)], { type: 'application/json' }));
  const loaded = at ? await host.importUrl(at, { edit: d => d }).finally(() => URL.revokeObjectURL(at)) : { ok: true };
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
