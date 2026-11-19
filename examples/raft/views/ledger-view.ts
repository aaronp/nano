// `<raft-ledger>`: a node's stable storage as a table; committed rows (by the node in the same runtime) are marked.
import { LitElement, css, html } from 'lit'
import { base, kit } from '@pritzlaff/nano-elements'
import type { ViewTarget } from '@pritzlaff/nano-ui'
import type { Persistent } from '../core/types.ts'
import { Ledger, RaftNode } from '../interfaces.ts'
import { ledgerRows } from './model.ts'

class RaftLedgerView extends LitElement {
  static properties = { target: { attribute: false }, rows: { state: true } }
  static styles = [base, kit, css`table { border-collapse: collapse; font-size: 12px } td, th { padding: 2px 8px; text-align: left } .committed { color: #7EE787 }`]
  declare target?: ViewTarget
  declare rows: ReturnType<typeof ledgerRows>
  private stop?: () => void
  private watching?: ViewTarget
  private p?: Persistent
  private commit = 0
  constructor() { super(); this.rows = [] }

  connectedCallback() { super.connectedCallback(); this.watch() }
  disconnectedCallback() { super.disconnectedCallback(); this.stop?.(); this.stop = this.watching = undefined }
  willUpdate(changed: Map<string, unknown>) { if (changed.has('target')) this.watch() }

  private watch() {
    const t = this.target
    if (!t || !this.isConnected || this.watching === t) return
    this.stop?.()
    this.watching = t
    this.p = undefined; this.commit = 0; this.rows = []   // a new target (a shadow app, say) starts from nothing
    const rt = t.app.runtime(t.runtime), show = () => { if (this.p) this.rows = ledgerRows(this.p, this.commit) }, heard = { p: false, commit: false }
    const offs = [rt.subscribe(Ledger.ops.written, ({ output }) => { heard.p = true; this.p = output; show() }),   // read once, then follow `written`
      rt.subscribe(RaftNode.ops.changed, ({ output }) => { heard.commit = true; this.commit = output.commitIndex; show() })]
    this.stop = () => offs.forEach(off => off())
    // the read applies only for what no event has already told (an event is newer than the read), and never after a swap
    void Promise.all([rt.get(Ledger, { pod: t.pod }).read(), rt.get(RaftNode).status()]).then(([p, n]) => {
      if (this.watching !== t) return
      if (!heard.p) this.p = p
      if (!heard.commit) this.commit = n.commitIndex
      show()
    }, () => {})
  }
  render() {
    return html`<table><tr><th>index</th><th>term</th><th>value</th><th>at</th></tr>
      ${this.rows.map(r => html`<tr class=${r.committed ? 'committed' : ''}><td>${r.index}</td><td>${r.term}</td><td>${r.value}</td><td>${r.at}</td></tr>`)}</table>`
  }
}
if (!customElements.get('raft-ledger')) customElements.define('raft-ledger', RaftLedgerView)
