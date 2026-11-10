// <nano-data-table>: rows under columns, in shadcn's look; sortable columns, a `filter` box, `selectable` rows and
// `page-size` pages. Rows are plain objects; a column's `render` can show a cell as anything.
import { LitElement, css, html, nothing, type TemplateResult } from 'lit'
import { base } from '../styles'
import { kit } from '../kit'
import { t } from '../tokens'

type Row = Record<string, unknown>
export interface Column { key: string; label: string; sortable?: boolean; align?: 'left' | 'right'; render?: (row: Row) => unknown }
const cell = (r: Row, k: string) => String(r[k] ?? '')
const compare = (a: unknown, b: unknown) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true }))

/** Emits `selection` (detail: the selected rows) when `selectable` rows are ticked. */
export class NanoDataTable extends LitElement {
  static override properties = {
    columns: { attribute: false }, rows: { attribute: false }, filter: { type: Boolean }, selectable: { type: Boolean },
    pageSize: { type: Number, attribute: 'page-size' }, q: { state: true }, sort: { state: true }, page: { state: true }, picked: { state: true },
  }
  static override styles = [base, kit, css`
    .frame { border: 1px solid ${t('border')}; border-radius: ${t('radius')}; overflow: auto }
    .table { margin: 0 } .table tr:last-child td { border-bottom: 0 } .table tbody tr:hover { background: ${t('surface-2')} }
    .table tr[aria-selected='true'] { background: ${t('surface-2')} } .table .right { text-align: right } .table .tick { width: 28px }
    th button { border: 0; padding: 0; background: none; font: inherit; color: inherit; letter-spacing: inherit; text-transform: inherit }
    .filter { width: min(280px, 100%); margin-bottom: 10px } .empty { text-align: center; padding: 24px; color: ${t('muted')} }
    .foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 10px; color: ${t('muted')}; font-size: 12px }`]
  declare columns: Column[]; declare rows: Row[]; declare filter: boolean; declare selectable: boolean; declare pageSize: number
  declare q: string; declare sort: { key: string; dir: 1 | -1 } | undefined; declare page: number; declare picked: Set<Row>
  constructor() { super(); this.columns = []; this.rows = []; this.filter = false; this.selectable = false; this.pageSize = 0; this.q = ''; this.page = 0; this.picked = new Set() }

  /** The rows that pass the filter, in the chosen order. */
  get shown(): Row[] {
    const q = this.q.toLowerCase()
    const rows = q ? this.rows.filter((r) => this.columns.some((c) => cell(r, c.key).toLowerCase().includes(q))) : [...this.rows]
    const s = this.sort
    return s ? rows.sort((a, b) => compare(a[s.key], b[s.key]) * s.dir) : rows
  }
  private sortBy(key: string) { this.sort = this.sort?.key === key && this.sort.dir === 1 ? { key, dir: -1 } : { key, dir: 1 } }
  private pick(rows: Row[], on: boolean) {
    const next = new Set(this.picked); for (const r of rows) on ? next.add(r) : next.delete(r)
    this.picked = next
    this.dispatchEvent(new CustomEvent('selection', { detail: this.rows.filter((r) => next.has(r)), bubbles: true, composed: true }))
  }

  override render() {
    const all = this.shown, size = this.pageSize || all.length || 1, pages = Math.max(1, Math.ceil(all.length / size))
    const page = Math.min(this.page, pages - 1), rows = all.slice(page * size, page * size + size)
    const allPicked = rows.length > 0 && rows.every((r) => this.picked.has(r))
    const head = (c: Column): TemplateResult => {
      const sorted = this.sort?.key === c.key ? (this.sort.dir === 1 ? 'ascending' : 'descending') : undefined
      return html`<th data-key=${c.key} class=${c.align ?? ''} aria-sort=${c.sortable ? sorted ?? 'none' : nothing}>${c.sortable
        ? html`<button @click=${() => this.sortBy(c.key)}>${c.label} ${sorted === 'ascending' ? '↑' : sorted === 'descending' ? '↓' : '↕'}</button>` : c.label}</th>`
    }
    return html`${this.filter ? html`<input class="input filter" placeholder="Filter…" aria-label="Filter rows" .value=${this.q}
        @input=${(e: Event) => { this.q = (e.target as HTMLInputElement).value; this.page = 0 }}>` : nothing}
      <div class="frame"><table class="table"><thead><tr>
        ${this.selectable ? html`<th class="tick"><input type="checkbox" aria-label="Select all" .checked=${allPicked} @click=${() => this.pick(rows, !allPicked)}></th>` : nothing}
        ${this.columns.map(head)}</tr></thead><tbody>
        ${rows.length ? rows.map((r) => html`<tr aria-selected=${this.selectable ? String(this.picked.has(r)) : nothing}>
          ${this.selectable ? html`<td class="tick"><input type="checkbox" aria-label="Select row" .checked=${this.picked.has(r)} @click=${() => this.pick([r], !this.picked.has(r))}></td>` : nothing}
          ${this.columns.map((c) => html`<td data-key=${c.key} class=${c.align ?? ''}>${c.render ? c.render(r) : cell(r, c.key)}</td>`)}</tr>`)
        : html`<tr><td class="empty" colspan=${this.columns.length + (this.selectable ? 1 : 0)}>No results.</td></tr>`}</tbody></table></div>
      ${this.selectable || this.pageSize ? html`<div class="foot"><span>${this.selectable ? `${this.picked.size} of ${this.rows.length} row(s) selected.` : ''}</span>
        ${this.pageSize ? html`<span class="pages row">Page ${page + 1} of ${pages}
          <button class="btn small" aria-label="Previous page" ?disabled=${page === 0} @click=${() => { this.page = page - 1 }}>‹</button>
          <button class="btn small" aria-label="Next page" ?disabled=${page >= pages - 1} @click=${() => { this.page = page + 1 }}>›</button></span>` : nothing}</div>` : nothing}`
  }
}

if (globalThis.customElements && !customElements.get('nano-data-table')) customElements.define('nano-data-table', NanoDataTable)
