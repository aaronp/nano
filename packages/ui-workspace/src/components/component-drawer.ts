/**
 * <component-drawer for="<dock id>">: a workspace page's second-tier drawer, beside its dock. It lists what the dock
 * can add — Components (the host's catalog) and Widgets (the page's own) — each draggable onto the dock or clicked
 * to add, and Imported (packages imported from a URL, each with remove). A small toolbar: Import, a filter, and a hide
 * button. Hidden, drawers take no room at all;
 * any [data-toggle-drawer] button (the one beside + in the nav) shows or hides them, and the choice is remembered.
 * Light DOM, so golden-layout can drag from it; it never imports the dock, only calls its `addSource`.
 */
import { importFailures } from '../lib/import-failures.ts';

type Dock = HTMLElement & { addSource?(el: HTMLElement): void };

const SECTIONS = [{ id: 'components', title: 'Components', catalog: true }, { id: 'widgets', title: 'Widgets', catalog: false }];
const HIDDEN = 'drawers:hidden';

/** Shows or hides every components drawer (the page's root carries `data-drawers-hidden`), and remembers it. */
export function setDrawersHidden(doc: Document, hidden: boolean) {
  doc.documentElement.toggleAttribute('data-drawers-hidden', hidden);
  try { localStorage.setItem(HIDDEN, String(hidden)); } catch { /* not kept */ }
  for (const b of doc.querySelectorAll('[data-toggle-drawer]')) if (!b.closest('component-drawer')) b.setAttribute('aria-pressed', String(!hidden));
}
/** Puts back the remembered choice. */
export function restoreDrawers(doc: Document) {
  let hidden = false;
  try { hidden = localStorage.getItem(HIDDEN) === 'true'; } catch { /* not kept */ }
  setDrawersHidden(doc, hidden);
}

export class ComponentDrawer extends HTMLElement {
  #built = false;
  // after the current task's markup is in (its dock may follow it in the page)
  connectedCallback() { if (!this.#built) { this.#built = true; queueMicrotask(() => this.build()); } }

  #dock: Dock | null = null;

  /** Builds the toolbar and the entries, once: moving the drawer keeps them (and their drag sources). */
  private build() {
    const id = this.getAttribute('for') ?? '';
    this.#dock = this.ownerDocument.getElementById(id) as Dock | null;
    const templates = this.#templates();
    this.innerHTML = `
      <div class="cd-bar"><span class="cd-title">Components</span>
        <button type="button" data-import-open title="Import components from a manifest URL">Import</button>
        <button type="button" data-toggle-drawer aria-label="Hide the components drawer" title="Hide (show it again from the button beside + in Workspaces)">«</button></div>
      <input type="search" class="cd-filter" placeholder="Filter" aria-label="Filter components">`;
    for (const s of SECTIONS) {
      const section = this.#section(s.id, s.title);
      for (const t of templates.filter((t) => t.hasAttribute('data-catalog') === s.catalog && !t.dataset.package)) section.append(this.#entry(t));
      if (section.childElementCount > 1) this.append(section);
    }
    this.#imported();
    const filter = this.querySelector<HTMLInputElement>('.cd-filter')!;
    filter.addEventListener('input', () => this.#filter());
    this.ownerDocument.addEventListener('catalog:changed', () => this.#imported());
    this.ownerDocument.addEventListener('imports:failed', () => this.#imported());
  }

  #templates = () => (this.#dock ? [...this.#dock.querySelectorAll<HTMLTemplateElement>(':scope > template[data-widget]')] : []);
  #section(id: string, title: string) {
    const section = Object.assign(this.ownerDocument.createElement('section'), { className: 'cd-section' });
    section.dataset.section = id;
    section.append(Object.assign(this.ownerDocument.createElement('h3'), { textContent: title }));
    return section;
  }
  /** An entry for a template: draggable onto the dock, or clicked to add (once the dock is defined). Made once per
   * template, so rebuilding a section never registers it with the dock twice. */
  #entries = new WeakMap<HTMLTemplateElement, HTMLAnchorElement>();
  #entry(t: HTMLTemplateElement) {
    const made = this.#entries.get(t);
    if (made) return made;
    const a = Object.assign(this.ownerDocument.createElement('a'), { href: '#', textContent: t.dataset.title ?? t.dataset.widget, title: 'Drag onto the workspace, or click to add' });
    a.dataset.dockAdd = this.getAttribute('for') ?? ''; a.dataset.widget = t.dataset.widget;
    void customElements.whenDefined('workspace-dock').then(() => this.#dock?.addSource?.(a));
    this.#entries.set(t, a);
    return a;
  }
  #filter() {
    const q = this.querySelector<HTMLInputElement>('.cd-filter')?.value.trim().toLowerCase() ?? '';
    for (const a of this.querySelectorAll<HTMLAnchorElement>('.cd-section a')) a.hidden = !a.textContent!.toLowerCase().includes(q);
    for (const s of this.querySelectorAll<HTMLElement>('.cd-section')) s.hidden = ![...s.querySelectorAll('a')].some((a) => !a.hidden);
  }
  /** (Re)builds the Imported section: each package's entries under its name, with remove; and imports that failed. */
  #imported() {
    this.querySelector('[data-section="imported"]')?.remove();
    const section = this.#section('imported', 'Imported'), byPackage = new Map<string, HTMLTemplateElement[]>();
    for (const t of this.#templates()) if (t.dataset.package) byPackage.set(t.dataset.package, [...(byPackage.get(t.dataset.package) ?? []), t]);
    for (const [name, ts] of byPackage) {
      const h = Object.assign(this.ownerDocument.createElement('h4'), { textContent: name });
      const x = Object.assign(this.ownerDocument.createElement('button'), { type: 'button', textContent: '✕', title: `Forget ${name} (its components stay until you reload)` });
      x.setAttribute('aria-label', `Remove ${name}`);
      x.addEventListener('click', () => this.ownerDocument.dispatchEvent(new CustomEvent('imports:remove', { detail: { url: ts[0]!.dataset.packageUrl, name } })));
      h.append(x);
      section.append(h, ...ts.map((t) => this.#entry(t)));
    }
    for (const f of importFailures()) section.append(Object.assign(this.ownerDocument.createElement('p'), { className: 'cd-failed', textContent: `${f.url}: ${f.error}` }));
    if (section.childElementCount > 1) this.append(section);
    this.#filter();
  }
}


if (!customElements.get('component-drawer')) {
  customElements.define('component-drawer', ComponentDrawer);
  document.addEventListener('click', (e) => {
    if ((e.target as Element | null)?.closest?.('[data-toggle-drawer]')) setDrawersHidden(document, !document.documentElement.hasAttribute('data-drawers-hidden'));
  });
  restoreDrawers(document);
}
