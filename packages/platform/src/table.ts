// <c-platform-table>: every instance in every system, and every kind nothing has been made of, as a table. Free
// text and pill filters (systems, components) with a count and Clear; clicking an instance selects it.
import { css, html, nothing } from 'lit'
import type { Snapshot } from '@pritzlaff/nano-core'
import { base, kit, ModelElement, providedRegistry, type Column } from '@pritzlaff/nano-elements'
import { PlatformOps as P, type Kind } from './platform'
import { inventory, matches, UNREGISTERED, type Filters, type Row } from './inventory'

const NONE = '—'

/** The platform's inventory. Uses the provided registry and the instance `platform` unless told otherwise. */
export class PlatformTableEl extends ModelElement {
  static styles = [base, kit, css`
    .bar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 8px } .q { flex: 1; min-width: 160px }
    .badge { display: inline-block; min-width: 18px; padding: 0 5px; margin-left: 4px; border-radius: 9px; font-size: 11px; line-height: 18px; text-align: center;
      background: var(--nano-accent, #2563EB); color: var(--nano-accent-fg, #fff) }
    .picks, .options { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; align-items: center }
    .options { padding: 8px; border: 1px solid var(--nano-border, #E2E5EA); border-radius: var(--nano-radius, 6px) }
    .group { color: var(--nano-muted, #6B7280); font-size: 12px; margin-right: 2px }
    .pill { border-radius: 999px; padding: 2px 10px; font-size: 12px } .pick { display: inline-flex; gap: 4px; align-items: center }
    .link { border: 0; padding: 0; background: none; color: inherit; font: inherit; text-decoration: underline dotted; cursor: pointer }`]
  static properties = { ...ModelElement.properties, q: { state: true }, filters: { state: true }, open: { state: true } }
  declare q: string
  declare filters: Filters
  declare open: boolean
  constructor() { super(); this.q = ''; this.filters = { systems: [], components: [] }; this.open = false }

  connectedCallback() { this.registry ??= providedRegistry(this.ownerDocument); this.model ??= 'platform'; super.connectedCallback() }

  #columns: Column[] = [
    { key: 'system', label: 'System', sortable: true },
    { key: 'component', label: 'Component', sortable: true },
    { key: 'instance', label: 'Instance', sortable: true, render: r => {
      const row = r as Row
      return row.instance === NONE ? NONE
        : html`<button class="link mono" data-select="${row.system}/${row.instance}" @click=${() => this.act(P.select, { system: row.system, instance: row.instance })}>${row.instance}</button>`
    } },
    { key: 'name', label: 'Name', sortable: true },
    { key: 'owner', label: 'Owner', sortable: true },
  ]

  #toggle(group: keyof Filters, v: string) {
    const on = this.filters[group]
    this.filters = { ...this.filters, [group]: on.includes(v) ? on.filter(x => x !== v) : [...on, v] }
  }

  render() {
    const systems = this.read<Snapshot[]>(P.systems) ?? [], kinds = this.read<Kind[]>(P.kinds) ?? [], f = this.filters
    const count = f.systems.length + f.components.length
    const rows = inventory(systems, kinds).filter(r => matches(r, this.q, f))
    const option = (group: keyof Filters, v: string) => html`<button class="btn pill" data-system=${group === 'systems' ? v : nothing}
      data-component=${group === 'components' ? v : nothing} aria-pressed=${f[group].includes(v)} @click=${() => this.#toggle(group, v)}>${v}</button>`
    const picked = (group: keyof Filters) => f[group].map(v => html`<span class="pill btn pick">${v}<button class="link" aria-label="Remove filter ${v}"
      @click=${() => this.#toggle(group, v)}>✕</button></span>`)
    return html`<div class="bar">
        <input class="input q" name="q" type="search" placeholder="Filter" aria-label="Filter instances" .value=${this.q}
          @input=${(e: Event) => { this.q = (e.target as HTMLInputElement).value }}>
        <button class="btn filters" aria-expanded=${this.open} @click=${() => { this.open = !this.open }}>Filters${count ? html`<span class="badge">${count}</span>` : nothing}</button>
        ${count ? html`<button class="btn clear" @click=${() => { this.filters = { systems: [], components: [] } }}>Clear</button>` : nothing}
      </div>
      ${count ? html`<div class="picks">${picked('systems')}${picked('components')}</div>` : nothing}
      ${this.open ? html`<div class="options">
        <span class="group">Systems</span>${[...systems.map(s => s.id), UNREGISTERED].map(v => option('systems', v))}
        <span class="group">Components</span>${kinds.map(k => option('components', k.kind))}</div>` : nothing}
      <nano-data-table .columns=${this.#columns} .rows=${rows}></nano-data-table>
      ${this.problem ? html`<div class="problem">${this.problem}</div>` : nothing}`
  }
}

/** Defines `<c-platform-table>`, once. */
export const definePlatformTable = () => { if (!customElements.get('c-platform-table')) customElements.define('c-platform-table', PlatformTableEl) }
