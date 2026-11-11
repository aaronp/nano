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
    form { display: flex; gap: 6px; margin-top: 8px } form input { flex: 1; min-width: 0 }
    table { width: 100%; border-collapse: collapse } td { padding: 2px 4px; border-bottom: 1px solid var(--nano-border, #2A2F36); word-break: break-all }
    .backing { margin-bottom: 6px }`]
  constructor() { super(); this.key = ''; this.value = '' }
  render() {
    const entries = Object.entries(this.read<Record<string, string>>(Store.ops.entries) ?? {})
    const save = async (e: Event) => { e.preventDefault(); if ('value' in await this.act(Store.ops.set, { key: this.key, value: this.value })) this.key = this.value = '' }
    return html`<div class="backing badge">${this.read<string>(Store.ops.backing) ?? '…'}</div>
      <table><tbody>${entries.map(([k, v]) => html`<tr><td>${k}</td><td>${v}</td>
        <td><button class="btn small" aria-label="Remove ${k}" @click=${() => this.act(Store.ops.remove, k)}>×</button></td></tr>`)}</tbody></table>
      <form @submit=${save}>
        <input class="input" name="key" aria-label="Key" placeholder="key" .value=${this.key} @input=${(e: Event) => { this.key = (e.target as HTMLInputElement).value }}>
        <input class="input" name="value" aria-label="Value" placeholder="value" .value=${this.value} @input=${(e: Event) => { this.value = (e.target as HTMLInputElement).value }}>
        <button class="btn" type="submit">Save</button>
      </form>
      ${this.problem ? html`<div class="problem">${this.problem}</div>` : ''}`
  }
}
