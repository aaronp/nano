/**
 * <app-shell>: app bar, navigation drawer, content area and status bar.
 *
 *   <app-shell>
 *     <span slot="title">Name</span>              app bar title
 *     <nano-profile name="profile" slot="actions"></nano-profile> app bar controls (right side)
 *     <a slot="nav" href="#/inbox">Inbox</a>       one per page, in order (icons welcome)
 *     <a slot="nav" data-sub href="…">…</a>        a sub-item listed under the item before it
 *     <div slot="drawer-footer">…</div>            bottom of the drawer
 *     <span slot="footer">…</span>                 status bar
 *     <app-route path="/inbox">…</app-route>       pages; path="*" is the not-found page
 *   </app-shell>
 *
 * Wide screens (> 840px) show a persistent drawer that the menu button collapses; narrow screens use a
 * modal drawer. <app-route bleed> removes the content padding (for split panes and workspaces).
 * Bus topics: route:changed {path} · shell:drawer {open}.
 * Theme: reads the tokens from src/lib/themes.ts (var(--bg), var(--accent), …).
 */
import { LitElement, html, css } from 'lit';
import { createBus, provideBus, type Bus, type Unsubscribe } from '../lib/bus.ts';
import { isCurrent, resolveRoute } from '../lib/routes.ts';

export class AppRoute extends HTMLElement {}

const NARROW = '(max-width: 840px)';

export class AppShell extends LitElement {
  static override properties = { narrow: { state: true }, collapsed: { state: true }, route: { state: true } };
  declare narrow: boolean;
  declare collapsed: boolean;
  declare route: string;
  readonly bus: Bus = createBus();
  private stopProviding: Unsubscribe | null = null;
  private readonly mq = matchMedia(NARROW);

  static override styles = css`
    :host { display: grid; grid-template-rows: auto minmax(0, 1fr); height: 100vh; height: 100dvh; background: var(--bg); color: var(--fg);
      font: 15px/1.5 var(--font); }
    .bar { display: flex; align-items: center; gap: 10px; min-height: 56px; padding: 0 12px 0 6px; background: var(--appbar-bg); color: var(--appbar-fg);
      border-bottom: 1px solid var(--line); }
    .bar ::slotted([slot='title']) { flex: 1; min-width: 0; margin: 0; font: 600 18px/1.2 var(--display); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .menu { flex: none; width: 44px; height: 44px; border: 0; border-radius: var(--radius); background: transparent; color: inherit; display: grid; place-items: center; cursor: pointer; }
    .menu:hover { background: color-mix(in srgb, currentColor 14%, transparent); }
    button:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
    .frame { display: grid; grid-template-columns: auto minmax(0, 1fr); min-height: 0; }
    .content { display: grid; grid-template-rows: minmax(0, 1fr) auto; min-width: 0; min-height: 0; }
    main { overflow: auto; padding: 24px; min-height: 0; }
    ::slotted(app-route) { display: block; }
    ::slotted(app-route[hidden]) { display: none; }
    ::slotted(app-route[bleed]) { margin: -24px; height: calc(100% + 48px); }
    footer { padding: 6px 16px; border-top: 1px solid var(--line); background: var(--surface); color: var(--muted); font-size: 13px; }
    .drawer { display: flex; flex-direction: column; gap: 2px; width: 248px; box-sizing: border-box; padding: 12px 10px; background: var(--drawer-bg);
      border-right: 1px solid var(--line); overflow: auto; }
    .drawer[hidden] { display: none; }
    nav { display: flex; flex-direction: column; gap: 2px; flex: 1; }
    ::slotted([slot='nav']) { display: flex; align-items: center; gap: 12px; padding: 9px 14px; border-radius: var(--radius); color: inherit; text-decoration: none; }
    ::slotted([slot='nav']:hover) { background: var(--surface-2); }
    ::slotted([slot='nav']:focus-visible) { outline: 2px solid var(--focus); outline-offset: 1px; }
    ::slotted([slot='nav'][aria-current='page']) { background: var(--accent-soft); color: var(--fg); font-weight: 600; }
    ::slotted([slot='nav'][data-sub]) { padding: 5px 14px 5px 44px; font-size: 14px; color: var(--muted); }
    ::slotted([slot='nav'][data-sub]:hover) { color: var(--fg); }
    dialog { margin: 0; padding: 0; border: 0; height: 100%; max-height: 100%; width: min(300px, 86vw); background: var(--drawer-bg); color: var(--fg); }
    dialog .drawer { width: 100%; height: 100%; border: 0; }
    dialog::backdrop { background: rgb(0 0 0 / .45); }
    dialog[open] { animation: slide .2s ease-out; }
    @keyframes slide { from { transform: translateX(-100%); } }
    @media (prefers-reduced-motion: reduce) { dialog[open] { animation: none; } }
  `;

  constructor() {
    super();
    this.narrow = this.mq.matches; this.collapsed = false; this.route = '';
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
    const drawer = html`<div class="drawer" ?hidden=${!this.narrow && this.collapsed}>
      <nav aria-label="Main"><slot name="nav" @slotchange=${() => this.markNav()}></slot></nav>
      <slot name="drawer-footer"></slot></div>`;
    return html`
      <header class="bar">
        <button class="menu" aria-label=${this.narrow ? 'Open menu' : this.collapsed ? 'Show menu' : 'Hide menu'} aria-expanded=${String(!this.narrow && !this.collapsed)}
          @click=${() => this.toggleDrawer()}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button>
        <slot name="title"></slot><slot name="actions"></slot>
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
