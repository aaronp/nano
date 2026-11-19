// `<raft-ledger>`: a node's stable storage as a table; committed rows (by the node in the same runtime) are marked.
import { LitElement, css, html } from 'lit'
import { base, kit } from '@pritzlaff/nano-elements'
import type { ViewTarget } from '@pritzlaff/nano-ui'
import { Ledger, RaftNode } from '../interfaces.ts'
import { follow } from './follow.ts'
import { ledgerRows } from './model.ts'

export class RaftLedgerView extends LitElement {
  static properties = { target: { attribute: false }, rows: { state: true }, term: { state: true } }
  static styles = [base, kit, css`table { border-collapse: collapse; font-size: 12px } td, th { padding: 2px 8px; text-align: left } .committed { color: #7EE787 }`]
  declare target?: ViewTarget
  declare rows: ReturnType<typeof ledgerRows>
  declare term: number
  private stop?: () => void
  private watching?: ViewTarget
  private seq = 0
  constructor() { super(); this.rows = []; this.term = 0 }

  connectedCallback() { super.connectedCallback(); this.watch() }
  disconnectedCallback() { super.disconnectedCallback(); this.stop?.(); this.stop = this.watching = undefined }
  willUpdate(changed: Map<string, unknown>) { if (changed.has('target')) this.watch() }

  private watch() {
    const t = this.target
    if (!t || !this.isConnected || this.watching === t) return
    this.stop?.()
    this.watching = t
    this.stop = follow(t, async () => {   // every write is a delivered `write` in this runtime, so the table follows `written`
      const at = ++this.seq, rt = t.app.runtime(t.runtime)
      const [p, node] = await Promise.all([rt.get(Ledger, { pod: t.pod }).read(), rt.get(RaftNode).status()]).catch(() => [])
      if (at === this.seq && p && node) { this.rows = ledgerRows(p, node.commitIndex); this.term = p.currentTerm }
    })
  }
  render() {
    return html`<table><tr><th>index</th><th>term</th><th>value</th><th>at</th></tr>
      ${this.rows.map(r => html`<tr class=${r.committed ? 'committed' : ''}><td>${r.index}</td><td>${r.term}</td><td>${r.value}</td><td>${r.at}</td></tr>`)}</table>`
  }
}
if (!customElements.get('raft-ledger')) customElements.define('raft-ledger', RaftLedgerView)
