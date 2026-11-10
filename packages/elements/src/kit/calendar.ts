// <nano-calendar>: a month grid, six weeks from Sunday; <nano-date-picker>: a button showing the date, opening the
// grid in a pop-up. Dates are ISO `YYYY-MM-DD`, in local time. Keyboard: arrows move, Enter or Space picks.
import { LitElement, css, html, nothing } from 'lit'
import { base } from '../styles'
import { kit } from '../kit'
import { t } from '../tokens'
import { hide, place } from './popup'

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const parse = (s: string) => { const [y, m, d] = s.split('-').map(Number); return y && m && d ? new Date(y, m - 1, d) : undefined }
const addDays = (s: string, n: number) => { const d = parse(s)!; d.setDate(d.getDate() + n); return iso(d) }
const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const chevron = (d: string) => html`<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d=${d} fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`

/** A month grid. `value` is the picked date (ISO); emits `change`. */
export class NanoCalendar extends LitElement {
  static override properties = { value: {}, view: { state: true }, focusDate: { state: true } }
  static override styles = [base, kit, css`
    :host { display: inline-block; padding: 8px }
    .head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px }
    .caption { font-weight: 600 } .head .icon-btn { width: 28px; height: 28px; border: 1px solid ${t('border')} }
    table { border-collapse: collapse } th { width: 32px; font-size: 11px; font-weight: 400; color: ${t('muted')}; padding-bottom: 4px }
    td { padding: 1px } td button { width: 32px; height: 32px; padding: 0; border: 0; border-radius: ${t('radius-s')}; font-size: 12px }
    button.outside { color: ${t('muted')}; opacity: .6 } button.today { background: ${t('surface-2')} }
    button[aria-selected='true'] { background: ${t('accent')}; color: ${t('on-accent')}; opacity: 1 }`]
  declare value: string; declare view: { y: number; m: number }; declare focusDate: string
  constructor() { super(); this.value = ''; const now = new Date(); this.view = { y: now.getFullYear(), m: now.getMonth() }; this.focusDate = '' }

  override willUpdate(changed: Map<string, unknown>) {
    const d = parse(this.value)
    if (changed.has('value') && d) { this.view = { y: d.getFullYear(), m: d.getMonth() }; this.focusDate = this.value }
  }
  private shift(n: number) { const d = new Date(this.view.y, this.view.m + n, 1); this.view = { y: d.getFullYear(), m: d.getMonth() }; this.focusDate = iso(d) }
  /** Focuses the day the keyboard starts from. */
  override focus() { (this.renderRoot.querySelector('[tabindex="0"]') as HTMLElement | null)?.focus() }
  private pick(date: string) {
    this.value = date
    this.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
  }
  private onKey(e: KeyboardEvent) {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key]
    const from = this.focusDate || iso(new Date(this.view.y, this.view.m, 1))
    if (step) {
      e.preventDefault()
      this.focusDate = addDays(from, step)
      const d = parse(this.focusDate)!; this.view = { y: d.getFullYear(), m: d.getMonth() }
      this.updateComplete.then(() => (this.renderRoot.querySelector('[tabindex="0"]') as HTMLElement | null)?.focus())
    } else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.pick(from) }
  }

  override render() {
    const { y, m } = this.view
    const first = new Date(y, m, 1)
    const days = Array.from({ length: 42 }, (_, i) => new Date(y, m, 1 - first.getDay() + i))
    const today = iso(new Date())
    const focus = this.focusDate.startsWith(`${y}-${pad(m + 1)}-`) ? this.focusDate : iso(first)
    return html`<div class="head">
        <button class="icon-btn" aria-label="Previous month" @click=${() => this.shift(-1)}>${chevron('M10 4L6 8l4 4')}</button>
        <span class="caption" aria-live="polite">${first.toLocaleString('en', { month: 'long' })} ${y}</span>
        <button class="icon-btn" aria-label="Next month" @click=${() => this.shift(1)}>${chevron('M6 4l4 4-4 4')}</button></div>
      <table role="grid" @keydown=${this.onKey}><thead><tr>${DOW.map((d) => html`<th scope="col">${d}</th>`)}</tr></thead><tbody>
        ${[0, 1, 2, 3, 4, 5].map((w) => html`<tr>${days.slice(w * 7, w * 7 + 7).map((d) => {
          const s = iso(d)
          return html`<td role="gridcell"><button data-date=${s} tabindex=${s === focus ? '0' : '-1'} aria-selected=${s === this.value ? 'true' : nothing}
            class="${d.getMonth() !== m ? 'outside' : ''} ${s === today ? 'today' : ''}" @click=${() => { this.focusDate = s; this.pick(s) }}>${d.getDate()}</button></td>`
        })}</tr>`)}</tbody></table>`
  }
}

/** A date field: shows `value` (ISO) or `placeholder`, and opens a calendar. Emits `change`. */
export class NanoDatePicker extends LitElement {
  static override properties = { value: {}, placeholder: {}, open: { state: true } }
  static override styles = [base, kit, css`
    :host { display: inline-block } .trigger { min-width: 200px; justify-content: flex-start; background: ${t('bg')} }
    .trigger .muted { font-weight: 400 } .pop { padding: 0 }`]
  declare value: string; declare placeholder: string; declare open: boolean
  constructor() { super(); this.value = ''; this.placeholder = 'Pick a date'; this.open = false }
  private get pop() { return this.renderRoot.querySelector('.pop') as HTMLElement }
  private get trigger() { return this.renderRoot.querySelector('.trigger') as HTMLElement }

  private show(on: boolean) {
    this.open = on
    if (on) { place(this.pop, this.trigger); (this.renderRoot.querySelector('nano-calendar') as HTMLElement).focus() } else hide(this.pop)
  }
  private onChange(e: Event) {
    e.stopPropagation()
    this.value = (e.target as NanoCalendar).value
    this.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
    this.show(false); this.trigger.focus()
  }

  override render() {
    const d = parse(this.value)
    return html`<button class="trigger" aria-haspopup="dialog" aria-expanded=${String(this.open)} @click=${() => this.show(!this.open)}>
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="2" y="3" width="12" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M2 6.5h12M5 1.5v3M11 1.5v3" stroke="currentColor" stroke-width="1.3"/></svg>
        ${d ? d.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' }) : html`<span class="muted">${this.placeholder}</span>`}</button>
      <div class="pop" popover="auto" role="dialog" aria-label="Choose a date" @toggle=${(e: ToggleEvent) => { if (e.newState === 'closed') this.open = false }}
        @keydown=${(e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); this.show(false) } }}>
        <nano-calendar .value=${this.value} @change=${this.onChange}></nano-calendar></div>`
  }
}

for (const [tag, cls] of [['nano-calendar', NanoCalendar], ['nano-date-picker', NanoDatePicker]] as const)
  if (globalThis.customElements && !customElements.get(tag)) customElements.define(tag, cls)
