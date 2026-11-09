/**
 * <component-drawer for="<dock id>">: a workspace page's second-tier drawer, beside its dock. It lists what the dock
 * can add — Components (the host's catalog) and Widgets (the page's own) — each draggable onto the dock or clicked
 * to add. A small toolbar: Import (coming next), a filter, and a collapse button (remembered per dock).
 * Light DOM, so golden-layout can drag from it; it never imports the dock, only calls its `addSource`.
 */
type Dock = HTMLElement & { addSource?(el: HTMLElement): void };

const SECTIONS = [{ id: 'components', title: 'Components', catalog: true }, { id: 'widgets', title: 'Widgets', catalog: false }];
const key = (dock: string) => `drawer:${dock}`;
const remembered = (dock: string) => { try { return localStorage.getItem(key(dock)) === 'collapsed'; } catch { return false; } };
const remember = (dock: string, collapsed: boolean) => { try { localStorage.setItem(key(dock), collapsed ? 'collapsed' : 'open'); } catch { /* not kept */ } };

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
        <button type="button" class="cd-toggle" aria-label="Collapse the drawer" title="Collapse">«</button></div>
      <button type="button" class="cd-open" aria-label="Open the drawer" title="Components">»</button>
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
    const collapse = (on: boolean) => { this.classList.toggle('collapsed', on); remember(id, on); };
    this.querySelector('.cd-toggle')!.addEventListener('click', () => collapse(true));
    this.querySelector('.cd-open')!.addEventListener('click', () => collapse(false));
    this.classList.toggle('collapsed', remembered(id));
    // the dock makes each entry a drag source once it is defined (it is defined after the page's markup is in place)
    void customElements.whenDefined('workspace-dock').then(() => { for (const a of entries) dock?.addSource?.(a); });
  }
}

if (!customElements.get('component-drawer')) customElements.define('component-drawer', ComponentDrawer);
