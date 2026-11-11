// <nano-store name="…">: places a Store by name (or attaches to one): where it keeps values, its entries with a
// remove button each, and a key and value to set.
import { css, html } from 'lit'
import { PlacedElement, base, kit } from '@pritzlaff/nano-elements'
import { Store } from './store'

export class StoreEl extends PlacedElement {
  static component = Store
  static properties = { ...PlacedElement.properties, key: { state: true }, value: { state: true } }
  declare key: string
  declare value: string
  static styles = [base, kit, css`
    .row { display: flex; gap: 6px; margin-top: 8px } .row input { flex: 1; min-width: 0 }
    table { width: 100%; border-collapse: collapse } td { padding: 2px 4px; border-bottom: 1px solid var(--nano-border, #2A2F36); word-break: break-all }
    .backing { margin-bottom: 6px }`]
  constructor() { super(); this.key = ''; this.value = '' }
  render() {
    const entries = Object.entries(this.read<Record<string, string>>(Store.ops.entries) ?? {})
    // a button and Enter, not a <form>: a sandboxed frame without allow-forms never fires submit
    const save = async () => { if ('value' in await this.act(Store.ops.set, { key: this.key, value: this.value })) this.key = this.value = '' }
    return html`<div class="backing badge">${this.read<string>(Store.ops.backing) ?? '…'}</div>
      <table><tbody>${entries.map(([k, v]) => html`<tr><td>${k}</td><td>${v}</td>
        <td><button class="btn small" aria-label="Remove ${k}" @click=${() => this.act(Store.ops.remove, k)}>×</button></td></tr>`)}</tbody></table>
      <div class="row">
        <input class="input" name="key" aria-label="Key" placeholder="key" .value=${this.key} @input=${(e: Event) => { this.key = (e.target as HTMLInputElement).value }}>
        <input class="input" name="value" aria-label="Value" placeholder="value" .value=${this.value} @input=${(e: Event) => { this.value = (e.target as HTMLInputElement).value }}
          @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter') void save() }}>
        <button class="btn save" type="button" @click=${save}>Save</button>
      </div>
      ${this.problem ? html`<div class="problem">${this.problem}</div>` : ''}`
  }
}
