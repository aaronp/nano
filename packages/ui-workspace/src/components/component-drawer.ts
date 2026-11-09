/**
 * <component-drawer for="<dock id>">: a workspace page's second-tier drawer, beside its dock. It lists what the dock
 * can add — Components (the host's catalog) and Widgets (the page's own) — each draggable onto the dock or clicked
 * to add. A small toolbar: Import (coming next), a filter, and a hide button. Hidden, drawers take no room at all;
 * any [data-toggle-drawer] button (the one beside + in the nav) shows or hides them, and the choice is remembered.
 * Light DOM, so golden-layout can drag from it; it never imports the dock, only calls its `addSource`.
 */
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

  /** Builds the toolbar and the entries, once: moving the drawer keeps them (and their drag sources). */
  private build() {
    const id = this.getAttribute('for') ?? '';
    const dock = this.ownerDocument.getElementById(id) as Dock | null;
    const templates = dock ? [...dock.querySelectorAll<HTMLTemplateElement>(':scope > template[data-widget]')] : [];
    this.innerHTML = `
      <div class="cd-bar"><span class="cd-title">Components</span>
        <button type="button" class="cd-import" disabled title="Import from a URL — coming next">Import</button>
        <button type="button" data-toggle-drawer aria-label="Hide the components drawer" title="Hide (show it again from the button beside + in Workspaces)">«</button></div>
      <input type="search" class="cd-filter" placeholder="Filter" aria-label="Filter components">`;
    const entries: HTMLAnchorElement[] = [];
    for (const s of SECTIONS) {
      const section = Object.assign(this.ownerDocument.createElement('section'), { className: 'cd-section' });
      section.dataset.section = s.id;
      section.append(Object.assign(this.ownerDocument.createElement('h3'), { textContent: s.title }));
      for (const t of templates.filter((t) => t.hasAttribute('data-catalog') === s.catalog)) {
        const a = Object.assign(this.ownerDocument.createElement('a'), { href: '#', textContent: t.dataset.title ?? t.dataset.widget, title: 'Drag onto the workspace, or click to add' });
        a.dataset.dockAdd = id; a.dataset.widget = t.dataset.widget;
        section.append(a); entries.push(a);
      }
      if (section.childElementCount > 1) this.append(section);
    }
    const filter = this.querySelector<HTMLInputElement>('.cd-filter')!;
    filter.addEventListener('input', () => {
      const q = filter.value.trim().toLowerCase();
      for (const a of entries) a.hidden = !a.textContent!.toLowerCase().includes(q);
      for (const s of this.querySelectorAll<HTMLElement>('.cd-section')) s.hidden = ![...s.querySelectorAll('a')].some((a) => !a.hidden);
    });
    // the dock makes each entry a drag source once it is defined (it is defined after the page's markup is in place)
    void customElements.whenDefined('workspace-dock').then(() => { for (const a of entries) dock?.addSource?.(a); });
  }
}

if (!customElements.get('component-drawer')) {
  customElements.define('component-drawer', ComponentDrawer);
  document.addEventListener('click', (e) => {
    if ((e.target as Element | null)?.closest?.('[data-toggle-drawer]')) setDrawersHidden(document, !document.documentElement.hasAttribute('data-drawers-hidden'));
  });
  restoreDrawers(document);
}
