// `<raft-ring>` and `<raft-log>`: a cluster's nodes on a circle (each a `<raft-node>`), and its log grid (a row per node, a column per log index).
import { LitElement, css, html } from 'lit'
import { base, kit } from '@pritzlaff/nano-elements'
import type { ViewTarget } from '@pritzlaff/nano-ui'
import type { Persistent } from '../core/types.ts'
import { Ledger, RaftNode } from '../interfaces.ts'
import { gridModel } from './model.ts'

class RaftRingView extends LitElement {
  static properties = { target: { attribute: false }, ids: { attribute: false } }
  static styles = [base, css`.ring { position: relative; width: 420px; height: 420px; margin: 8px 0 } .at { position: absolute; margin: -60px 0 0 -60px; text-align: center; font-size: 12px }`]
  declare target?: ViewTarget
  declare ids: string[]
  private targets: ViewTarget[] = []
  constructor() { super(); this.ids = [] }
  willUpdate(changed: Map<string, unknown>) {   // one target per node, kept while the cluster stays, so each `<raft-node>` watches once
    const t = this.target
    if (t && (changed.has('target') || changed.has('ids'))) this.targets = this.ids.map(id => ({ ...t, runtime: id, pod: `${id}-raft` }))
  }
  render() {
    const n = this.ids.length
    return html`<div class="ring">${this.ids.map((id, i) => { const a = 2 * Math.PI * i / n - Math.PI / 2
      return html`<div class="at" style="left:${50 + 36 * Math.cos(a)}%;top:${50 + 36 * Math.sin(a)}%"><raft-node .target=${this.targets[i]}></raft-node><div>${id}</div></div>` })}</div>`
  }
}
if (!customElements.get('raft-ring')) customElements.define('raft-ring', RaftRingView)

class RaftLogView extends LitElement {
  static properties = { target: { attribute: false }, ids: { attribute: false }, rows: { state: true } }
  static styles = [base, kit, css`table { border-collapse: collapse; font-size: 12px } td, th { padding: 2px 8px; border: 1px solid var(--nano-border, #8b949e55); text-align: center } .committed { color: var(--nano-good, #7EE787) }`]
  declare target?: ViewTarget
  declare ids: string[]
  declare rows: { id: string; p: Persistent; commitIndex: number }[]
  private stop?: () => void
  private watching?: { t?: ViewTarget; ids: string[] }
  constructor() { super(); this.ids = []; this.rows = [] }
  disconnectedCallback() { super.disconnectedCallback(); this.stop?.(); this.stop = this.watching = undefined }
  connectedCallback() { super.connectedCallback(); this.watch() }
  willUpdate(changed: Map<string, unknown>) { if (changed.has('target') || changed.has('ids')) this.watch() }
  private watch() {
    const t = this.target, ids = this.ids
    if (this.watching?.t === t && this.watching?.ids === ids && this.isConnected) return
    this.stop?.(); this.stop = undefined; this.watching = { t, ids }
    const ok = () => this.ids === ids && this.target === t
    this.rows = []
    if (!t || !this.isConnected) return
    const have = new Map<string, { p?: Persistent; commitIndex: number }>(), offs: (() => void)[] = []
    this.stop = () => offs.forEach(off => off())
    const show = () => { this.rows = ids.flatMap(id => { const s = have.get(id); return s?.p ? [{ id, p: s.p, commitIndex: s.commitIndex }] : [] }) }
    for (const id of ids) {
      const s: { p?: Persistent; commitIndex: number } = { commitIndex: 0 }, heard = { p: false, c: false }
      have.set(id, s)
      try {
        const rt = t.app.runtime(id)
        offs.push(rt.subscribe(Ledger.ops.written, ({ output }) => { heard.p = true; s.p = output; show() }))
        offs.push(rt.subscribe(RaftNode.ops.changed, ({ output }) => { heard.c = true; s.commitIndex = output.commitIndex; show() }))
        void Promise.all([rt.get(Ledger, { pod: `${id}-ledger` }).read(), rt.get(RaftNode).status()]).then(([p, n]) => {   // events newer than the read win
          if (!ok()) return
          if (!heard.p) s.p = p
          if (!heard.c) s.commitIndex = n.commitIndex
          show()
        }, () => {})
      } catch { /* no such runtime: no row */ }
    }
  }
  render() {
    if (!this.rows.length) return html``
    const m = gridModel(this.rows)
    return html`<table><tr><th></th>${Array.from({ length: m.columns }, (_, i) => html`<th>${i + 1}</th>`)}</tr>
      ${m.rows.map(r => html`<tr><th>${r.id}</th>${r.cells.map(c => html`<td class=${c?.committed ? 'committed' : ''}>${c?.term ?? ''}</td>`)}</tr>`)}</table>`
  }
}
if (!customElements.get('raft-log')) customElements.define('raft-log', RaftLogView)
