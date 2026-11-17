/**
 * The confirmation before a document is applied (Open, Import, ?src=): the packages it wants to import, each with the
 * trust it asks for, and the instances that would run code in this page. A trusted package runs in this page, so it
 * is unticked and imported sandboxed unless ticked; code is unticked and left out unless ticked. Packages already
 * imported are shown as such. Resolves with the choice, or null (Cancel, Escape): then nothing is changed.
 */
import type { CodeUse, Pick } from '../app/file.ts';
import { ask, esc } from './name-dialog.ts';

type Want = { url: string; trust: 'trusted' | 'sandboxed' };

export function confirmImports(doc: Document, wanted: Want[], already: string[], code: CodeUse[] = []): Promise<Pick | null> {
  const row = (w: Want, i: number) => already.includes(w.url)
    ? `<li><code>${esc(w.url)}</code> <small>already imported</small></li>`
    : w.trust === 'trusted'
      ? `<li><label><input type="checkbox" data-import="${i}"> <code>${esc(w.url)}</code></label><br><small>Asks to be <b>trusted</b>: it would run in this page, with access to everything here. Unticked, it is imported sandboxed.</small></li>`
      : `<li><code>${esc(w.url)}</code> <small>sandboxed: runs in an isolated frame</small></li>`;
  const codeRow = (c: CodeUse, i: number) => `<li><label><input type="checkbox" data-code="${i}"> <code>${esc(c.system)}/${esc(c.instance)}</code> (${esc(c.kind)})</label></li>`;
  const html = `<h2>This app wants to load</h2>
    ${wanted.length ? `<h3>Packages</h3><ul>${wanted.map(row).join('')}</ul>` : ''}
    ${code.length ? `<h3>Code that would run in this page</h3><p><small>These hold JavaScript from the document. Unticked, they are created without it.</small></p><ul>${code.map(codeRow).join('')}</ul>` : ''}
    <div class="actions"><button type="button" data-cancel>Cancel</button><button type="button" data-ok>Continue</button></div>`;
  return ask<Pick | null>(doc, 'Confirm what to load', html, (d, done) => {
    const ticked = (attr: string, i: number) => d.querySelector<HTMLInputElement>(`input[data-${attr}="${i}"]`)?.checked === true;
    d.querySelector('[data-ok]')!.addEventListener('click', () => done({
      imports: wanted.map((w, i) => ({ url: w.url, trust: already.includes(w.url) ? w.trust : w.trust === 'trusted' && ticked('import', i) ? 'trusted' : 'sandboxed' })),
      code: code.filter((_, i) => ticked('code', i)).map((c) => `${c.system}/${c.instance}`),
    }));
  }, null);
}
