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
import { el } from '../import-confirm.ts';
import { isolationUnder, ownProvider, renameRuntimes, selectPods, suggestedName, trusted, validRuntimeId, type Trust } from '../import-plan.ts';

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
  known: (coord) => ownProvider(!!host?.registry.provider(coord), host?.data().modules?.[coord]),
};

const text = (s: string) => document.createTextNode(s);
const list = (title: string, items: Node[]) => (items.length ? [el('h3', title), el('ul', '', ...items)] : []);

/** The providers from another origin, in one line: where from, and (strong) each pod that would run with this page's
 * full access; the modules behind a Details (as text, never HTML). */
function origins(d: AppDeployment, base: string, trust: Trust, known: ImportDeps['known']) {
  const foreign: Foreign[] = Object.entries(d.modules ?? {}).flatMap(([coord, m]) => {
    const url = new URL(m, base).href, origin = foreignOrigin(url);
    return origin ? [{ coord, url, origin, pods: Object.entries(d.pods).filter(([, p]) => p.implementation.split('/')[0] === coord).map(([name, p]) => {
      const isolation = isolationUnder(p, trust, known);
      return { name, isolation, fullAccess: isolation !== 'isolated-sandbox' && isolation !== 'home-origin' };
    }) }] : [];
  });
  const notice = el('div');
  notice.className = 'foreign';
  const full = foreign.flatMap(f => f.pods.filter(p => p.fullAccess).map(p => p.name));
  if (foreign.length) notice.append(
    el('p', '', text(`Code from ${[...new Set(foreign.map(f => f.origin))].join(', ')} (${foreign.map(f => f.coord).join(', ')}). `),
      ...(full.length ? [text('⚠ With this workspace’s full access: '), ...full.flatMap((n, i) => [...(i ? [text(', ')] : []), el('strong', n)]), text('. Import is your consent.')]
        : [text('Every pod from there runs isolated.')])));
  const modules = Object.entries(d.modules ?? {}).map(([c, m]) => el('li', '', el('code', c), text(' — '), el('code', new URL(m, base).href)));
  const more = el('details', '', el('summary', 'Modules'), el('ul', '', ...modules));
  return modules.length ? [notice, more] : [notice];
}

function preview(d: AppDeployment, url: string, name: string, known: ImportDeps['known']) {
  const base = url.startsWith('blob:') ? location.href : url;   // a local file's modules resolve against the page
  const box = (key: string, value: string, label: string) => {
    const b = el('input'); b.type = 'checkbox'; b.checked = true; b.dataset[key] = value; b.setAttribute('aria-label', label);
    return b;
  };
  const runtime = ([id, r]: [string, AppDeployment['runtimes'][string]]) => {
    // the name it is imported as: text, with an edit button (shown on hover) that opens the field
    const input = el('input'), shown = el('code', ''), edit = el('button', '✎');
    input.value = suggestedName(d, id, known); input.dataset['runtime'] = id; input.setAttribute('aria-label', `Import runtime ${id} as`); input.hidden = true;
    shown.textContent = input.value;
    edit.type = 'button'; edit.className = 'edit'; edit.setAttribute('aria-label', `Rename runtime ${id}`);
    edit.addEventListener('click', () => { shown.hidden = true; edit.hidden = true; input.hidden = false; input.focus(); input.select(); });
    input.addEventListener('input', () => { shown.textContent = input.value; });
    const pods = el('ul', '', ...r.pods.map(p => {
      const badge = el('span'); badge.dataset['isolation'] = ''; badge.className = 'badge';
      const li = el('li', '', box('selectPod', p, `Import pod ${p}`), text(' '), el('code', p), text(' '), badge); li.dataset['pod'] = p; return li;
    }));
    const li = el('li', '', box('selectRuntime', id, `Import runtime ${id}`), text(' '), shown, input, edit, pods);
    li.dataset['runtimeOf'] = id; li.className = 'runtime';
    return li;
  };
  /** Runtimes by namespace (the id less its last segment): `example.chat` holds example.chat.room and .backend. */
  const groups = Map.groupBy(Object.entries(d.runtimes), ([id]) => id.includes('.') ? id.slice(0, id.lastIndexOf('.')) : id);
  const runtimes = [...groups].map(([ns, rs]) => {
    const li = el('li', '', box('selectGroup', ns, `Import all of ${ns}`), text(' '), el('b', ns), el('ul', '', ...rs.map(runtime)));
    li.dataset['groupOf'] = ns; li.className = 'group';
    return li;
  });
  const pane = el('div'); pane.className = 'pods';
  const tree = el('div', '', ...list('Runtimes', runtimes));
  return { nodes: [el('p', '', el('b', name)), tree, pane],
    /** Each pod's isolation under `trust`, the warnings under their pods, and the ticked pods' origins and modules. */
    show: (trust: Trust, keep: Set<string>) => {
      const { deployment: s, warnings } = selectPods(d, keep);
      for (const li of tree.querySelectorAll<HTMLElement>('[data-pod]')) li.querySelector('[data-isolation]')!.textContent = isolationUnder(d.pods[li.dataset['pod']!]!, trust, known);
      for (const old of tree.querySelectorAll('.warning')) old.remove();
      for (const w of warnings) {   // each under the pod it concerns
        const p = el('p', `⚠ ${w.text}`); p.className = 'warning';
        tree.querySelector(`[data-pod="${CSS.escape(w.pod)}"]`)?.append(p);
      }
      pane.replaceChildren(...origins(s, base, trust, known));
    } };
}

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
  $<HTMLFormElement>('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    url = $<HTMLInputElement>('input[name="url"]').value.trim();
    button().disabled = true; $('.preview').replaceChildren(); say(''); shown = undefined; got = undefined;
    let file: AppDeployment;
    try { url = new URL(url, location.href).href; file = (await deps.fetchJson(url)) as AppDeployment; } catch (e) { return say(`Couldn't fetch ${url}: ${(e as Error).message}`); }
    if (!file || typeof file !== 'object' || typeof file.pods !== 'object' || file.pods === null) return say(`${url} is not a nano.json: it has no pods.`);
    show(file);
  });
  const load = async (file: File | undefined) => {
    if (!file) return;
    button().disabled = true; $('.preview').replaceChildren(); say(''); shown = undefined; got = undefined;
    let read: AppDeployment;
    try { read = JSON.parse(await file.text()) as AppDeployment; } catch (e) { return say(`Couldn't read ${file.name}: ${(e as Error).message}`); }
    if (!read || typeof read !== 'object' || typeof read.pods !== 'object' || read.pods === null) return say(`${file.name} is not a nano.json: it has no pods.`);
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
