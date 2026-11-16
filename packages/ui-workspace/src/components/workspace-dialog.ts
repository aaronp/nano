/**
 * The dialog that names a workspace: nav title, route (filled from the title until edited), icon, and — when making
 * a new one — its System: an existing one, or "New system…" with a name. Resolves with the choice, or null.
 */
import { ICONS } from '../lib/saved-workspaces.ts';

/** What the dialog asks for, and what it gives back. `system` is absent when no systems were offered. */
export type WorkspaceChoice = { path: string; title: string; icon: string; system?: string; newSystem?: string };

const slug = (title: string) => '/' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const escape = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

export function askWorkspace(doc: Document, opts: { heading: string; systems?: string[]; error?: string; prev?: WorkspaceChoice }): Promise<WorkspaceChoice | null> {
  const { heading, systems, error = '', prev } = opts;
  const d = doc.createElement('dialog');
  d.setAttribute('aria-label', heading);
  d.style.cssText = 'border:var(--card-border, 1px solid #ccc); border-radius:var(--radius, 8px); background:var(--surface); color:var(--fg); font:14px var(--font); padding:20px; width:min(400px, 90vw)';
  const field = 'display:flex; flex-direction:column; gap:4px; margin-bottom:12px';
  const input = 'font:inherit; padding:6px 8px; border:var(--card-border, 1px solid #ccc); border-radius:var(--radius, 6px); background:var(--surface-2); color:var(--fg)';
  d.innerHTML = `<form method="dialog">
    <h2 style="margin:0 0 14px; font:600 16px var(--display, inherit)">${heading}</h2>
    <label style="${field}">Nav title<input name="title" required placeholder="My Workspace" style="${input}"></label>
    <label style="${field}">Route<input name="path" required placeholder="/my-workspace" style="${input}"></label>
    <fieldset style="border:0; padding:0; margin:0 0 12px"><legend style="margin-bottom:6px">Nav icon</legend>
      <style>
        .icon-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(44px, 1fr)); gap:6px; max-height:236px; overflow-y:auto; padding:2px }
        .icon-grid label { display:grid; place-items:center; aspect-ratio:1; border-radius:10px; border:1px solid transparent; background:var(--surface-2); cursor:pointer }
        .icon-grid input { position:absolute; opacity:0; pointer-events:none }
        .icon-grid label:has(input:checked) { border-color:var(--accent); color:var(--accent) }
        .icon-grid label:has(input:focus-visible) { outline:2px solid var(--focus, var(--accent)); outline-offset:1px }
      </style>
      <div class="icon-grid">${Object.keys(ICONS).map((k, i) => `<label title="${k}">
        <input type="radio" name="icon" value="${k}" aria-label="${k}" ${i === 0 ? 'checked' : ''}>
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[k]}"/></svg></label>`).join('')}</div>
    </fieldset>
    ${systems ? `<label style="${field}">System (the runtime its components run in)<select name="system" style="${input}">
        ${systems.map((s) => `<option value="${escape(s)}">${escape(s)}</option>`).join('')}<option value="new">New system…</option></select></label>
      <label class="new-system" style="${field}" hidden>New system's name<input name="newSystem" placeholder="my-system" style="${input}"></label>` : ''}
    <p role="alert" style="margin:0 0 12px; color:var(--danger, #c33); min-height:1em">${escape(error)}</p>
    <div style="display:flex; justify-content:flex-end; gap:8px"><button value="cancel" formnovalidate>Cancel</button><button value="save">Save</button></div>
  </form>`;
  const form = d.querySelector('form')!, el = <T extends Element>(n: string) => form.elements.namedItem(n) as T | null;
  const title = el<HTMLInputElement>('title')!, path = el<HTMLInputElement>('path')!, system = el<HTMLSelectElement>('system');
  let typedPath = false;
  title.addEventListener('input', () => { if (!typedPath) path.value = slug(title.value); });
  path.addEventListener('input', () => { typedPath = true; });
  const showNew = () => { const l = d.querySelector<HTMLElement>('.new-system'); if (l && system) l.hidden = system.value !== 'new'; };
  system?.addEventListener('change', showNew);
  if (prev) {
    title.value = prev.title; path.value = prev.path; typedPath = true;
    const radio = form.querySelector<HTMLInputElement>(`input[name="icon"][value="${prev.icon}"]`); if (radio) radio.checked = true;
    if (system && prev.system) { system.value = prev.system; el<HTMLInputElement>('newSystem')!.value = prev.newSystem ?? ''; showNew(); }
  }
  doc.body.append(d);
  d.showModal();
  return new Promise((resolve) => d.addEventListener('close', () => {
    const f = new FormData(form), get = (n: string) => String(f.get(n) ?? '');
    d.remove();
    if (d.returnValue !== 'save') return resolve(null);
    resolve({ path: get('path').trim(), title: get('title'), icon: get('icon'), ...(system ? { system: get('system'), newSystem: get('newSystem').trim() } : {}) });
  }));
}
