// <nano-data-table>: rows under columns, in shadcn's look; sortable columns, a `filter` box, `selectable` rows and
// `page-size` pages. Columns resize from a handle on each header's edge, by drag or ←/→, never below `minWidth`. Rows are plain objects; a column's `render` can show a cell as anything.
import { LitElement, css, html, nothing, type TemplateResult } from 'lit'
import { base } from '../styles'
import { kit } from '../kit'
import { t } from '../tokens'

type Row = Record<string, unknown>
/** `width` is a column's starting width in px; `minWidth` (default 60) the narrowest a resize takes it. */
export interface Column { key: string; label: string; sortable?: boolean; align?: 'left' | 'right'; width?: number; minWidth?: number; render?: (row: Row) => unknown }
const STEP = 10
const cell = (r: Row, k: string) => String(r[k] ?? '')
const compare = (a: unknown, b: unknown) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true }))

/** Emits `selection` (detail: the selected rows) when `selectable` rows are ticked. */
export class NanoDataTable extends LitElement {
  static override properties = {
    columns: { attribute: false }, rows: { attribute: false }, filter: { type: Boolean }, selectable: { type: Boolean },
    pageSize: { type: Number, attribute: 'page-size' }, widths: { state: true }, q: { state: true }, sort: { state: true }, page: { state: true }, picked: { state: true },
  }
  static override styles = [base, kit, css`
    .frame { border: 1px solid ${t('border')}; border-radius: ${t('radius')}; overflow: auto }
    .table { margin: 0 } .table tr:last-child td { border-bottom: 0 } .table tbody tr:hover { background: ${t('surface-2')} }
    .table tr[aria-selected='true'] { background: ${t('surface-2')} } .table .right { text-align: right } .table .tick { width: 28px }
    th button { border: 0; padding: 0; background: none; font: inherit; color: inherit; letter-spacing: inherit; text-transform: inherit }
    .filter { width: min(280px, 100%); margin-bottom: 10px } .empty { text-align: center; padding: 24px; color: ${t('muted')} }
    th { position: relative } .fixed { table-layout: fixed } .fixed td, .fixed th { overflow: hidden; text-overflow: ellipsis }
    .resize { position: absolute; top: 0; right: 0; bottom: 0; width: 6px; cursor: col-resize; touch-action: none }
    .resize:hover, .resize:focus-visible { background: ${t('border')}; outline: none }
    .foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 10px; color: ${t('muted')}; font-size: 12px }`]
  declare columns: Column[]; declare rows: Row[]; declare filter: boolean; declare selectable: boolean; declare pageSize: number
  declare widths: Record<string, number>; declare q: string; declare sort: { key: string; dir: 1 | -1 } | undefined; declare page: number; declare picked: Set<Row>
  constructor() { super(); this.columns = []; this.rows = []; this.filter = false; this.selectable = false; this.pageSize = 0; this.widths = {}; this.q = ''; this.page = 0; this.picked = new Set() }

  /** The rows that pass the filter, in the chosen order. */
  get shown(): Row[] {
    const q = this.q.toLowerCase()
    const rows = q ? this.rows.filter((r) => this.columns.some((c) => cell(r, c.key).toLowerCase().includes(q))) : [...this.rows]
    const s = this.sort
    return s ? rows.sort((a, b) => compare(a[s.key], b[s.key]) * s.dir) : rows
  }
  // widths as laid out, read after each update while no width is fixed (120 when nothing is measured)
  private measured: Record<string, number> = {}
  override updated() {
    if (this.isFixed()) return
    let moved = false
    for (const c of this.columns) {
      const w = (this.renderRoot.querySelector(`th[data-key="${c.key}"]`) as HTMLElement | null)?.offsetWidth || 120
      if (this.measured[c.key] !== w) { this.measured[c.key] = w; moved = true }
    }
    if (moved) this.requestUpdate()   // so each handle reports what it measured
  }
  private isFixed() { return this.columns.some((c) => (this.widths[c.key] ?? c.width) !== undefined) }
  // a column's width: as resized, else as given, else as laid out
  private widthOf(c: Column) { return this.widths[c.key] ?? c.width ?? this.measured[c.key] ?? 120 }
  private resize(c: Column, px: number) {
    // the first resize fixes every column where it stands, so the others don't jump
    const all = this.isFixed() ? this.widths : Object.fromEntries(this.columns.map((x) => [x.key, this.widthOf(x)]))
    this.widths = { ...all, [c.key]: Math.max(c.minWidth ?? 60, Math.round(px)) }
  }
  private drag(c: Column, e: PointerEvent) {
    e.preventDefault(); e.stopPropagation()
    const x0 = e.clientX, w0 = this.widthOf(c)
    const move = (m: PointerEvent) => this.resize(c, w0 + m.clientX - x0)
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up) }
    addEventListener('pointermove', move); addEventListener('pointerup', up)
  }
  private nudge(c: Column, e: KeyboardEvent) {
    const d = e.key === 'ArrowRight' ? STEP : e.key === 'ArrowLeft' ? -STEP : 0
    if (d) { e.preventDefault(); this.resize(c, this.widthOf(c) + d) }
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
    const fixed = this.isFixed()   // once any width is known, widths hold, and the table is as wide as its columns
    const total = this.columns.reduce((n, c) => n + this.widthOf(c), this.selectable ? 28 : 0)
    const allPicked = rows.length > 0 && rows.every((r) => this.picked.has(r))
    const head = (c: Column): TemplateResult => {
      const sorted = this.sort?.key === c.key ? (this.sort.dir === 1 ? 'ascending' : 'descending') : undefined
      return html`<th data-key=${c.key} class=${c.align ?? ''} aria-sort=${c.sortable ? sorted ?? 'none' : nothing}>${c.sortable
        ? html`<button @click=${() => this.sortBy(c.key)}>${c.label} ${sorted === 'ascending' ? '↑' : sorted === 'descending' ? '↓' : '↕'}</button>` : c.label}<span
          class="resize" role="separator" aria-orientation="vertical" tabindex="0" aria-label="Resize ${c.label}" aria-valuemin=${c.minWidth ?? 60}
          aria-valuenow=${this.widthOf(c)} @pointerdown=${(e: PointerEvent) => this.drag(c, e)} @keydown=${(e: KeyboardEvent) => this.nudge(c, e)}
          @click=${(e: Event) => e.stopPropagation()}></span></th>`
    }
    return html`${this.filter ? html`<input class="input filter" placeholder="Filter…" aria-label="Filter rows" .value=${this.q}
        @input=${(e: Event) => { this.q = (e.target as HTMLInputElement).value; this.page = 0 }}>` : nothing}
      <div class="frame"><table class="table ${fixed ? 'fixed' : ''}" style=${fixed ? `width: ${total}px` : ''}>${fixed ? html`<colgroup>${this.selectable ? html`<col style="width: 28px">` : nothing}
        ${this.columns.map((c) => html`<col style="width: ${this.widthOf(c)}px">`)}</colgroup>` : nothing}<thead><tr>
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
