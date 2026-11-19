/**
 * `<nano-filter>`: a search input and a filter button showing how many chips are on; the button toggles a panel under
 * it with one row of chips (toggle buttons, `aria-pressed`) per group given. It holds no state of its own: `value` is
 * the filter, and every keystroke or chip toggle emits `change` (`detail` a new FilterValue) for the host to set back.
 *
 *   f.groups = { kinds: ['pod', 'action'], namespaces: ['nano.ui'], statuses: ['running', 'failed'] }
 *   f.value = emptyFilter(); f.addEventListener('change', e => { f.value = e.detail })
 */
import { LitElement, css, html } from 'lit'
import { base, t } from '@pritzlaff/nano-elements'
import { emptyFilter, type FilterValue, type PodStatus } from './model.ts'

type Groups = { kinds?: string[]; namespaces?: string[]; statuses?: PodStatus[] }
const names = { kinds: 'Type', namespaces: 'Namespace', statuses: 'Status' } as const

export class NanoFilter extends LitElement {
  static properties = { groups: { attribute: false }, value: { attribute: false }, open: { state: true } }
  static styles = [base, css`
    :host { position: relative; display: flex; gap: 6px; align-items: center }
    input { flex: 1 1 auto; min-width: 0 }
    .panel { position: absolute; top: 100%; right: 0; z-index: 10; margin-top: 4px; padding: 8px; min-width: 220px; display: grid; gap: 8px;
      background: ${t('surface')}; border: 1px solid ${t('border-strong')}; border-radius: ${t('radius')} }
    .row { display: flex; flex-wrap: wrap; gap: 4px; align-items: center } .row > span { width: 100%; color: ${t('muted')}; font-size: 11px }`]
  declare groups: Groups
  declare value: FilterValue
  declare open: boolean

  constructor() { super(); this.groups = {}; this.value = emptyFilter(); this.open = false }

  private emit(v: FilterValue) { this.dispatchEvent(new CustomEvent<FilterValue>('change', { detail: v, bubbles: true, composed: true })) }
  private flip(g: keyof typeof names, o: string) {
    const set = new Set<string>(this.value[g])
    set.has(o) ? set.delete(o) : set.add(o)
    this.emit({ ...this.value, [g]: set })
  }

  render() {
    const v = this.value, count = v.kinds.size + v.namespaces.size + v.statuses.size
    const rows = (Object.keys(names) as (keyof typeof names)[]).filter(g => this.groups[g])
    return html`
      <input type="search" placeholder="Search" aria-label="Search" .value=${v.text} @input=${(e: Event) => this.emit({ ...v, text: (e.target as HTMLInputElement).value })}>
      <button class="toggle" aria-expanded=${this.open} aria-label="Filters" @click=${() => { this.open = !this.open }}>Filter${count ? ` ${count}` : ''}</button>
      ${this.open ? html`<div class="panel">${rows.map(g => html`
        <div class="row"><span>${names[g]}</span>${(this.groups[g] as string[]).map(o => html`
          <button aria-pressed=${(v[g] as Set<string>).has(o)} @click=${() => this.flip(g, o)}>${o}</button>`)}</div>`)}</div>` : ''}`
  }
}
