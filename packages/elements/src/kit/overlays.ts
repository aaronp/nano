// <nano-menu> (a right-click menu over its content), <nano-hover-card>, toast() with its <nano-toaster>, and
// <nano-code-block> (code with a copy button).
import { LitElement, css, html, nothing } from 'lit'
import { base } from '../styles'
import { kit } from '../kit'
import { t } from '../tokens'
import { hide, place } from './popup'

export type MenuItem = { label: string; value?: string; shortcut?: string; danger?: boolean; disabled?: boolean } | { separator: true } | { heading: string }
const pickable = (i: MenuItem): i is Extract<MenuItem, { label: string }> => 'label' in i && !i.disabled
const define = (tag: string, cls: CustomElementConstructor) => { if (globalThis.customElements && !customElements.get(tag)) customElements.define(tag, cls) }

/** Wraps content; right-clicking it opens `items` at the pointer. Emits `select` (detail: the item). */
export class NanoMenu extends LitElement {
  static override properties = { items: { attribute: false }, open: { type: Boolean, reflect: true }, active: { state: true } }
  static override styles = [base, kit, css`:host { display: contents } [role='menu'] { outline: 0; min-width: 12rem }`]
  declare items: MenuItem[]; declare open: boolean; declare active: number
  constructor() {
    super(); this.items = []; this.open = false; this.active = -1
    this.addEventListener('contextmenu', (e) => { e.preventDefault(); this.show({ x: e.clientX, y: e.clientY }) })
  }
  private get menu() { return this.renderRoot.querySelector('[role="menu"]') as HTMLElement }

  /** Opens the menu at a point in the viewport. */
  async show(at: { x: number; y: number }) {
    this.open = true; this.active = this.items.findIndex(pickable)
    await this.updateComplete
    place(this.menu, this, at); this.menu.focus()
  }
  close() { this.open = false; hide(this.menu) }
  private pick(i: MenuItem | undefined) {
    if (!i || !pickable(i)) return
    this.dispatchEvent(new CustomEvent('select', { detail: i, bubbles: true, composed: true })); this.close()
  }
  private onKey(e: KeyboardEvent) {
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
    if (step) {
      e.preventDefault()
      for (let n = 1, len = this.items.length; n <= len; n++) {
        const i = (this.active + step * n + len) % len
        if (pickable(this.items[i]!)) { this.active = i; break }
      }
    } else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.pick(this.items[this.active]) }
    else if (e.key === 'Escape') this.close()
  }

  override render() {
    return html`<slot></slot><div class="pop" popover="auto" role="menu" tabindex="-1" @keydown=${this.onKey}
      @toggle=${(e: ToggleEvent) => { if (e.newState === 'closed') this.open = false }}>
      ${this.items.map((i, n) => 'separator' in i ? html`<div class="menu-sep" role="separator"></div>`
        : 'heading' in i ? html`<div class="menu-label">${i.heading}</div>`
        : html`<div role="menuitem" class="menu-item ${i.danger ? 'danger' : ''} ${n === this.active ? 'active' : ''}" aria-disabled=${i.disabled ? 'true' : nothing}
            @pointermove=${() => { if (!i.disabled) this.active = n }} @click=${() => this.pick(i)}>${i.label}${i.shortcut ? html`<span class="shortcut">${i.shortcut}</span>` : nothing}</div>`)}</div>`
  }
}

/** Shows its `card` slot beside its content while the pointer rests there (or it has focus). */
export class NanoHoverCard extends LitElement {
  static override properties = { open: { type: Boolean, reflect: true }, openDelay: { type: Number, attribute: 'open-delay' }, closeDelay: { type: Number, attribute: 'close-delay' } }
  static override styles = [base, kit, css`:host { display: inline-block } .pop { width: 280px; padding: 14px }`]
  declare open: boolean; declare openDelay: number; declare closeDelay: number
  private timer?: ReturnType<typeof setTimeout>
  constructor() { super(); this.open = false; this.openDelay = 500; this.closeDelay = 200 }
  private later(open: boolean) { clearTimeout(this.timer); this.timer = setTimeout(() => { this.open = open }, open ? this.openDelay : this.closeDelay) }
  override updated(changed: Map<string, unknown>) {
    if (!changed.has('open')) return
    const pop = this.renderRoot.querySelector('.pop') as HTMLElement
    if (this.open) place(pop, this.renderRoot.querySelector('.trigger')!); else hide(pop)
    pop.style.minWidth = ''
  }
  override render() {
    const on = () => this.later(true), off = () => this.later(false)
    return html`<span class="trigger" @pointerenter=${on} @pointerleave=${off} @focusin=${on} @focusout=${off}><slot></slot></span>
      <div class="pop" popover="manual" @pointerenter=${on} @pointerleave=${off}><slot name="card"></slot></div>`
  }
}

export interface Toast { id: number; title: string; description?: string; variant?: 'good' | 'bad' | 'warn'; duration?: number }
let toastIds = 0

/** The stack of toasts, bottom right. Use toast() rather than this directly. */
export class NanoToaster extends LitElement {
  static override properties = { toasts: { state: true } }
  static override styles = [base, kit, css`:host { position: fixed; right: 16px; bottom: 16px; z-index: 1000 } ol { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; list-style: none }`]
  declare toasts: Toast[]
  constructor() { super(); this.toasts = [] }
  add(toast: Toast) {
    this.toasts = [...this.toasts, toast]
    if (toast.duration !== 0) setTimeout(() => this.dismiss(toast.id), toast.duration ?? 4000)
  }
  dismiss(id: number) { this.toasts = this.toasts.filter((x) => x.id !== id) }
  override render() {
    return html`<ol aria-live="polite">${this.toasts.map((x) => html`<li class="toast ${x.variant ?? ''}" role="status">
      <div class="body"><div class="title">${x.title}</div>${x.description ? html`<div class="desc">${x.description}</div>` : nothing}</div>
      <button class="icon-btn" aria-label="Close" @click=${() => this.dismiss(x.id)}>✕</button></li>`)}</ol>`
  }
}

/** Shows a toast (in the page's one <nano-toaster>, made on first use). `duration` in ms; 0 keeps it. Returns its id. */
export function toast(title: string, opts: Omit<Toast, 'id' | 'title'> = {}): number {
  const el = (document.querySelector('nano-toaster') ?? document.body.appendChild(document.createElement('nano-toaster'))) as NanoToaster
  const id = ++toastIds
  el.add({ id, title, ...opts })
  return id
}

/** Code in a block, with its language and a copy button. */
export class NanoCodeBlock extends LitElement {
  static override properties = { code: {}, language: {}, copied: { state: true } }
  static override styles = [base, kit, css`
    .frame { position: relative } .bar { position: absolute; top: 4px; right: 4px; display: flex; align-items: center; gap: 6px }
    .lang { font-size: 11px; color: ${t('muted')} } pre.code { padding-right: 90px }`]
  declare code: string; declare language: string; declare copied: boolean
  constructor() { super(); this.code = ''; this.language = ''; this.copied = false }
  private async copy() {
    await navigator.clipboard?.writeText(this.code)
    this.copied = true; setTimeout(() => { this.copied = false }, 1500)
  }
  override render() {
    return html`<div class="frame"><pre class="code">${this.code}</pre><div class="bar"><span class="lang">${this.language}</span>
      <button class="icon-btn" aria-label="Copy" @click=${this.copy}>${this.copied ? '✓ Copied' : 'Copy'}</button></div></div>`
  }
}

define('nano-menu', NanoMenu); define('nano-hover-card', NanoHoverCard); define('nano-toaster', NanoToaster); define('nano-code-block', NanoCodeBlock)
