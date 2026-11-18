/**
 * `<nano-explorer>`: the system as a tree (explorer-nodes.ts): by runtime, by operation, by interface, by
 * implementation; a search and a namespace and kind filter. Choosing a node shows its details beside the tree
 * (explorer-details.ts); a pod's "Open view" (or a double-click on a pod) fires `nano-open` with `{ runtime, pod }`.
 */
import { LitElement, css, html } from 'lit'
import { details, type Called, type Where } from './explorer-details.ts'
import { filter, namespaces, nodes, primary } from './explorer-nodes.ts'
import type { Application, Registry } from '@pritzlaff/nano-core'
import { base } from '@pritzlaff/nano-elements'
import '@pritzlaff/nano-elements'

/** `calls`: the op-level calls to show (optional; read on each render). */
type ExplorerTarget = { app: Application; registry: Registry; calls?: Called[] }

const KINDS = ['runtime', 'pod', 'interface', 'implementation', 'operation']

export class NanoExplorer extends LitElement {
  static properties = { target: { attribute: false }, states: { state: true }, selected: { state: true }, query: { state: true }, ns: { state: true }, kinds: { state: true } }
  static styles = [base, css`
    :host { display: block; height: 100%; container-type: inline-size }
    .pane { display: grid; grid-template-rows: auto minmax(0, 1fr); min-height: 0 }
    .filters { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: center; padding: 0 0 6px; font-size: 12px } .filters input[type=search] { flex: 1 1 140px; min-width: 0 }
    .filters details { width: 100% } .filters summary { cursor: pointer; opacity: .7 } .filters label { margin-right: 8px; white-space: nowrap }
    .split { display: grid; grid-template-columns: minmax(0, max-content) minmax(0, 1fr); gap: 12px; height: 100% }
    .details { overflow: auto; padding: 0 8px; border-left: 1px solid var(--nano-line, rgba(128,128,128,.3)) }
    nano-tree { overflow: auto; min-height: 0 }
    @container (max-width: 520px) { .split { grid-template-columns: 1fr; grid-template-rows: minmax(0, 3fr) minmax(0, 2fr) } .details { border-left: 0; border-top: 1px solid var(--nano-line, rgba(128,128,128,.3)); padding-top: 8px } }
    h3 { margin: 4px 0 8px; font-size: 13px } dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; margin: 0 0 12px; font-size: 12px }
    a { color: inherit; text-decoration: underline dotted } dt { opacity: .7 } dd { margin: 0 } ul { margin: 0; padding-left: 16px } .warn { color: var(--nano-warn, #d9a400) } .muted { opacity: .7 }`]
  declare target?: ExplorerTarget
  declare states: Record<string, string>
  declare selected: string | null
  declare query: string
  declare ns: string
  declare kinds: Set<string>
  private off?: () => void
  private watching?: ExplorerTarget

  constructor() { super(); this.states = {}; this.selected = null; this.query = ''; this.ns = ''; this.kinds = new Set(KINDS) }
  connectedCallback() { super.connectedCallback(); this.watch() }
  disconnectedCallback() { super.disconnectedCallback(); this.stop() }
  willUpdate(changed: Map<string, unknown>) { if (changed.has('target')) this.watch() }

  private watch() {
    const t = this.target
    if (!t || !this.isConnected || this.watching === t) return
    this.stop()
    this.watching = t
    this.off = t.app.listen(e => {
      if (e.type === 'built' || e.type === 'closed') this.states = { ...this.states, [e.pod]: e.type }
      else if (e.type === 'applied') {
        const live = t.app.deployment().pods   // built/closed events already keep changed and removed pods right
        this.states = Object.fromEntries(Object.entries(this.states).filter(([pod]) => Object.hasOwn(live, pod)))
      } else if (e.type === 'sent' && e.kind === 'call' && t.calls) queueMicrotask(() => this.requestUpdate())   // a call seen
    })
  }
  private stop() { this.off?.(); this.off = undefined; this.watching = undefined }

  private open(w: Where) { this.dispatchEvent(new CustomEvent('nano-open', { detail: w, bubbles: true, composed: true })) }
  /** A double-click on a pod opens its view. */
  private dbl() { const [k, r, ...p] = (this.selected ?? '').split(':'); if (k === 'p') this.open({ runtime: r!, pod: p.join(':') }) }

  render() {
    if (!this.target) return html``
    const t = this.target
    const c = { d: t.app.deployment(), registry: t.registry, states: this.states, calls: t.calls, go: (id: string) => { this.selected = id }, open: (w: Where) => this.open(w) }
    const all = nodes(c.d, t.registry, this.states)
    const shown = this.ns || this.kinds.size < KINDS.length ? filter(all, this.kinds, this.ns) : all
    const kind = (k: string) => { const s = new Set(this.kinds); s.has(k) ? s.delete(k) : s.add(k); this.kinds = s }
    return html`<div class="split"><div class="pane"><div class="filters">
        <input type="search" placeholder="Search" aria-label="Search" .value=${this.query} @input=${(e: Event) => { this.query = (e.target as HTMLInputElement).value }}>
        <details><summary>Filters</summary>
          <label>Namespace <select aria-label="Namespace" @change=${(e: Event) => { this.ns = (e.target as HTMLSelectElement).value }}>
            <option value="">any</option>${namespaces(all).map(n => html`<option ?selected=${n === this.ns}>${n}</option>`)}</select></label>
          ${KINDS.map(k => html`<label><input type="checkbox" .checked=${this.kinds.has(k)} @change=${() => kind(k)}> ${k}s</label>`)}
        </details></div>
      <nano-tree .nodes=${shown} .query=${this.query} .selected=${this.selected} open-depth="2" @dblclick=${() => this.dbl()}
        @select=${(e: CustomEvent<{ id: string }>) => { e.preventDefault(); const id = primary(e.detail.id); if (!/^g:|\/(pods|impls|ifaces|ops)$/.test(id)) this.selected = id }}></nano-tree></div>
      <section class="details" aria-label="Details">${details(c, this.selected)}</section></div>`
  }
}
