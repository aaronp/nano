/**
 * The Import dialog (a drawer's Import button, File › Open and Import): paste a nano.json URL and Fetch, or choose a
 * local file, to preview it — a tree of its runtimes and their pods to tick (Import brings only the ticked pods; a
 * subscription left with one end is listed as a warning, never blocking), each runtime with the name it is imported as (`<namespace>.<runtime>` suggested; an
 * existing name merges into that runtime), its pods with the isolation Trust gives them, its modules, and which
 * providers come from another origin, flagging pods that would run with this workspace's full access — then Import
 * (the host's importUrl with the dialog's edit: this Import is the consent, nothing asks again; a refused import is
 * shown as a toast and changes nothing).
 * BACKLOG(7): imports are not remembered; a package by its manifest is not imported.
 */
import type { AppDeployment } from '@pritzlaff/nano-core';
import type { Host } from '../host.ts';
import { foreignOrigin, type Foreign } from '../import.ts';
import { el, row } from '../import-confirm.ts';
import { isolationUnder, renameRuntimes, selectPods, suggestedName, trusted, validRuntimeId, type Trust } from '../import-plan.ts';

type Chosen = { edit(d: AppDeployment): AppDeployment };
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
  known: (coord) => !!host?.registry.provider(coord),
};

const text = (s: string) => document.createTextNode(s);
const list = (title: string, items: Node[]) => (items.length ? [el('h3', title), el('ul', '', ...items)] : []);

/** The pods with their isolation under `trust`, and the providers from another origin (as text, never HTML). */
function pods(d: AppDeployment, base: string, trust: Trust, known: ImportDeps['known']) {
  const items = Object.entries(d.pods).map(([name, p]) => {
    const li = el('li', '', el('b', name), text(' '), el('code', p.implementation), text(' · '), el('span', isolationUnder(p, trust, known)));
    li.dataset['pod'] = name; li.querySelector('span')!.dataset['isolation'] = '';
    return li;
  });
  const foreign: Foreign[] = Object.entries(d.modules ?? {}).flatMap(([coord, m]) => {
    const url = new URL(m, base).href, origin = foreignOrigin(url);
    return origin ? [{ coord, url, origin, pods: Object.entries(d.pods).filter(([, p]) => p.implementation.split('/')[0] === coord).map(([name, p]) => {
      const isolation = isolationUnder(p, trust, known);
      return { name, isolation, fullAccess: isolation !== 'isolated-sandbox' };
    }) }] : [];
  });
  const notice = el('div');
  notice.className = 'foreign';
  if (foreign.length) notice.append(el('h3', 'From another origin'),
    el('p', 'These providers come from another site. A pod in an isolated-sandbox runs apart from this page; any other runs with its full access. Import is your consent.'),
    el('ul', '', ...foreign.map(row)));
  return [...list('Pods', items), notice];
}

function preview(d: AppDeployment, url: string, name: string, known: ImportDeps['known']) {
  const base = url.startsWith('blob:') ? location.href : url;   // a local file's modules resolve against the page
  const box = (key: string, value: string, label: string) => {
    const b = el('input'); b.type = 'checkbox'; b.checked = true; b.dataset[key] = value; b.setAttribute('aria-label', label);
    return b;
  };
  const runtimes = Object.entries(d.runtimes).map(([id, r]) => {
    const input = el('input');
    input.value = suggestedName(d, id, known); input.dataset['runtime'] = id; input.setAttribute('aria-label', `Import runtime ${id} as`);
    const pods = el('ul', '', ...r.pods.map(p => el('li', '', box('selectPod', p, `Import pod ${p}`), text(' '), el('code', p))));
    const li = el('li', '', box('selectRuntime', id, `Import runtime ${id}`), text(' '), el('code', id), text(' as '), input, pods);
    li.dataset['runtimeOf'] = id;
    return li;
  });
  const pane = el('div'); pane.className = 'pods';
  return { nodes: [el('p', '', el('b', name)), ...list('Runtimes', runtimes), pane],
    /** The ticked pods' preview: their isolation under `trust`, the providers from another origin, their modules, and
     * the subscriptions left out (as text). */
    show: (trust: Trust, keep: Set<string>) => {
      const { deployment: s, warnings } = selectPods(d, keep), warn = el('ul', '', ...warnings.map(w => el('li', w)));
      warn.className = 'warnings';
      const modules = Object.entries(s.modules ?? {}).map(([c, m]) => el('li', '', el('code', c), text(' — '), el('code', new URL(m, base).href)));
      pane.replaceChildren(warn, ...pods(s, base, trust, known), ...list('Modules', modules));
    } };
}

/** Opens the dialog. */
export function openImportDialog(doc: Document, deps: ImportDeps = pageDeps) {
  const d = doc.createElement('dialog');
  d.setAttribute('aria-label', 'Import components');
  d.className = 'import-dialog';
  d.innerHTML = `<h2>Import components</h2>
    <form class="row"><input name="url" type="url" required placeholder="https://…/nano.json" aria-label="nano.json URL"><button type="submit" data-fetch>Fetch</button></form>
    <label class="row">Or a file: <input name="file" type="file" accept=".json,application/json" aria-label="nano.json file"></label>
    <fieldset class="trust"><legend>Trust</legend>
      <label><input type="radio" name="trust" value="sandboxed" checked> Sandboxed: runs in an isolated frame</label>
      <label><input type="radio" name="trust" value="trusted"> Trusted: runs in this page</label></fieldset>
    <div class="preview"></div><p role="alert"></p>
    <div class="actions"><button type="button" data-cancel>Cancel</button><button type="button" data-import disabled>Import</button></div>`;
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
    const t = e.target as HTMLInputElement, runtime = t.dataset['selectRuntime'];
    if (t.name !== 'trust' && runtime === undefined && t.dataset['selectPod'] === undefined) return;
    if (runtime !== undefined) for (const b of boxes(`[data-runtime-of="${CSS.escape(runtime)}"] input[data-select-pod]`)) b.checked = t.checked;
    for (const r of boxes('input[data-select-runtime]')) {   // a runtime with some pods ticked is indeterminate
      const pods = boxes(`[data-runtime-of="${CSS.escape(r.dataset['selectRuntime']!)}"] input[data-select-pod]`), on = pods.filter(b => b.checked).length;
      r.checked = on > 0; r.indeterminate = on > 0 && on < pods.length;
    }
    shown?.show(trust(), kept()); check();
  });
  d.addEventListener('input', (e) => { if ((e.target as HTMLElement).dataset?.['runtime']) check(); });
  $<HTMLFormElement>('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    url = $<HTMLInputElement>('input[name="url"]').value.trim();
    button().disabled = true; $('.preview').replaceChildren(); say(''); shown = undefined; got = undefined;
    let file: AppDeployment;
    try { url = new URL(url, location.href).href; file = (await deps.fetchJson(url)) as AppDeployment; } catch (e) { return say(`Couldn't fetch ${url}: ${(e as Error).message}`); }
    if (!file || typeof file !== 'object' || typeof file.pods !== 'object' || file.pods === null) return say(`${url} is not a nano.json: it has no pods.`);
    show(file);
  });
  $<HTMLInputElement>('input[name="file"]').addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    button().disabled = true; $('.preview').replaceChildren(); say(''); shown = undefined; got = undefined;
    let read: AppDeployment;
    try { read = JSON.parse(await file.text()) as AppDeployment; } catch (e) { return say(`Couldn't read ${file.name}: ${(e as Error).message}`); }
    if (!read || typeof read !== 'object' || typeof read.pods !== 'object' || read.pods === null) return say(`${file.name} is not a nano.json: it has no pods.`);
    if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    url = URL.createObjectURL(file);   // imported like any URL
    show(read, file.name);
  });
  $('[data-fetch]').addEventListener('click', (e) => { e.preventDefault(); $<HTMLFormElement>('form').requestSubmit?.() ?? $<HTMLFormElement>('form').dispatchEvent(new Event('submit', { cancelable: true })); });
  $('[data-cancel]').addEventListener('click', () => d.close());
  $('[data-import]').addEventListener('click', async () => {
    button().disabled = true;
    const as = names(), t = trust(), only = kept();
    const done = await deps.importUrl(url, { edit: f => trusted(renameRuntimes(selectPods(f, only).deployment, as), t, deps.known) });   // a failure is a toast
    if (!done.ok) { button().disabled = false; return; }
    document.dispatchEvent(new CustomEvent('nano:changed'));
    d.close();
  });
  d.addEventListener('close', () => d.remove());
  doc.body.append(d);
  d.showModal();
  return d;
}

// every drawer's Import button opens it
document.addEventListener('click', (e) => { if ((e.target as Element | null)?.closest?.('[data-import-open]')) openImportDialog(document); });
