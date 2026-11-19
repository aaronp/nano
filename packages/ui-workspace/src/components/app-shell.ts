/**
 * <app-shell>: app bar, navigation drawer, content area and status bar.
 *
 *   <app-shell>
 *     <span slot="title">Name</span>              app bar title
 *     <nano-file-menu slot="title-actions">      beside the title
 *     <nano-app-bar name="app" slot="title-actions"> after it: the page's or focused panel's controls (the app bar sits above the content, so their menus aren't covered)
 *     <nano-profile name="profile" slot="actions"></nano-profile> app bar controls (right side)
 *     <a slot="nav" href="#/workspace">Workspace</a>       one per page, in order (icons welcome)
 *     <a slot="nav" data-sub href="…">…</a>        a sub-item listed under the item before it
 *     <div slot="drawer-footer">…</div>            bottom of the drawer
 *     <span slot="footer">…</span>                 status bar
 *     <app-route path="/inbox">…</app-route>       pages; path="*" is the not-found page
 *   </app-shell>
 *
 * Wide screens (> 840px) show a persistent drawer that the menu button slides down to an icon rail (the host gets
 * [collapsed], so light-DOM styles can hide a nav item's extras); narrow screens use a modal drawer. The app bar shows
 * the current page's nav icon and label beside the title. <app-route bleed> removes the content padding (for split panes and workspaces).
 * Bus topics: route:changed {path} · shell:drawer {open}.
 * Theme: reads the tokens from src/lib/themes.ts (var(--bg), var(--accent), …).
 */
import { LitElement, html } from 'lit';
import { appShellStyles } from './app-shell-styles.ts';
import { createBus, provideBus, type Bus, type Unsubscribe } from '../lib/bus.ts';
import { isCurrent, resolveRoute } from '../lib/routes.ts';

export class AppRoute extends HTMLElement {}

const NARROW = '(max-width: 840px)';

export class AppShell extends LitElement {
  static override properties = { narrow: { type: Boolean, reflect: true }, collapsed: { type: Boolean, reflect: true }, route: { state: true }, page: { state: true } };
  declare narrow: boolean;
  declare collapsed: boolean;
  declare route: string;
  /** The current page's nav item, shown in the app bar: its label and a copy of its icon. */
  declare page: { href: string; label: string; icon: Node | null } | null;
  readonly bus: Bus = createBus();
  private stopProviding: Unsubscribe | null = null;
  private readonly mq = matchMedia(NARROW);

  static override styles = appShellStyles;

  constructor() {
    super();
    this.narrow = this.mq.matches; this.collapsed = false; this.route = ''; this.page = null;
  }

  override connectedCallback() {
    super.connectedCallback();
    this.stopProviding = provideBus(this, this.bus);
    this.mq.addEventListener('change', this.onMq);
    addEventListener('hashchange', this.applyRoute);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.stopProviding?.();
    this.stopProviding = null;
    this.mq.removeEventListener('change', this.onMq);
    removeEventListener('hashchange', this.applyRoute);
  }

  override firstUpdated() { this.applyRoute(); }

  override updated() { this.markNav(); }

  private onMq = () => { this.narrow = this.mq.matches; };

  private routes(): AppRoute[] { return [...this.children].filter((c): c is AppRoute => c instanceof AppRoute); }

  private applyRoute = () => {
    const routes = this.routes();
    const path = resolveRoute(location.hash, routes.map((r) => r.getAttribute('path') ?? ''));
    for (const r of routes) r.hidden = r.getAttribute('path') !== path;
    if (path !== this.route) {
      this.route = path;
      this.renderRoot.querySelector('main')?.scrollTo(0, 0);
      this.bus.publish('route:changed', { path }, 'app-shell');
    }
    this.closeModal();
  };

  private markNav() {
    for (const a of this.querySelectorAll<HTMLAnchorElement>(':scope > a[slot="nav"]')) {
      // a sub-item that is a page (a workspace) can be current; one that adds something (data-dock-add) never is
      if (!a.hasAttribute('data-dock-add') && isCurrent(a.getAttribute('href'), this.route)) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    // a nav row (a workspace's: its link and buttons) is current by its own link, unless a top-level item already is
    const marked = this.querySelector(':scope > a[slot="nav"][aria-current]') !== null;
    for (const row of this.querySelectorAll(':scope > [slot="nav"]:not(a)')) {
      if (!marked && isCurrent(row.querySelector(':scope > a[href]')?.getAttribute('href') ?? null, this.route)) row.setAttribute('aria-current', 'page');
      else row.removeAttribute('aria-current');
    }
    // the app bar's page: the nav link (top-level, or in a nav row) for the route; the rail's tooltips are the labels
    let page: AppShell['page'] = null;
    for (const a of this.querySelectorAll<HTMLAnchorElement>(':scope > a[slot="nav"], :scope > [slot="nav"] a[href]')) {
      const label = (a.textContent ?? '').trim();
      if (label && !a.title) a.title = label;
      if (!page && !a.hasAttribute('data-dock-add') && isCurrent(a.getAttribute('href'), this.route))
        page = { href: a.getAttribute('href')!, label, icon: a.querySelector('svg')?.cloneNode(true) ?? null };
    }
    if (page?.href !== this.page?.href || page?.label !== this.page?.label) this.page = page;
  }

  private dialog(): HTMLDialogElement | null { return this.renderRoot.querySelector('dialog'); }

  private toggleDrawer() {
    if (this.narrow) {
      const d = this.dialog();
      if (!d) throw new Error('bug: narrow layout without a modal drawer');
      d.showModal();
      this.bus.publish('shell:drawer', { open: true }, 'app-shell');
    } else {
      this.collapsed = !this.collapsed;
      this.bus.publish('shell:drawer', { open: !this.collapsed }, 'app-shell');
    }
  }

  private closeModal() {
    const d = this.dialog();
    if (d?.open) { d.close(); this.bus.publish('shell:drawer', { open: false }, 'app-shell'); }
  }

  override render() {
    const drawer = html`<div class="drawer">
      <nav aria-label="Main"><slot name="nav" @slotchange=${() => this.markNav()}></slot></nav>
      <slot name="drawer-footer"></slot></div>`;
    return html`
      <header class="bar">
        <span class="brand"><button class="menu" aria-label=${this.narrow ? 'Open menu' : this.collapsed ? 'Expand menu' : 'Collapse menu'} aria-expanded=${String(!this.narrow && !this.collapsed)}
          @click=${() => this.toggleDrawer()}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button>
        <slot name="title"></slot></span>
        ${this.page ? html`<span class="page"><span class="tile">${this.page.icon}</span>${this.page.label}</span>` : ''}
        <slot name="title-actions"></slot><span class="spacer"></span><slot name="actions"></slot>
      </header>
      <div class="frame">
        ${this.narrow ? html`<span></span>` : drawer}
        <div class="content"><main><slot></slot></main><footer><slot name="footer"></slot></footer></div>
      </div>
      ${this.narrow ? html`<dialog aria-label="Main menu" @click=${(e: MouseEvent) => { if (e.target === e.currentTarget) this.closeModal(); }}>${drawer}</dialog>` : ''}`;
  }
}

customElements.define('app-route', AppRoute);
customElements.define('app-shell', AppShell);
