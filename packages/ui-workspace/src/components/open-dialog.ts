/**
 * The Open / Import dialog (after the ADR one): drop a nano.json, choose a file, enter a URL, or pick a saved app
 * of this browser; also the working copies kept back at a failed restore, to open or discard. The document is
 * untrusted: it is read up to 1 MB and checked; a problem is shown here and the dialog stays. Resolves with the
 * document (and the saved app's name, if one was picked), or null.
 */
import { MAX_BYTES, checkApp, type NanoApp } from '@composable/shell';
import { fetchApp, parseApp, type Opened } from '../app/file.ts';
import { ask, esc } from './name-dialog.ts';

export type Kept = { key: 'unrestored' | 'bad'; text: string };
const WHAT = { unrestored: 'Last working copy that did not fully restore', bad: 'Last working copy that could not be read' };

export function openDialog(doc: Document, opts: { mode: 'open' | 'import'; apps: Record<string, NanoApp>; kept?: Kept[]; discard?(key: Kept['key']): void; fetchFn?: typeof fetch }): Promise<Opened | null> {
  const { mode, apps, discard } = opts;
  const verb = mode === 'open' ? 'Open' : 'Import';
  const names = Object.keys(apps);
  let kept = opts.kept ?? [];
  const html = `<h2>${verb} an app</h2>
    <div class="drop" style="border:2px dashed var(--line);border-radius:var(--radius);padding:16px;text-align:center;margin-bottom:12px">Drop a nano.json here, or
      <input type="file" accept=".json,application/json" hidden aria-label="Choose a nano.json file"> <button type="button" data-choose>Choose file…</button></div>
    <div class="row"><input type="url" name="url" placeholder="https://…/nano.json" aria-label="Or ${verb.toLowerCase()} from a URL"> <button type="button" data-url>${verb}</button></div>
    <p role="alert"></p>
    ${names.length ? `<h3>Saved in this browser</h3><ul data-saved>${names.map((n, i) => `<li><button type="button" data-app="${i}">${esc(n)}</button></li>`).join('')}</ul>` : ''}
    <div data-kept></div>
    <div class="actions"><button type="button" data-cancel>Cancel</button></div>`;
  return ask<Opened | null>(doc, `${verb} an app`, html, (d, done) => {
    const $ = <T extends HTMLElement>(s: string) => d.querySelector<T>(s)!;
    const say = (t: string) => { $('[role="alert"]').textContent = t; };
    const give = (r: NanoApp | string, kept?: Kept['key']) => { if (typeof r === 'string') say(`Not opened: ${r}.`); else done({ app: r, ...(kept && { own: true, kept }) }); };
    const url = $<HTMLInputElement>('input[name="url"]'), file = $<HTMLInputElement>('input[type="file"]');
    const fromFile = async (f: File | undefined) => {
      if (!f) return say('Drop or choose a .json file.');
      if (f.size > MAX_BYTES) return say('Not opened: larger than 1 MB.');
      try { give(parseApp(await f.text())); } catch { say('That file could not be read.'); }
    };
    const fromUrl = async () => {
      const u = url.value.trim(); if (!u) return;
      const b = $<HTMLButtonElement>('[data-url]'); b.disabled = true; say('');
      const r = await fetchApp(u, doc.baseURI, opts.fetchFn); b.disabled = false;
      give(typeof r === 'string' ? `${u} ${r}` : r);
    };
    $('[data-choose]').addEventListener('click', () => file.click());
    file.addEventListener('change', () => { void fromFile(file.files?.[0]); file.value = ''; });
    const drop = $('.drop');
    drop.addEventListener('dragover', (e) => e.preventDefault());
    drop.addEventListener('drop', (e) => { e.preventDefault(); void fromFile((e as DragEvent).dataTransfer?.files?.[0]); });
    $('[data-url]').addEventListener('click', () => void fromUrl());
    url.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void fromUrl(); } });
    d.querySelectorAll<HTMLButtonElement>('[data-app]').forEach((b) => b.addEventListener('click', () => { const n = names[Number(b.dataset.app)]!; done({ app: apps[n]!, name: n, own: true }); }));
    const showKept = () => {
      $('[data-kept]').innerHTML = kept.length ? `<h3>Kept at the last start-up</h3><ul>${kept.map((k) => `<li>${esc(WHAT[k.key])} <button type="button" data-kopen="${k.key}">Open</button> <button type="button" data-kdiscard="${k.key}">Discard</button></li>`).join('')}</ul>` : '';
      d.querySelectorAll<HTMLButtonElement>('[data-kopen]').forEach((b) => b.addEventListener('click', () => {
        const k = kept.find((x) => x.key === b.dataset.kopen)!;
        let v: unknown; try { v = JSON.parse(k.text); } catch { return say('Not opened: that copy is not JSON.'); }
        give(checkApp(v), k.key);
      }));
      d.querySelectorAll<HTMLButtonElement>('[data-kdiscard]').forEach((b) => b.addEventListener('click', () => { discard?.(b.dataset.kdiscard as Kept['key']); kept = kept.filter((x) => x.key !== b.dataset.kdiscard); showKept(); }));
    };
    showKept();
  }, null);
}
