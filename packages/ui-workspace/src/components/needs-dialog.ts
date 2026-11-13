/** The dependency dialogs, on `ask`: the chooser for one need, and the list of an instance's needs with Replace…. */
import { ask, esc } from './name-dialog.ts';

export type Choice = { bind: string } | { make: string } | { import: true };

/** Offers the instances that fit (bind), the kinds that do (make one), and import; null if cancelled. */
export function chooseBinding(doc: Document, need: { ref: string; need: string; implements: string }, options: { candidates: string[]; kinds: string[] }): Promise<Choice | null> {
  const li = (attr: string, value: string, text: string) => `<li><button type="button" ${attr}="${esc(value)}">${esc(text)}</button></li>`;
  return ask<Choice | null>(doc, `Choose ${need.need}`, `<h2>Choose ${esc(need.need)}</h2>
    <p><code>${esc(need.ref)}</code> needs <code>${esc(need.implements)}</code>.</p>
    ${options.candidates.length ? `<h3>Use one that exists</h3><ul>${options.candidates.map((c) => li('data-bind', c, c)).join('')}</ul>` : ''}
    ${options.kinds.length ? `<h3>Make one</h3><ul>${options.kinds.map((k) => li('data-make', k, `New ${k}`)).join('')}</ul>` : ''}
    ${options.candidates.length || options.kinds.length ? '' : '<p>Nothing here fits yet.</p>'}
    <div class="actions"><button type="button" data-cancel>Cancel</button><button type="button" data-import>Import a package…</button></div>`, (d, done) => {
    for (const b of d.querySelectorAll<HTMLButtonElement>('[data-bind]')) b.addEventListener('click', () => done({ bind: b.dataset['bind']! }));
    for (const b of d.querySelectorAll<HTMLButtonElement>('[data-make]')) b.addEventListener('click', () => done({ make: b.dataset['make']! }));
    d.querySelector('[data-import]')!.addEventListener('click', () => done({ import: true }));
  }, null);
}

/** An instance's needs and what each is bound to. Replace… closes the list and runs `replace` for that need; a bound
 * row's Dependencies… closes it and runs `open` for its target (so a headless provider's needs can be reached). */
export async function showDependencies(doc: Document, ref: string, needs: { need: string; implements: string; binding?: string; missing?: boolean }[], replace: (need: string) => Promise<void>, open?: (ref: string) => Promise<void>): Promise<void> {
  const rows = needs.map((n) => `<tr><td>${esc(n.need)}</td><td><code>${esc(n.implements)}</code></td>
    <td>${n.binding ? `<code>${esc(n.binding)}</code>${n.missing ? ' <em>missing</em>' : open ? ` <button type="button" data-open="${esc(n.binding)}">Dependencies…</button>` : ''}` : '<em>not bound</em>'}</td>
    <td><button type="button" data-replace="${esc(n.need)}">Replace…</button></td></tr>`).join('');
  const hidden = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap';
  const picked = await ask<{ replace: string } | { open: string } | null>(doc, 'Dependencies', `<h2>Dependencies</h2><p><code>${esc(ref)}</code></p>
    ${needs.length ? `<table><thead><tr><th>Need</th><th>Interface</th><th>Bound to</th><th><span style="${hidden}">Replace</span></th></tr></thead><tbody>${rows}</tbody></table>` : '<p>It needs nothing.</p>'}
    <div class="actions"><button type="button" data-cancel>Close</button></div>`, (d, done) => {
    for (const b of d.querySelectorAll<HTMLButtonElement>('[data-replace]')) b.addEventListener('click', () => done({ replace: b.dataset['replace']! }));
    for (const b of d.querySelectorAll<HTMLButtonElement>('[data-open]')) b.addEventListener('click', () => done({ open: b.dataset['open']! }));
  }, null);
  if (picked && 'replace' in picked) await replace(picked.replace);
  else if (picked) await open?.(picked.open);
}
