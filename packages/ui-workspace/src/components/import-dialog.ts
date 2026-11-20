/**
 * The Import dialog (File › Open and Import): paste a nano.json URL and Fetch, or choose a
 * local file, to preview it — a tree of its runtimes and their pods to tick (Import brings only the ticked pods; a
 * subscription left with one end is listed as a warning, never blocking), each runtime with the name it is imported as (`<namespace>.<runtime>` suggested; an
 * existing name merges into that runtime), its pods with the isolation Trust gives them, its modules, and which
 * providers come from another origin, flagging pods that would run with this workspace's full access — then Import
 * (the host's importUrl with the dialog's edit: this Import is the consent, nothing asks again; a refused import is
 * shown as a toast and changes nothing).
 * BACKLOG(7): imports are not remembered; a package by its manifest is not imported.
 */
import type { AppDeployment } from '@pritzlaff/nano-core';
import type { UIDeployment } from '@pritzlaff/nano-platform';
import { opened } from '../migrate.ts';
import type { Host } from '../host.ts';
import { ownProvider, renameRuntimes, selectPods, trusted, validRuntimeId, type Trust } from '../import-plan.ts';
import { preview } from './import-preview.ts';

/** The dialog's edit of the file: of its app (`edit`) and, the same choices, of its pages (`pages`). */
type Chosen = { edit(d: AppDeployment): AppDeployment; pages(p: UIDeployment): UIDeployment };
/** How to reach the network and the host: the page's fetch and the host, or stand-ins in tests. */
export type ImportDeps = { fetchJson(url: string): Promise<unknown>; importUrl(url: string, chosen?: Chosen): Promise<{ ok: boolean }>;
  /** Whether the workspace already has provider `coord` (its pods are not new code: Trust leaves them as the file says). */
  known(coord: string): boolean };
let host: Host | undefined;
/** The host the dialog imports into (main.ts sets it once started). */
export const setImportHost = (h: Host) => { host = h; };
export const pageDeps: ImportDeps = {
  fetchJson: async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`${r.status} ${r.statusText}`); return r.json(); },
  importUrl: (url, chosen) => (host ? host.importUrl(url, chosen) : Promise.resolve({ ok: false })),
  known: (coord) => ownProvider(!!host?.registry.provider(coord), host?.data().modules?.[coord]),
};

/** Opens the dialog. */
export function openImportDialog(doc: Document, deps: ImportDeps = pageDeps) {
  const d = doc.createElement('dialog');
  d.setAttribute('aria-label', 'Import components');
  d.className = 'import-dialog';
  d.innerHTML = `<div class="head"><h2>Import components</h2><button type="button" class="icon" data-close aria-label="Close">×</button></div>
    <div class="drop"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7M5 3h14"/></svg>
      <span>Drop a nano.json here, or</span><input name="file" type="file" accept=".json,application/json" aria-label="nano.json file" hidden>
      <button type="button" data-choose>Choose file…</button></div>
    <form><label class="field" for="import-url">Or import from a URL</label>
      <div class="row"><input id="import-url" name="url" type="url" required placeholder="https://…/nano.json" aria-label="nano.json URL"><button type="submit" class="primary" data-fetch>Fetch</button></div></form>
    <fieldset class="trust"><legend class="field">Trust</legend>
      <label><input type="radio" name="trust" value="sandboxed" checked><span><b>Sandboxed</b><small>runs in an isolated frame</small></span></label>
      <label><input type="radio" name="trust" value="trusted"><span><b>Trusted</b><small>runs in this page</small></span></label></fieldset>
    <div class="preview"></div><p role="alert"></p>
    <div class="actions"><button type="button" data-cancel>Cancel</button><button type="button" class="primary" data-import disabled>Import</button></div>`;
  const $ = <T extends HTMLElement>(s: string) => d.querySelector(s) as T;
  const say = (text: string) => { $('[role="alert"]').textContent = text; };
  const button = () => $<HTMLButtonElement>('[data-import]');
  const trust = () => ([...d.querySelectorAll<HTMLInputElement>('input[name="trust"]')].find(r => r.checked)?.value ?? 'sandboxed') as Trust;
  let url = '', shown: ReturnType<typeof preview> | undefined, got: AppDeployment | undefined;
  const show = (file: AppDeployment, name = url) => {
    got = file; shown = preview(file, url, name, deps.known);
    $('.preview').replaceChildren(...shown.nodes); shown.show(trust(), kept());
    button().disabled = false;
  };
  const boxes = (s: string) => [...d.querySelectorAll<HTMLInputElement>(s)];
  /** The pods to import: every pod but those unticked in the tree (a pod in no runtime is not in it, and stays). */
  const unticked = () => new Set(boxes('input[data-select-pod]').filter(b => !b.checked).map(b => b.dataset['selectPod']!));
  const kept = () => new Set(Object.keys(got?.pods ?? {}).filter(p => !unticked().has(p)));
  const names = () => Object.fromEntries([...d.querySelectorAll<HTMLInputElement>('input[data-runtime]')].map(i => [i.dataset['runtime']!, i.value.trim()]));
  /** Import is enabled once each runtime has a valid name and some pod is ticked. */
  const check = () => {
    const bad = Object.values(names()).find(n => !validRuntimeId(n));
    button().disabled = bad !== undefined || !kept().size;
    say(bad === undefined ? '' : bad ? `“${bad}” is not a runtime name: no /, spaces or #, at most 64 characters.` : 'Name each runtime.');
  };
  d.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement, runtime = t.dataset['selectRuntime'], group = t.dataset['selectGroup'];
    if (t.name !== 'trust' && runtime === undefined && group === undefined && t.dataset['selectPod'] === undefined) return;
    const under = (attr: string, v: string) => boxes(`[${attr}="${CSS.escape(v)}"] input[data-select-pod]`);
    if (runtime !== undefined) for (const b of under('data-runtime-of', runtime)) b.checked = t.checked;
    if (group !== undefined) for (const b of under('data-group-of', group)) b.checked = t.checked;
    // a runtime or namespace with some of its pods ticked is indeterminate
    for (const [sel, attr, key] of [['input[data-select-runtime]', 'data-runtime-of', 'selectRuntime'], ['input[data-select-group]', 'data-group-of', 'selectGroup']] as const)
      for (const r of boxes(sel)) {
        const pods = under(attr, r.dataset[key]!), on = pods.filter(b => b.checked).length;
        r.checked = on > 0; r.indeterminate = on > 0 && on < pods.length;
      }
    shown?.show(trust(), kept()); check();
  });
  d.addEventListener('input', (e) => { if ((e.target as HTMLElement).dataset?.['runtime']) check(); });
  const reset = () => { button().disabled = true; $('.preview').replaceChildren(); say(''); shown = undefined; got = undefined; };
  /** The app of `file` (a nano.json, or a `{ app, platform }` bundle's), if it has pods; if not, says so of `name`. */
  const asDeployment = (file: unknown, name: string): AppDeployment | undefined => {
    const o = opened(file), x = o.ok ? o.value.app : undefined;
    if (!o.ok) say(`${name}: ${o.fail.reason}`);
    else if (!x || typeof x !== 'object' || typeof x.pods !== 'object' || x.pods === null) say(`${name} is not a nano.json: it has no pods.`);
    else return x;
    return undefined;
  };
  $<HTMLFormElement>('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    url = $<HTMLInputElement>('input[name="url"]').value.trim();
    reset();
    let file: unknown;
    try { url = new URL(url, location.href).href; file = await deps.fetchJson(url); } catch (e) { return say(`Couldn't fetch ${url}: ${(e as Error).message}`); }
    const app = asDeployment(file, url);
    if (app) show(app);
  });
  const load = async (file: File | undefined) => {
    if (!file) return;
    reset();
    let read: AppDeployment | undefined;
    try { read = asDeployment(JSON.parse(await file.text()), file.name); } catch (e) { return say(`Couldn't read ${file.name}: ${(e as Error).message}`); }
    if (!read) return;
    if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    url = URL.createObjectURL(file);   // imported like any URL
    show(read, file.name);
  };
  $<HTMLInputElement>('input[name="file"]').addEventListener('change', (e) => { const i = e.target as HTMLInputElement; void load(i.files?.[0]); });
  $('[data-choose]').addEventListener('click', () => $<HTMLInputElement>('input[name="file"]').click());
  const drop = $('.drop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('on'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('on'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('on'); void load(e.dataTransfer?.files[0]); });
  $('[data-close]').addEventListener('click', () => d.close());
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });   // the backdrop
  $('[data-fetch]').addEventListener('click', (e) => { e.preventDefault(); $<HTMLFormElement>('form').requestSubmit?.() ?? $<HTMLFormElement>('form').dispatchEvent(new Event('submit', { cancelable: true })); });
  $('[data-cancel]').addEventListener('click', () => d.close());
  $('[data-import]').addEventListener('click', async () => {
    button().disabled = true;
    const as = names(), t = trust(), only = kept();
    const done = await deps.importUrl(url, { edit: f => trusted(renameRuntimes(selectPods(f, only).deployment, as), t, deps.known), pages: p => renameRuntimes(selectPods(p, only), as) });   // a failure is a toast
    if (!done.ok) { button().disabled = false; return; }
    d.close();
  });
  d.addEventListener('close', () => d.remove());
  doc.body.append(d);
  d.showModal();
  return d;
}
