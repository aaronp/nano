// <nano-tree>: nodes in a tree, in shadcn's look, with WAI-ARIA's tree keyboard. A `query` keeps what matches (and
// the way to it); rows can carry a kind, a count, a badge, buttons at their end, and a body shown while open.
import { LitElement, css, html, nothing } from 'lit'
import { base } from '../styles'
import { kit } from '../kit'
import { t } from '../tokens'

/** A node. `end` sits at the row's end (buttons); `body` shows inside it while open; `terms` are more text to match. */
export interface TreeNode {
  id: string; label: string; kind?: string; count?: number; badge?: string; terms?: string[]
  end?: unknown; body?: unknown; children?: TreeNode[]
}
type Shown = { node: TreeNode; kids: Shown[] }
type Row = { id: string; label: string; parent?: string; can: boolean; open: boolean }

const has = (n: TreeNode, q: string) => [n.label, ...(n.terms ?? [])].some(s => s.toLowerCase().includes(q))
/** What passes the query: matches, with their subtrees, and the nodes on the way to them. */
const prune = (nodes: TreeNode[], q: string, all: boolean): Shown[] => nodes.flatMap(node => {
  const hit = all || has(node, q), kids = prune(node.children ?? [], q, hit)
  return hit || kids.length ? [{ node, kids }] : []
})
/** The ids from the top down to `id` (itself last), or [] if it isn't there. */
const pathTo = (nodes: TreeNode[], id: string): string[] => {
  for (const n of nodes) {
    if (n.id === id) return [id]
    const rest = pathTo(n.children ?? [], id)
    if (rest.length) return [n.id, ...rest]
  }
  return []
}

/** Emits `select` (detail: `{ id }`, cancelable: cancel it to keep `selected` as the host sets it). */
export class NanoTree extends LitElement {
  static override properties = {
    nodes: { attribute: false }, query: {}, selected: {}, openDepth: { type: Number, attribute: 'open-depth' },
    flipped: { state: true }, focused: { state: true },
  }
  static override styles = [base, kit, css`
    :host { display: block } ul { list-style: none; margin: 0; padding: 0 }
    ul.group { margin-left: 15px; padding-left: 8px; border-left: 1px solid ${t('border')} }
    li[role='treeitem'] { outline: 0 } li[role='treeitem']:focus-visible > .line { outline: 2px solid ${t('focus')}; outline-offset: -2px }
    .line { display: flex; align-items: center; gap: 6px; padding: 5px 8px; margin: 1px 0; border-radius: ${t('radius-s')}; cursor: pointer; min-width: 0 }
    .line:hover { background: ${t('surface-2')} } li[aria-selected='true'] > .line { background: ${t('accent-soft')} }
    .chev { flex: none; width: 16px; text-align: center; color: ${t('muted')}; transition: transform .15s; user-select: none }
    li[aria-expanded='true'] > .line .chev { transform: rotate(90deg) }
    .label { overflow-wrap: anywhere } .kind { color: ${t('muted')}; font-size: 11px; letter-spacing: .06em; text-transform: uppercase }
    .count { color: ${t('muted')}; font-size: 11px; font-variant-numeric: tabular-nums }
    .tag { font-size: 11px; padding: 2px 7px; border-radius: ${t('radius-s')}; background: ${t('accent-soft')}; white-space: nowrap }
    .end { margin-left: auto; display: inline-flex; align-items: center; gap: 4px }
    .body { padding: 2px 8px 6px 30px; color: ${t('muted')}; font-size: 12px }
    mark { background: ${t('warn-bg')}; color: inherit; border-radius: 2px } .empty { color: ${t('muted')}; padding: 12px }
    @media (pointer: coarse) { .line { min-height: 44px } }`]
  declare nodes: TreeNode[]; declare query: string; declare selected: string | null; declare openDepth: number
  declare flipped: Set<string>; declare focused: string | null
  #rows: Row[] = []
  constructor() { super(); this.nodes = []; this.query = ''; this.selected = null; this.openDepth = 0; this.flipped = new Set(); this.focused = null }

  get #q() { return this.query.trim().toLowerCase() }
  // nodes shallower than open-depth start open; `flipped` holds the ones changed from that; a query opens everything
  #isOpen(id: string, depth: number) { return this.#q !== '' || (depth < this.openDepth) !== this.flipped.has(id) }
  #flip(id: string) { const f = new Set(this.flipped); f.has(id) ? f.delete(id) : f.add(id); this.flipped = f }
  #setOpen(row: Row, open: boolean) { if (row.can && row.open !== open && !this.#q) this.#flip(row.id) }

  /** Opens the way to a node and scrolls it into view; focuses it unless `focus` is false (say, for a selection made elsewhere). */
  reveal(id: string, { focus = true } = {}) {
    const path = pathTo(this.nodes, id)
    path.slice(0, -1).forEach((a, depth) => { if (!this.#isOpen(a, depth)) this.#flip(a) })
    if (path.length) void this.#focus(id, focus)
  }

  async #focus(id: string, focus = true) {
    this.focused = id
    await this.updateComplete
    const li = this.renderRoot.querySelector<HTMLElement>(`[role='treeitem'][data-id="${CSS.escape(id)}"]`)
    if (focus) li?.focus()
    li?.querySelector('.line')?.scrollIntoView?.({ block: 'nearest' })
  }

  #choose(id: string) {
    const go = this.dispatchEvent(new CustomEvent('select', { detail: { id }, cancelable: true, bubbles: true, composed: true }))
    if (go) this.selected = id
  }

  #click(e: MouseEvent, row: Row) {
    const el = e.target as Element
    if (el.closest('.chev')) { this.#setOpen(row, !row.open); return }
    if (el.closest('button, a, input, select, textarea, label')) return   // the row's own controls
    this.#choose(row.id); this.#setOpen(row, !row.open); void this.#focus(row.id)
  }

  #key(e: KeyboardEvent) {
    const li = e.target as HTMLElement
    if (li.getAttribute('role') !== 'treeitem' || e.altKey || e.ctrlKey || e.metaKey) return
    const rows = this.#rows, i = rows.findIndex(r => r.id === li.dataset.id), row = rows[i]
    if (!row) return
    const to = (r?: Row) => { if (r) void this.#focus(r.id) }
    const k = e.key
    if (k === 'ArrowDown') to(rows[i + 1])
    else if (k === 'ArrowUp') to(rows[i - 1])
    else if (k === 'Home') to(rows[0])
    else if (k === 'End') to(rows.at(-1))
    else if (k === 'ArrowRight') row.can && !row.open ? this.#setOpen(row, true) : rows[i + 1]?.parent === row.id && to(rows[i + 1])
    else if (k === 'ArrowLeft') row.can && row.open ? this.#setOpen(row, false) : to(rows.find(r => r.id === row.parent))
    else if (k === 'Enter' || k === ' ') this.#choose(row.id)
    else if (k.length === 1 && k.trim()) {
      const c = k.toLowerCase()
      to([...rows.slice(i + 1), ...rows.slice(0, i)].find(r => r.label.toLowerCase().startsWith(c)))
    } else return
    e.preventDefault()
  }

  #label(s: string) {
    const q = this.#q, i = q ? s.toLowerCase().indexOf(q) : -1
    return i < 0 ? s : html`${s.slice(0, i)}<mark>${s.slice(i, i + q.length)}</mark>${s.slice(i + q.length)}`
  }

  #item(s: Shown, depth: number, byId: Map<string, Row>, tab: string | undefined): unknown {
    const n = s.node, row = byId.get(n.id)!, { can, open } = row
    return html`<li role="treeitem" data-id=${n.id} aria-level=${depth + 1} aria-expanded=${can ? String(open) : nothing}
        aria-selected=${this.selected === n.id ? 'true' : nothing} tabindex=${n.id === tab ? 0 : -1}>
      <div class="line" @click=${(e: MouseEvent) => this.#click(e, row)}>
        <span class="chev" data-toggle=${n.id} aria-hidden="true">${can ? '▸' : ''}</span>
        <span class="label">${this.#label(n.label)}</span>
        ${n.kind ? html`<span class="kind">${n.kind}</span>` : nothing}${n.count !== undefined ? html`<span class="count">${n.count}</span>` : nothing}
        ${n.badge ? html`<span class="tag">${n.badge}</span>` : nothing}${n.end !== undefined ? html`<span class="end">${n.end}</span>` : nothing}
      </div>
      ${open ? html`${n.body !== undefined ? html`<div class="body">${n.body}</div>` : nothing}
        ${s.kids.length ? html`<ul class="group" role="group">${s.kids.map(k => this.#item(k, depth + 1, byId, tab))}</ul>` : nothing}` : nothing}
    </li>`
  }

  override render() {
    const shown = prune(this.nodes, this.#q, this.#q === '')
    // the rows in view, in order, for the keyboard
    const rows: Row[] = []
    const walk = (list: Shown[], depth: number, parent?: string) => list.forEach(s => {
      const can = s.kids.length > 0 || s.node.body !== undefined, open = can && this.#isOpen(s.node.id, depth)
      rows.push({ id: s.node.id, label: s.node.label, parent, can, open })
      if (open) walk(s.kids, depth + 1, s.node.id)
    })
    walk(shown, 0)
    this.#rows = rows
    if (!rows.length) return html`<div class="empty">${this.#q ? `Nothing matches “${this.query.trim()}”.` : 'Nothing here.'}</div>`
    const ids = new Set(rows.map(r => r.id))
    const tab = [this.focused, this.selected].find(id => id && ids.has(id)) ?? rows[0]!.id   // the one tab stop
    return html`<ul role="tree" @keydown=${(e: KeyboardEvent) => this.#key(e)}>${shown.map(s => this.#item(s, 0, new Map(rows.map(r => [r.id, r])), tab))}</ul>`
  }
}

if (globalThis.customElements && !customElements.get('nano-tree')) customElements.define('nano-tree', NanoTree)
