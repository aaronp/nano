/**
 * The Import dialog (a drawer's Import button): paste a package's manifest URL, Fetch to preview it — its components
 * and their ops, and the shared libraries it expects against the host's — then Import. A clash or a bad manifest
 * disables Import with the reason; a refused load is shown and adds nothing. Imports are remembered.
 */
import { fetchManifest, loadPackage, pageDeps, type ImportDeps } from '../imports.ts';
import { importsStore, sharedReport, type Manifest } from '../lib/imports.ts';

const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

function preview(m: Manifest, moduleUrl: string, provided: Record<string, string>) {
  const shared = sharedReport(m, provided).map((r) => `<li>${r.ok ? '✓' : '⚠'} ${esc(r.specifier)} ${esc(r.range)} — the host has ${esc(r.provided ?? 'none')}</li>`).join('');
  const comps = m.components.map((c) => `<li><b>${esc(c.title)}</b> <code>${esc(c.kind)}</code> · <code>${esc(c.id)}</code>${c.tag ? ` · <code>&lt;${esc(c.tag)}&gt;</code>` : ''}
    ${c.ops?.length ? `<div class="ops">${c.ops.map((o) => `<code>${o.input ? 'in ' : ''}${esc(o.name)}${o.output ? ' out' : ''}</code>`).join(' ')}</div>` : ''}</li>`).join('');
  return `<p><b>${esc(m.name)} ${esc(m.version)}</b><br><small>module: <code>${esc(moduleUrl)}</code></small></p>
    <h3>Components</h3><ul>${comps}</ul>${shared ? `<h3>Shared libraries</h3><ul>${shared}</ul>` : ''}`;
}

/** Opens the dialog. */
export function openImportDialog(doc: Document, deps: ImportDeps = pageDeps) {
  const d = doc.createElement('dialog');
  d.setAttribute('aria-label', 'Import components');
  d.className = 'import-dialog';
  d.innerHTML = `<h2>Import components</h2>
    <form class="row"><input name="url" type="url" required placeholder="https://…/manifest.json" aria-label="Manifest URL"><button type="submit" data-fetch>Fetch</button></form>
    <fieldset class="trust"><legend>Trust</legend>
      <label><input type="radio" name="trust" value="sandboxed" checked> Sandboxed: runs in an isolated frame</label>
      <label><input type="radio" name="trust" value="trusted"> Trusted: runs in this page</label></fieldset>
    <div class="preview"></div><p role="alert"></p>
    <div class="actions"><button type="button" data-cancel>Cancel</button><button type="button" data-import disabled>Import</button></div>`;
  const $ = <T extends HTMLElement>(s: string) => d.querySelector(s) as T;
  const say = (text: string) => { $('[role="alert"]').textContent = text; };
  const known = () => new Set(importsStore(localStorage).list().map((r) => r.url));
  let url = '';
  $<HTMLFormElement>('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    url = $<HTMLInputElement>('input[name="url"]').value.trim();
    $<HTMLButtonElement>('[data-import]').disabled = true; $('.preview').innerHTML = ''; say('');
    const got = await fetchManifest(url, deps);
    if ('error' in got) return say(got.error);
    const provided = (await deps.fetchJson('./shared/versions.json').catch(() => ({}))) as Record<string, string>;
    $('.preview').innerHTML = preview(got.manifest, new URL(got.manifest.module, url).href, provided);
    if (got.clashes.length) return say(`${got.manifest.name} clashes with what is loaded: ${got.clashes.join(', ')}.${known().has(url) ? ' It is imported already: a newer version takes effect after a reload.' : ''}`);
    $<HTMLButtonElement>('[data-import]').disabled = false;
  });
  $('[data-fetch]').addEventListener('click', (e) => { e.preventDefault(); $<HTMLFormElement>('form').requestSubmit?.() ?? $<HTMLFormElement>('form').dispatchEvent(new Event('submit', { cancelable: true })); });
  $('[data-cancel]').addEventListener('click', () => d.close());
  $('[data-import]').addEventListener('click', async () => {
    $<HTMLButtonElement>('[data-import]').disabled = true;
    const trust = $<HTMLInputElement>('input[value="trusted"]').checked ? 'trusted' : 'sandboxed';
    const got = await loadPackage(url, deps, trust);
    if ('error' in got) return say(got.error);
    importsStore(localStorage).put({ url, name: got.manifest.name, version: got.manifest.version, trust });
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
