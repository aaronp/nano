/**
 * `<nano-explorer>`: the application → its runtimes → their pods (implementation, config, state) → the subscriptions
 * there; then the registry's interfaces and implementations. Choosing a node shows its details beside the tree
 * (explorer-details.ts); a pod's "Open view" (or a double-click on a pod) fires `nano-open` with `{ runtime, pod }`.
 */
import { LitElement, css, html } from 'lit'
import { details, type Where } from './explorer-details.ts'
import type { Application, Registry } from '@pritzlaff/nano-core'
import { base, type TreeNode } from '@pritzlaff/nano-elements'
import '@pritzlaff/nano-elements'

type ExplorerTarget = { app: Application; registry: Registry }

const op = (port: string) => port.slice(port.lastIndexOf('/') + 1)

export class NanoExplorer extends LitElement {
  static properties = { target: { attribute: false }, states: { state: true }, selected: { state: true } }
  static styles = [base, css`
    :host { display: block; height: 100%; container-type: inline-size }
    .split { display: grid; grid-template-columns: minmax(0, max-content) minmax(0, 1fr); gap: 12px; height: 100% }
    .details { overflow: auto; padding: 0 8px; border-left: 1px solid var(--nano-line, rgba(128,128,128,.3)) }
    nano-tree { overflow: auto; min-height: 0 }
    @container (max-width: 520px) { .split { grid-template-columns: 1fr; grid-template-rows: minmax(0, 3fr) minmax(0, 2fr) } .details { border-left: 0; border-top: 1px solid var(--nano-line, rgba(128,128,128,.3)); padding-top: 8px } }
    h3 { margin: 4px 0 8px; font-size: 13px } dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; margin: 0 0 12px; font-size: 12px }
    a { color: inherit; text-decoration: underline dotted } dt { opacity: .7 } dd { margin: 0 } ul { margin: 0; padding-left: 16px } .warn { color: var(--nano-warn, #d9a400) } .muted { opacity: .7 }`]
  declare target?: ExplorerTarget
  declare states: Record<string, string>
  declare selected: string | null
  private off?: () => void
  private watching?: ExplorerTarget

  constructor() { super(); this.states = {}; this.selected = null }
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
      }
    })
  }
  private stop() { this.off?.(); this.off = undefined; this.watching = undefined }

  private nodes(t: ExplorerTarget): TreeNode[] {
    const d = t.app.deployment()
    const m = t.registry.manifest()
    const runtimes: TreeNode[] = Object.entries(d.runtimes).map(([runtime, r]) => ({
      id: `r:${runtime}`, label: runtime, kind: 'runtime', count: r.pods.length,
      children: r.pods.map(pod => {
        const p = d.pods[pod], id = `p:${runtime}:${pod}`
        const subs: TreeNode[] = r.subscriptions.filter(s => s.from === pod).map((s, i) => {
          const sid = `s:${runtime}:${pod}:${i}`
          if (s.kind === 'call') return { id: sid, label: `built on → ${s.to}` }
          return { id: sid, label: `${op(s.source)} → ${s.to}.${op(s.target)}` }
        })
        return { id, label: pod, kind: 'pod', badge: this.states[pod], terms: [p?.implementation ?? ''],
          body: html`${p?.implementation} ${p?.config === undefined ? '' : JSON.stringify(p.config)}`, children: subs }
      }),
    }))
    return [...runtimes,
      { id: 'g:interfaces', label: 'Interfaces', count: m.interfaces.length, children: m.interfaces.map(i => ({ id: `i:${i.coord}`, label: i.coord, kind: 'interface' })) },
      { id: 'g:implementations', label: 'Implementations', count: m.implementations.length, children: m.implementations.map(i => ({ id: `m:${i.coord}`, label: i.coord, kind: 'implementation' })) }]
  }

  private open(w: Where) { this.dispatchEvent(new CustomEvent('nano-open', { detail: w, bubbles: true, composed: true })) }
  /** A double-click on a pod opens its view. */
  private dbl() { const [k, r, ...p] = (this.selected ?? '').split(':'); if (k === 'p') this.open({ runtime: r!, pod: p.join(':') }) }

  render() {
    if (!this.target) return html``
    const t = this.target
    const c = { d: t.app.deployment(), registry: t.registry, states: this.states, go: (id: string) => { this.selected = id }, open: (w: Where) => this.open(w) }
    return html`<div class="split"><nano-tree .nodes=${this.nodes(t)} .selected=${this.selected} open-depth="2" @dblclick=${() => this.dbl()}
      @select=${(e: CustomEvent<{ id: string }>) => { this.selected = e.detail.id.startsWith('g:') ? this.selected : e.detail.id }}></nano-tree>
      <section class="details" aria-label="Details">${details(c, this.selected)}</section></div>`
  }
}
