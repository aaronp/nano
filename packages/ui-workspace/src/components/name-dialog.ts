/** Small modal dialogs: `ask` is the shared shell (a native <dialog>; Escape and Cancel resolve with the cancelled value), `askName` and `askConfirm` use it. */
export const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function ask<T>(doc: Document, label: string, html: string, setup: (d: HTMLDialogElement, done: (v: T) => void) => void, cancelled: T): Promise<T> {
  const d = doc.createElement('dialog');
  d.className = 'import-dialog'; d.setAttribute('aria-label', label); d.innerHTML = html;
  return new Promise((resolve) => {
    let value = cancelled;
    d.addEventListener('close', () => { d.remove(); resolve(value); });
    d.querySelector('[data-cancel]')?.addEventListener('click', () => d.close());
    setup(d, (v) => { value = v; d.close(); });
    doc.body.append(d);
    d.showModal();
  });
}

const BUTTONS = (ok: string) => `<div class="actions"><button type="button" data-cancel>Cancel</button><button type="button" data-ok>${esc(ok)}</button></div>`;

/** Asks for a name (1 to 120 characters); null if cancelled. */
export function askName(doc: Document, suggested: string): Promise<string | null> {
  return ask<string | null>(doc, 'Save as', `<h2>Save as</h2>
    <div class="row"><input name="name" maxlength="120" aria-label="Name" value="${esc(suggested)}"></div><p role="alert"></p>${BUTTONS('Save')}`, (d, done) => {
    const input = d.querySelector<HTMLInputElement>('input')!, alert = d.querySelector('[role="alert"]')!;
    const ok = () => { const n = input.value.trim(); if (n) done(n); else alert.textContent = 'Give it a name.'; };
    d.querySelector('[data-ok]')!.addEventListener('click', ok);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } });
  }, null);
}

/** A yes/no question; false if cancelled. */
export function askConfirm(doc: Document, message: string, ok: string): Promise<boolean> {
  return ask<boolean>(doc, 'Confirm', `<p>${esc(message)}</p>${BUTTONS(ok)}`, (d, done) => { d.querySelector('[data-ok]')!.addEventListener('click', () => done(true)); }, false);
}
