/**
 * `<app-shell>`: the app bar (the `title` and `title-actions` slots), a navigation drawer (`nav` links to `#/path`) and
 * the page, one `<app-route path>` per route (`*` is not-found, `bleed` drops the padding). A wide screen's drawer
 * slides to a rail; a narrow one is a modal. It provides the bus the theme picker needs.
 */
import { LitElement, css, html } from 'lit'
import { createBus, provideBus } from '../lib/bus.ts'
import { resolveRoute } from './routes.ts'

class AppRoute extends HTMLElement {}

class AppShell extends LitElement {
  static properties = { narrow: { type: Boolean, reflect: true }, collapsed: { type: Boolean, reflect: true } }
  static styles = css`
    :host { --drawer-w: 220px; display: grid; grid-template-rows: auto minmax(0, 1fr); height: 100dvh; background: var(--bg); color: var(--fg); font: 15px/1.5 var(--font) }
    :host([collapsed]:not([narrow])) { --drawer-w: 56px }
    .bar { display: flex; align-items: center; gap: 10px; min-height: 52px; padding: 0 12px 0 0; background: var(--appbar-bg); color: var(--appbar-fg); border-bottom: 1px solid var(--line) }
    .bar ::slotted(*) { color: inherit }
    .brand { display: flex; align-items: center; gap: 8px; width: var(--drawer-w); box-sizing: border-box; padding-left: 8px; overflow: hidden }
    :host([narrow]) .brand { width: auto }
    .menu { width: 40px; height: 40px; border: 0; border-radius: var(--radius); background: transparent; color: inherit; font-size: 20px; cursor: pointer }
    .frame { isolation: isolate; display: grid; grid-template-columns: auto minmax(0, 1fr); min-height: 0 }
    .drawer { display: flex; flex-direction: column; gap: 2px; width: var(--drawer-w); box-sizing: border-box; padding: 10px; background: var(--drawer-bg); border-right: 1px solid var(--line); overflow: hidden }
    ::slotted([slot=nav]) { padding: 8px 12px; border-radius: var(--radius); color: inherit; text-decoration: none; white-space: nowrap }
    ::slotted([slot=nav]:hover) { background: var(--surface-2) }
    ::slotted([slot=nav][aria-current=page]) { background: var(--accent-soft); font-weight: 600 }
    main { overflow: auto; padding: 24px; min-height: 0 }
    ::slotted(app-route) { display: block }
    ::slotted(app-route[hidden]) { display: none }
    ::slotted(app-route[bleed]) { margin: -24px; height: calc(100% + 48px) }
    dialog { margin: 0; padding: 0; border: 0; height: 100%; width: min(280px, 86vw); background: var(--drawer-bg); color: var(--fg) }
    dialog .drawer { width: 100%; height: 100%; border: 0 }
    :focus-visible { outline: 2px solid var(--focus); outline-offset: 2px }`
  declare narrow: boolean
  declare collapsed: boolean
  private mq = matchMedia('(max-width: 840px)')
  private route = ''

  constructor() { super(); this.narrow = this.mq.matches; this.collapsed = false; provideBus(this, createBus()) }
  connectedCallback() { super.connectedCallback(); this.mq.addEventListener('change', this.resize); addEventListener('hashchange', this.apply) }
  disconnectedCallback() { super.disconnectedCallback(); this.mq.removeEventListener('change', this.resize); removeEventListener('hashchange', this.apply) }
  firstUpdated() { this.apply() }

  private resize = () => { this.narrow = this.mq.matches }
  private apply = () => {
    const routes = [...this.children].filter(c => c instanceof AppRoute)
    this.route = resolveRoute(location.hash, routes.map(r => r.getAttribute('path') ?? ''))
    for (const r of routes) r.hidden = r.getAttribute('path') !== this.route
    for (const a of this.querySelectorAll('a[slot=nav]')) {
      if (a.getAttribute('href') === `#${this.route}`) a.setAttribute('aria-current', 'page')
      else a.removeAttribute('aria-current')
    }
    this.renderRoot.querySelector('dialog')?.close()
    this.renderRoot.querySelector('main')?.scrollTo(0, 0)
  }
  private toggle() {
    if (this.narrow) this.renderRoot.querySelector('dialog')?.showModal()
    else this.collapsed = !this.collapsed
  }

  render() {
    const drawer = html`<nav class="drawer" aria-label="Main"><slot name="nav" @slotchange=${this.apply}></slot></nav>`
    return html`<header class="bar"><span class="brand"><button class="menu" aria-label="Toggle menu" @click=${() => this.toggle()}>☰</button><slot name="title"></slot></span>
        <slot name="title-actions"></slot></header>
      <div class="frame">${this.narrow ? html`<span></span>` : drawer}<main><slot></slot></main></div>
      ${this.narrow ? html`<dialog aria-label="Main menu" @click=${(e: MouseEvent) => { if (e.target === e.currentTarget) (e.target as HTMLDialogElement).close() }}>${drawer}</dialog>` : ''}`
  }
}

customElements.define('app-route', AppRoute)
customElements.define('app-shell', AppShell)
