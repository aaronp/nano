/**
 * The Import dialog (a drawer's Import button, File › Open and Import): paste a nano.json URL, Fetch to preview it —
 * its pods and their implementations, and the modules it loads — then Import (the host's importUrl: a refused import
 * is shown as a toast and changes nothing).
 * BACKLOG(7): it imported a package by its manifest (components, ops, shared libraries), remembered imports, and
 * honoured the Trust choice; on 0.4 a nano.json is imported, and a module from another origin asks for approval instead.
 */
import type { AppDeployment } from '@pritzlaff/nano-core';
import type { Host } from '../host.ts';

/** How to reach the network and the host: the page's fetch and the host, or stand-ins in tests. */
export type ImportDeps = { fetchJson(url: string): Promise<unknown>; importUrl(url: string): Promise<{ ok: boolean }> };
let host: Host | undefined;
/** The host the dialog imports into (main.ts sets it once started). */
export const setImportHost = (h: Host) => { host = h; };
export const pageDeps: ImportDeps = {
  fetchJson: async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`${r.status} ${r.statusText}`); return r.json(); },
  importUrl: (url) => (host ? host.importUrl(url) : Promise.resolve({ ok: false })),
};

const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

function preview(d: AppDeployment, url: string) {
  const pods = Object.entries(d.pods).map(([name, p]) => `<li><b>${esc(name)}</b> <code>${esc(p.implementation)}</code>${p.isolation ? ` · ${esc(p.isolation)}` : ''}</li>`).join('');
  const modules = Object.entries(d.modules ?? {}).map(([c, m]) => `<li><code>${esc(c)}</code> — <code>${esc(new URL(m, url).href)}</code></li>`).join('');
  return `<p><b>${esc(url)}</b></p>
    <h3>Pods</h3><ul>${pods}</ul>${modules ? `<h3>Modules</h3><ul>${modules}</ul>` : ''}`;
}

/** Opens the dialog. */
export function openImportDialog(doc: Document, deps: ImportDeps = pageDeps) {
  const d = doc.createElement('dialog');
  d.setAttribute('aria-label', 'Import components');
  d.className = 'import-dialog';
  d.innerHTML = `<h2>Import components</h2>
    <form class="row"><input name="url" type="url" required placeholder="https://…/nano.json" aria-label="nano.json URL"><button type="submit" data-fetch>Fetch</button></form>
    <fieldset class="trust"><legend>Trust</legend>
      <label><input type="radio" name="trust" value="sandboxed" checked> Sandboxed: runs in an isolated frame</label>
      <label><input type="radio" name="trust" value="trusted"> Trusted: runs in this page</label></fieldset>
    <div class="preview"></div><p role="alert"></p>
    <div class="actions"><button type="button" data-cancel>Cancel</button><button type="button" data-import disabled>Import</button></div>`;
  const $ = <T extends HTMLElement>(s: string) => d.querySelector(s) as T;
  const say = (text: string) => { $('[role="alert"]').textContent = text; };
  let url = '';
  $<HTMLFormElement>('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    url = $<HTMLInputElement>('input[name="url"]').value.trim();
    $<HTMLButtonElement>('[data-import]').disabled = true; $('.preview').innerHTML = ''; say('');
    let got: AppDeployment;
    try { url = new URL(url, location.href).href; got = (await deps.fetchJson(url)) as AppDeployment; } catch (e) { return say(`Couldn't fetch ${url}: ${(e as Error).message}`); }
    if (!got || typeof got !== 'object' || typeof got.pods !== 'object' || got.pods === null) return say(`${url} is not a nano.json: it has no pods.`);
    $('.preview').innerHTML = preview(got, url);
    $<HTMLButtonElement>('[data-import]').disabled = false;
  });
  $('[data-fetch]').addEventListener('click', (e) => { e.preventDefault(); $<HTMLFormElement>('form').requestSubmit?.() ?? $<HTMLFormElement>('form').dispatchEvent(new Event('submit', { cancelable: true })); });
  $('[data-cancel]').addEventListener('click', () => d.close());
  $('[data-import]').addEventListener('click', async () => {
    $<HTMLButtonElement>('[data-import]').disabled = true;
    const got = await deps.importUrl(url);   // a failure is a toast
    if (!got.ok) { $<HTMLButtonElement>('[data-import]').disabled = false; return; }
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
