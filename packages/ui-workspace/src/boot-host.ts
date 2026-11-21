/**
 * The host on the host core, started before the elements are defined (where composable.ts was): the one Application
 * (host.ts), nano-ui's views, and a palette template per implementation the host can make, before the dock's
 * hand-written ones, so the docks (and the picker they open) list them when they upgrade. An import that registers
 * new providers adds their templates to every dock, and an open picker hears `catalog:changed`.
 *
 * It boots from the host document under `nano-host.document` (the host core's one key, shared with the React host;
 * the old keys read once through its migration and the workspace's `oldForms`, then removed after a good save), its
 * code loaded through the gate (ADR-0034). Its pages are the host core's live outline (`outline`), Main recreated
 * first if missing (`settled`); an import's pages are applied with it (import-pages.ts); the nav and docks show it.
 * Each change is saved by the host core. A stored document that fails to load is kept: the workspace then runs in
 * memory this session, and says so; so it does when another tab writes the document, or storage refuses.
 */
import { defineViews } from '@pritzlaff/nano-ui';
import { toast } from '@pritzlaff/nano-elements';
import { start, type Host } from './host.ts';
import { implementationTemplates } from './dock/panels.ts';
import { showStatus } from './lib/status.ts';
import { oldForms, settled } from './boot-pages.ts';
import { importing } from './import-pages.ts';
import { HOST_PODS } from './host-deploy.ts';
import { forgetOld } from './migrate.ts';

const storage = (() => { try { return localStorage; } catch (e) { const no = () => { throw e; }; return { getItem: no, setItem: no, removeItem: no, key: no, get length() { return no(); } } as unknown as Storage; } })();
/** Why saving stopped, as the page says it. */
const tell = (why: string | undefined) => why && showStatus(document, why.startsWith('not saved')
  ? `Your workspace is not being saved (${why.slice('not saved: '.length)}); it runs in memory until this page closes.`
  : 'Your workspace changed in another tab: reload this page to continue. Changes here are no longer saved.');

defineViews();
let booted: Host | undefined;
const stored = await start(storage, { migrate: oldForms, onStop: () => tell(booted?.stopped()) });
const started = stored.ok ? stored : await start();   // in memory
if (!stored.ok) showStatus(document, `Your saved workspace did not load (${stored.fail.reason}); changes are not saved this session, so it is kept as it was.`);
if (!started.ok) toast(started.fail.reason, { variant: 'bad', duration: 0 });
/** The page's host; undefined if it did not start (a toast says why). */
export const host: Host | undefined = booted = started.ok ? started.value : undefined;
/** The page's pages (ADR-0040): the host core's live outline; undefined without a host. */
export const outline = host?.outline;

if (host && outline) {
  outline.apply(settled(outline.document().doc));
  if (stored.ok) { if (host.stopped()) tell(host.stopped()); else forgetOld(storage); }   // the old dock keys, once the one key holds them
  host.importUrl = importing(host.importUrl.bind(host), outline);
  // the lazy pod `outline` built now (ADR-0031), and again after each restart (Reset), so its `changed` reaches subscribers before anything calls it
  const [, , OUTLINE] = HOST_PODS, build = () => void host.app.runtime('main').getOrCreate(OUTLINE);
  build();
  host.app.listen((e) => { if (e.type === 'restarted' && e.pod === OUTLINE) build(); });
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
