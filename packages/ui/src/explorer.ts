/**
 * `<nano-explorer>`: the system as a tree (explorer-nodes.ts): by runtime, by operation, by interface, by
 * implementation; the shared filter (`<nano-filter>`: search, kinds, namespaces, pod status), a kind icon and a status dot per row. Choosing a node shows its details beside the tree
 * (explorer-details.ts); a pod's "Open view" (or a double-click on a pod) fires `nano-open` with `{ runtime, pod }`.
 */
import { LitElement, css, html } from 'lit'
import type { TreeNode } from '@pritzlaff/nano-elements'
import { details, type Called, type Where } from './explorer-details.ts'
import { namespaces, nodes, primary } from './explorer-nodes.ts'
import { emptyFilter, filterTree, podStatus, type FilterValue, type PodStatus } from './filter/model.ts'
import { kindIcon, statusDot } from './filter/icons.ts'
import './filter/filter.ts'
import type { Application, Registry } from '@pritzlaff/nano-core'
import { base } from '@pritzlaff/nano-elements'
import '@pritzlaff/nano-elements'

/** `calls`: the op-level calls to show (optional; read on each render). */
type ExplorerTarget = { app: Application; registry: Registry; calls?: Called[] }

const KINDS = ['runtime', 'pod', 'interface', 'implementation', 'action', 'event']
const STATUSES: PodStatus[] = ['running', 'not started', 'stopped', 'failed']
/** A pod: its status dot, then the pod icon; groups (no kind) none; the rest `kindIcon`. */
const icon = (n: TreeNode) => n.kind === 'pod' ? html`${statusDot(n.data!.status as PodStatus)}${kindIcon('pod')}` : n.kind ? kindIcon(n.kind) : undefined

export class NanoExplorer extends LitElement {
  static properties = { target: { attribute: false }, states: { state: true }, selected: { state: true }, filter: { state: true } }
  static styles = [base, css`
    :host { display: block; height: 100%; container-type: inline-size }
    .pane { display: grid; grid-template-rows: auto minmax(0, 1fr); min-height: 0 }
    nano-filter { padding: 0 0 6px }
    .split { display: grid; grid-template-columns: minmax(0, max-content) minmax(0, 1fr); gap: 12px; height: 100% }
    .details { overflow: auto; padding: 0 8px; border-left: 1px solid var(--nano-line, rgba(128,128,128,.3)) }
    nano-tree { overflow: auto; min-height: 0 }
    @container (max-width: 520px) { .split { grid-template-columns: 1fr; grid-template-rows: minmax(0, 3fr) minmax(0, 2fr) } .details { border-left: 0; border-top: 1px solid var(--nano-line, rgba(128,128,128,.3)); padding-top: 8px } }
    h3 { margin: 4px 0 8px; font-size: 13px } dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; margin: 0 0 12px; font-size: 12px }
    a { color: inherit; text-decoration: underline dotted } dt { opacity: .7 } dd { margin: 0 } ul { margin: 0; padding-left: 16px } .warn { color: var(--nano-warn, #d9a400) } .muted { opacity: .7 }`]
  declare target?: ExplorerTarget
  declare states: Record<string, PodStatus>
  declare selected: string | null
  declare filter: FilterValue
  private off?: () => void
  private watching?: ExplorerTarget

  constructor() { super(); this.states = {}; this.selected = null; this.filter = emptyFilter() }
  connectedCallback() { super.connectedCallback(); this.watch() }
  disconnectedCallback() { super.disconnectedCallback(); this.stop() }
  willUpdate(changed: Map<string, unknown>) { if (changed.has('target')) this.watch() }

  private watch() {
    const t = this.target
    if (!t || !this.isConnected || this.watching === t) return
    this.stop()
    this.watching = t
    this.off = t.app.listen(e => {
      if (e.type === 'sent') { if (e.kind === 'call' && t.calls) queueMicrotask(() => this.requestUpdate()) }   // a call seen
      else this.states = podStatus(this.states, e, () => new Set(Object.keys(t.app.deployment().pods)))
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
    const shown = filterTree(all, this.filter)
    const groups = { kinds: KINDS, namespaces: namespaces(all), statuses: STATUSES }
    return html`<div class="split"><div class="pane">
        <nano-filter .groups=${groups} .value=${this.filter} @change=${(e: CustomEvent<FilterValue>) => { this.filter = e.detail }}></nano-filter>
      <nano-tree .nodes=${shown} .icon=${icon} .query=${this.filter.text} .selected=${this.selected} open-depth="2" @dblclick=${() => this.dbl()}
        @select=${(e: CustomEvent<{ id: string }>) => { e.preventDefault(); const id = primary(e.detail.id); if (!/^g:|\/(pods|impls|ifaces|ops)$/.test(id)) this.selected = id }}></nano-tree></div>
      <section class="details" aria-label="Details">${details(c, this.selected)}</section></div>`
  }
}
