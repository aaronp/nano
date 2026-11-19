/**
 * `<nano-filter>`: a search input and a filter button naming how many chips are on; the button opens a popover (top
 * layer, so Escape and outside-click close it) with one labelled group of chips (toggle buttons, `aria-pressed`) per
 * group given. It holds no state of its own: `value` is the filter, and every keystroke or chip toggle emits `change`
 * (`detail` a new FilterValue) for the host to set back.
 *
 *   f.groups = { kinds: ['pod', 'action'], namespaces: ['nano.ui'], statuses: ['running', 'failed'] }
 *   f.value = emptyFilter(); f.addEventListener('change', e => { f.value = e.detail })
 */
import { LitElement, css, html } from 'lit'
import { base, kit, t } from '@pritzlaff/nano-elements'
import { emptyFilter, type FilterValue, type PodStatus } from './model.ts'

type Groups = { kinds?: string[]; namespaces?: string[]; statuses?: PodStatus[] }
const names = { kinds: 'Type', namespaces: 'Namespace', statuses: 'Status' } as const

export class NanoFilter extends LitElement {
  static properties = { groups: { attribute: false }, value: { attribute: false }, open: { state: true } }
  static styles = [base, kit, css`
    :host { position: relative; display: flex; gap: 6px; align-items: center }
    input { flex: 1 1 auto; min-width: 0 }
    .pop { box-sizing: border-box; padding: 8px } .pop:popover-open { display: grid; gap: 8px }
    .row { display: flex; flex-wrap: wrap; gap: 4px; align-items: center } .row > span { width: 100%; font-size: 11px; color: ${t('muted')} }
    .n { margin-left: 4px; padding: 0 6px; border-radius: 999px; background: ${t('accent-soft')}; color: ${t('fg')}; font-weight: 600; font-variant-numeric: tabular-nums }`]
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
  /** `open` follows the popover; opening puts the panel under the button and focus in it, closing returns focus only if it was in the panel. */
  private toggled(e: ToggleEvent) {
    const panel = e.target as HTMLElement, button = this.renderRoot.querySelector<HTMLElement>('.toggle')!
    this.open = e.newState === 'open'
    if (this.open) {
      // Within the filter's own width (search box to button): chips wrap rather than spill over neighbouring panels.
      const h = this.getBoundingClientRect(), b = button.getBoundingClientRect()
      Object.assign(panel.style, { top: `${b.bottom + 4}px`, left: `${Math.max(0, h.left)}px`, width: `${Math.max(220, h.width)}px`, maxWidth: `calc(100vw - ${Math.max(0, h.left)}px)` })
      panel.querySelector<HTMLElement>('.row button')?.focus()
    } else if (panel.contains(this.shadowRoot!.activeElement)) button.focus()
  }

  render() {
    const v = this.value, count = v.kinds.size + v.namespaces.size + v.statuses.size
    const rows = (Object.keys(names) as (keyof typeof names)[]).filter(g => this.groups[g])
    return html`
      <input type="search" placeholder="Search" aria-label="Search" .value=${v.text} @input=${(e: Event) => this.emit({ ...v, text: (e.target as HTMLInputElement).value })}>
      <button class="toggle" popovertarget="panel" aria-haspopup="true" aria-controls="panel" aria-expanded=${this.open}>Filter${count ? ` (${count} active)` : ''}</button>
      <div class="pop" id="panel" popover="auto" role="group" aria-label="Filters" @toggle=${this.toggled}>${rows.map(g => html`
        <div class="row" role="group" aria-labelledby="h-${g}"><span id="h-${g}">${names[g]}${v[g].size ? html` <b class="n" aria-label="${v[g].size} chosen">${v[g].size}</b>` : ''}</span>${(this.groups[g] as string[]).map(o => html`
          <button aria-pressed=${(v[g] as Set<string>).has(o)} @click=${() => this.flip(g, o)}>${o}</button>`)}</div>`)}</div>`
  }
}
