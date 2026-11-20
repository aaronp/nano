/**
 * The host on nano-core 0.4, started before the elements are defined (where composable.ts was): the one Application
 * (host.ts), nano-ui's views, and a palette template per implementation the host can make, before the dock's
 * hand-written ones, so the docks (and the picker they open) list them when they upgrade. An import that registers
 * new providers adds their templates to every dock, and an open picker hears `catalog:changed`.
 *
 * It boots from the stored document (persist.ts), the app's own (ADR-0034): imported as any file is, so nano.ui and
 * same-origin providers ask nothing and a foreign provider is confirmed first. Its pages are the Platform's (ADR-0038):
 * `platform`, made once for the page's life, from the stored pages, else migrated once (boot-pages.ts), and changed only
 * by its `apply`; an import's pages are applied with it (import-pages.ts); the nav and docks show it. Both documents
 * are saved, debounced (flushed on `pagehide`), on each `applied` and page change. A stored document or pages that fail to load, or that another tab has written since, are not saved over this
 * session. Storage the page may not use: the app runs in memory, and the first save says so.
 */
import { defineViews } from '@pritzlaff/nano-ui';
import { Platform } from '@pritzlaff/nano-platform';
import { toast } from '@pritzlaff/nano-elements';
import { start, type Host } from './host.ts';
import { implementationTemplates } from './dock/panels.ts';
import { persisted } from './persist.ts';
import { showStatus } from './lib/status.ts';
import { bootPages } from './boot-pages.ts';
import { importing } from './import-pages.ts';

const KEY = 'nano-workspace.document', PAGES_KEY = 'nano-workspace.platform', SAVE_MS = 300;
const storage = (() => { try { return localStorage; } catch (e) { const no = () => { throw e; }; return { getItem: no, setItem: no, removeItem: no, key: no, get length() { return no(); } } as unknown as Storage; } })();
const stored = persisted(storage, KEY, PAGES_KEY), doc = stored.load();

defineViews();
const started = await start(() => platform);
if (!started.ok) toast(started.fail.reason, { variant: 'bad', duration: 0 });
/** The page's host; undefined if it did not start (a toast says why). */
export const host: Host | undefined = started.ok ? started.value : undefined;
const at = host && doc && URL.createObjectURL(new Blob([JSON.stringify(doc)], { type: 'application/json' }));
const loaded = host && at ? await host.importUrl(at).finally(() => URL.revokeObjectURL(at)) : { ok: true };
const first = host ? await bootPages(host, storage, doc, stored.pages(), loaded.ok) : undefined;
/** The page's pages (ADR-0038): one Platform for the page's life; undefined without a host. */
const startWith = first?.ok ? first : host && await bootPages(host, storage, null, null, false);   // pages that failed: Main alone
export const platform = host && startWith?.ok ? Platform.create(host.app, host.registry, startWith.value) : undefined;

if (host && platform) {
  host.importUrl = importing(host.importUrl.bind(host), platform);
  let timer: ReturnType<typeof setTimeout> | undefined, elsewhere = !loaded.ok || !first?.ok;
  const write = () => { timer = undefined; if (!elsewhere) stored.save(host.saved(), platform.document().doc); };
  const save = () => { clearTimeout(timer); timer = setTimeout(write, SAVE_MS); };
  addEventListener('pagehide', () => { if (timer !== undefined) { clearTimeout(timer); write(); } });
  // Another tab saved the document or its pages: this tab's copy is stale, so it saves no more (the last writer would win).
  addEventListener('storage', (e) => {
    const k = (e as StorageEvent).key;
    if ((k !== KEY && k !== PAGES_KEY) || elsewhere) return;
    elsewhere = true; clearTimeout(timer);
    showStatus(document, 'Your workspace changed in another tab: reload this page to continue. Changes here are no longer saved.');
  });
  host.app.listen((e) => { if (e.type === 'applied') save(); });
  platform.listen(save);
  if (!loaded.ok) showStatus(document, 'Your saved workspace did not load (see the message); changes are not saved this session, so it is kept as it was.');
  else if (first && !first.ok) showStatus(document, `Your saved pages did not load (${first.fail.reason}); changes are not saved this session, so they are kept as they were.`);
  else save();
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
