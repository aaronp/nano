// `<raft-ledger>`: a node's stable storage: its currentTerm and votedFor, then its log as a table; committed rows (by the node in the same runtime) are marked.
import { LitElement, css, html } from 'lit'
import { base, kit } from '@pritzlaff/nano-elements'
import type { ViewTarget } from '@pritzlaff/nano-ui'
import type { Persistent } from '../core/types.ts'
import { Ledger, RaftNode } from '../interfaces.ts'
import { ledgerModel } from './model.ts'

class RaftLedgerView extends LitElement {
  static properties = { target: { attribute: false }, model: { state: true } }
  static styles = [base, kit, css`table { border-collapse: collapse; font-size: 12px } td, th { padding: 2px 8px; text-align: left } .committed { color: var(--nano-good, #7EE787) } .head { margin: 0 0 4px; font-size: 12px }`]
  declare target?: ViewTarget
  declare model?: ReturnType<typeof ledgerModel>
  private stop?: () => void
  private watching?: ViewTarget
  private p?: Persistent
  private commit = 0

  connectedCallback() { super.connectedCallback(); this.watch() }
  disconnectedCallback() { super.disconnectedCallback(); this.stop?.(); this.stop = this.watching = undefined }
  willUpdate(changed: Map<string, unknown>) { if (changed.has('target')) this.watch() }

  private watch() {
    const t = this.target
    if (!t || !this.isConnected || this.watching === t) return
    this.stop?.()
    this.watching = t
    this.p = undefined; this.commit = 0; this.model = undefined   // a new target (a shadow app, say) starts from nothing
    const show = () => { if (this.p) this.model = ledgerModel(this.p, this.commit) }, heard = { p: false, commit: false }, offs: (() => void)[] = []
    this.stop = () => offs.forEach(off => off())
    try {   // throws when the app has no such runtime or pod (a shadow from before the cluster): nothing to show
      const rt = t.app.runtime(t.runtime)
      offs.push(rt.subscribe(Ledger.ops.written, ({ output }) => { heard.p = true; this.p = output; show() }))   // read once, then follow `written`
      offs.push(rt.subscribe(RaftNode.ops.changed, ({ output }) => { heard.commit = true; this.commit = output.commitIndex; show() }))
      // the read applies only for what no event has already told (an event is newer than the read), and never after a swap
      void Promise.all([rt.get(Ledger, { pod: t.pod }).read(), rt.get(RaftNode).status()]).then(([p, n]) => {
        if (this.watching !== t) return
        if (!heard.p) this.p = p
        if (!heard.commit) this.commit = n.commitIndex
        show()
      }, () => {})
    } catch { /* empty */ }
  }
  render() {
    const m = this.model
    if (!m) return html``
    return html`<p class="head">currentTerm <b>${m.currentTerm}</b> · votedFor <b>${m.votedFor ?? '—'}</b></p>
      <table><tr><th>index</th><th>term</th><th>value</th><th>at</th></tr>
      ${m.rows.map(r => html`<tr class=${r.committed ? 'committed' : ''}><td>${r.index}</td><td>${r.term}</td><td>${r.value}</td><td>${r.at}</td></tr>`)}</table>`
  }
}
if (!customElements.get('raft-ledger')) customElements.define('raft-ledger', RaftLedgerView)
