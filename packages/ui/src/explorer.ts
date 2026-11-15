/**
 * `<nano-explorer>`: the application → its runtimes → their pods (implementation, config, state) → the subscriptions
 * there. Choosing a pod, or a "built on" row, fires `nano-open` with `{ runtime, pod }`.
 */
import { LitElement, html } from 'lit'
import type { Application, Registry } from '@pritzlaff/nano'
import { base, type TreeNode } from '@pritzlaff/nano-elements'
import '@pritzlaff/nano-elements'

type ExplorerTarget = { app: Application; registry: Registry }

const op = (port: string) => port.slice(port.lastIndexOf('/') + 1)

export class NanoExplorer extends LitElement {
  static properties = { target: { attribute: false }, states: { state: true } }
  static styles = [base]
  declare target?: ExplorerTarget
  declare states: Record<string, string>
  private off?: () => void
  private watching?: ExplorerTarget
  private opens = new Map<string, { runtime: string; pod: string }>()

  constructor() { super(); this.states = {} }
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
        const live = new Set(Object.keys(t.app.deployment().pods)), gone = new Set([...e.removed, ...e.changed])
        this.states = Object.fromEntries(Object.entries(this.states).filter(([pod]) => live.has(pod) && !gone.has(pod)))
      }
    })
  }
  private stop() { this.off?.(); this.off = undefined; this.watching = undefined }

  private nodes(t: ExplorerTarget): TreeNode[] {
    const d = t.app.deployment()
    this.opens.clear()
    return Object.entries(d.runtimes).map(([runtime, r]) => ({
      id: `r:${runtime}`, label: runtime, kind: 'runtime', count: r.pods.length,
      children: r.pods.map(pod => {
        const p = d.pods[pod], id = `p:${runtime}:${pod}`
        this.opens.set(id, { runtime, pod })
        const subs: TreeNode[] = r.subscriptions.filter(s => s.from === pod).map((s, i) => {
          const sid = `s:${runtime}:${pod}:${i}`
          if (s.kind === 'call') { this.opens.set(sid, { runtime, pod: s.to }); return { id: sid, label: `built on → ${s.to}` } }
          return { id: sid, label: `${op(s.source)} → ${s.to}.${op(s.target)}` }
        })
        return { id, label: pod, kind: 'pod', badge: this.states[pod], terms: [p?.implementation ?? ''],
          body: html`${p?.implementation} ${p?.config === undefined ? '' : JSON.stringify(p.config)}`, children: subs }
      }),
    }))
  }

  render() {
    if (!this.target) return html``
    return html`<nano-tree .nodes=${this.nodes(this.target)} open-depth="2" @select=${(e: CustomEvent<{ id: string }>) => {
      const open = this.opens.get(e.detail.id)
      if (open) this.dispatchEvent(new CustomEvent('nano-open', { detail: open, bubbles: true, composed: true }))
    }}></nano-tree>`
  }
}
