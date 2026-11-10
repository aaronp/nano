// <nano-command>: a filterable list (a command palette, or the list inside a picker), and <nano-select>: a picker
// over it, single or `multiple`. Both in shadcn's look; keyboard: arrows, Enter, Escape, Backspace (multiple).
import { LitElement, css, html, nothing } from 'lit'
import { base } from '../styles'
import { kit } from '../kit'
import { t } from '../tokens'
import { hide, place } from './popup'

export interface Item { value: string; label?: string; group?: string; shortcut?: string; disabled?: boolean }
const labelOf = (i: Item) => i.label ?? i.value
const CHECK = html`<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" stroke-width="2"/></svg>`
let ids = 0

/** A search box over a list of items. Emits `pick` (detail: the item) on click or Enter. `selected` shows a check. */
export class NanoCommand extends LitElement {
  static override shadowRootOptions = { ...LitElement.shadowRootOptions, delegatesFocus: true }
  static override properties = { items: { attribute: false }, selected: { attribute: false }, placeholder: {}, q: { state: true }, active: { state: true } }
  static override styles = [base, kit, css`
    :host { display: block; min-width: 220px }
    .search { display: flex; align-items: center; gap: 6px; padding: 0 8px; border-bottom: 1px solid ${t('border')}; color: ${t('muted')} }
    .search input { flex: 1; border: 0; background: none; outline: 0; padding: 9px 0; font-size: 13px }
    [role='listbox'] { max-height: 260px; overflow: auto; padding: 4px }
    .menu-item .check { width: 14px; display: inline-flex }
    .menu-item[aria-disabled='true'] { pointer-events: none }
    .empty { padding: 18px 8px; text-align: center; color: ${t('muted')} }`]
  declare items: Item[]; declare selected: string[]; declare placeholder: string; declare q: string; declare active: number
  private uid = `c${++ids}`
  constructor() { super(); this.items = []; this.selected = []; this.placeholder = 'Search…'; this.q = ''; this.active = 0 }

  /** The items that match what's typed (case-insensitive, anywhere in the label). */
  get shown() { const q = this.q.toLowerCase(); return this.items.filter((i) => labelOf(i).toLowerCase().includes(q)) }
  /** Clears the search, ready to open again. */
  reset() { this.q = ''; this.active = 0 }

  private pick(i: Item | undefined) { if (i && !i.disabled) this.dispatchEvent(new CustomEvent('pick', { detail: i, bubbles: true, composed: true })) }
  private onKey(e: KeyboardEvent) {
    const n = this.shown.length
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (n) this.active = (this.active + (e.key === 'ArrowDown' ? 1 : -1) + n) % n }
    else if (e.key === 'Enter') { e.preventDefault(); this.pick(this.shown[this.active]) }
  }
  override updated() { this.renderRoot.querySelector('.active')?.scrollIntoView?.({ block: 'nearest' }) }

  override render() {
    const shown = this.shown
    let group: string | undefined
    return html`<div class="search"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.5"/></svg>
      <input role="combobox" aria-expanded="true" aria-controls=${`${this.uid}-list`} aria-autocomplete="list" placeholder=${this.placeholder} .value=${this.q}
        aria-activedescendant=${shown.length ? `${this.uid}-${this.active}` : nothing}
        @input=${(e: Event) => { this.q = (e.target as HTMLInputElement).value; this.active = 0 }} @keydown=${this.onKey}></div>
      <div role="listbox" id=${`${this.uid}-list`} aria-multiselectable=${this.selected.length > 1 ? 'true' : nothing}>
        ${shown.length ? shown.map((i, n) => {
          const head = i.group && i.group !== group ? html`<div class="menu-label" role="presentation">${i.group}</div>` : nothing
          group = i.group
          return html`${head}<div role="option" id=${`${this.uid}-${n}`} data-value=${i.value} class="menu-item ${n === this.active ? 'active' : ''}"
            aria-selected=${String(this.selected.includes(i.value))} aria-disabled=${i.disabled ? 'true' : nothing}
            @pointermove=${() => { this.active = n }} @click=${() => this.pick(i)}>
            <span class="check">${this.selected.includes(i.value) ? CHECK : nothing}</span>${labelOf(i)}${i.shortcut ? html`<span class="shortcut">${i.shortcut}</span>` : nothing}</div>`
        }) : html`<div class="empty">No results.</div>`}</div>`
  }
}

/** A picker: a trigger showing the choice (chips when `multiple`), opening a filterable list. `value` is a string,
 *  or an array when `multiple`. Emits `change`. */
export class NanoSelect extends LitElement {
  static override properties = { options: { attribute: false }, value: { attribute: false }, multiple: { type: Boolean }, placeholder: {}, label: {}, open: { state: true } }
  static override styles = [base, kit, css`
    :host { display: inline-block; min-width: 180px }
    [role='combobox'] { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; min-height: 30px; padding: 3px 8px; cursor: pointer;
      border: 1px solid ${t('border-strong')}; border-radius: ${t('radius-s')}; background: ${t('bg')}; font-size: 12px }
    .placeholder { color: ${t('muted')} } .chev { margin-left: auto; color: ${t('muted')} }
    .chip { padding: 0 2px 0 6px; background: ${t('surface-2')}; border-color: transparent }
    .chip button { border: 0; padding: 0 4px; background: none; color: ${t('muted')} }
    .pop { padding: 0 }`]
  declare options: (string | Item)[]; declare value: string | string[]; declare multiple: boolean; declare placeholder: string; declare label: string; declare open: boolean
  constructor() { super(); this.options = []; this.value = ''; this.multiple = false; this.placeholder = 'Select…'; this.label = ''; this.open = false }

  private get items(): Item[] { return this.options.map((o) => (typeof o === 'string' ? { value: o } : o)) }
  private get chosen(): string[] { return Array.isArray(this.value) ? this.value : this.value ? [this.value] : [] }
  private labelFor = (v: string) => labelOf(this.items.find((i) => i.value === v) ?? { value: v })
  private get pop() { return this.renderRoot.querySelector('.pop') as HTMLElement }
  private get trigger() { return this.renderRoot.querySelector('[role="combobox"]') as HTMLElement }

  private set(v: string | string[]) { this.value = v; this.dispatchEvent(new Event('change', { bubbles: true, composed: true })) }
  private show(on: boolean) {
    if (on === this.open) return
    this.open = on
    const cmd = this.renderRoot.querySelector('nano-command') as NanoCommand
    if (on) { cmd.reset(); place(this.pop, this.trigger); cmd.focus() } else { hide(this.pop); this.trigger.focus() }
  }
  private onPick(e: CustomEvent<Item>) {
    const v = e.detail.value
    if (!this.multiple) { this.set(v); this.show(false); return }
    this.set(this.chosen.includes(v) ? this.chosen.filter((x) => x !== v) : [...this.chosen, v])
  }
  private onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); this.show(false) }
    else if (e.target === this.trigger && ['ArrowDown', 'Enter', ' '].includes(e.key)) { e.preventDefault(); this.show(true) }
    else if (e.target === this.trigger && e.key === 'Backspace' && this.multiple && this.chosen.length) this.set(this.chosen.slice(0, -1))
  }

  override render() {
    const chosen = this.chosen
    const shown = !chosen.length ? html`<span class="placeholder">${this.placeholder}</span>`
      : this.multiple ? chosen.map((v) => html`<span class="chip">${this.labelFor(v)}<button tabindex="-1" aria-label=${`Remove ${this.labelFor(v)}`}
          @click=${(e: Event) => { e.stopPropagation(); this.set(chosen.filter((x) => x !== v)) }}>×</button></span>`)
      : this.labelFor(chosen[0]!)
    return html`<div role="combobox" tabindex="0" aria-label=${this.label || nothing} aria-haspopup="listbox" aria-expanded=${String(this.open)} @click=${() => this.show(!this.open)} @keydown=${this.onKey}>
        ${shown}<svg class="chev" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></div>
      <div class="pop" popover="auto" @toggle=${(e: ToggleEvent) => { if (e.newState === 'closed') this.open = false }} @keydown=${this.onKey}>
        <nano-command .items=${this.items} .selected=${chosen} @pick=${this.onPick}></nano-command></div>`
  }
}

for (const [tag, cls] of [['nano-command', NanoCommand], ['nano-select', NanoSelect]] as const)
  if (globalThis.customElements && !customElements.get(tag)) customElements.define(tag, cls)
