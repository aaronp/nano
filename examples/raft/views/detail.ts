// `<raft-detail>`: a node's detail panel (raft.github.io's): its fields, its peers, the request's value (a leader's only) and the buttons that call its ops.
import { LitElement, css, html } from 'lit'
import { base, kit } from '@pritzlaff/nano-elements'
import type { ViewTarget } from '@pritzlaff/nano-ui'
import type { Node } from '../core/types.ts'
import { RaftNode } from '../interfaces.ts'
import { detailModel } from './model.ts'

export type NodeOp = 'stop' | 'resume' | 'restart' | 'timeOut' | 'request'
export const NODE_OPS: [string, NodeOp][] = [['stop', 'stop'], ['resume', 'resume'], ['restart', 'restart'], ['time out', 'timeOut'], ['request', 'request']]
/** Calls a node op on the target (the detail's buttons and the node's menu share it); resolves to the refusal's reason, if any. */
export async function callNodeOp(t: ViewTarget, op: NodeOp, value: string): Promise<string | undefined> {
  const r = await t.app.call(t.runtime, t.pod)[RaftNode.ops[op].name]!(op === 'request' ? value : null)
  return r.ok ? undefined : r.fail.reason
}

class RaftDetail extends LitElement {
  static properties = { target: { attribute: false }, status: { attribute: false }, now: { attribute: false }, error: { state: true }, text: { state: true } }
  static styles = [base, kit, css`table { border-collapse: collapse; font-size: 12px } td, th { padding: 2px 8px; text-align: left } .row { flex-wrap: wrap } textarea { width: 100%; font: inherit }`]
  declare target?: ViewTarget
  declare status?: Node
  declare now: number
  declare error?: string
  /** The request's value, as typed (empty: `v<n>`). */
  declare text: string
  private n = 0
  constructor() { super(); this.now = 0; this.text = '' }

  private act(op: NodeOp) { ++this.n; void callNodeOp(this.target!, op, this.text || `v${this.n}`).then(e => { this.error = e }) }
  render() {
    if (!this.status) return html``
    const m = detailModel(this.status, this.now)
    const leader = this.status.role === 'leader'   // only a leader takes a request: its text and button wait for one
    const button = (label: string, op: NodeOp) => html`<button class="btn small" type="button" ?disabled=${op === 'request' && !leader} @click=${() => this.act(op)}>${label}</button>`
    return html`<div class="col">
      <table class="rows">${m.rows.map(([k, v]) => html`<tr><th>${k}</th><td>${v}</td></tr>`)}</table>
      <table class="peers"><tr><th>peer</th><th>next</th><th>match</th><th>vote granted</th><th>RPC due</th><th>heartbeat due</th></tr>
        ${m.peers.map(p => html`<tr><td>${p.peer}</td><td>${p.next}</td><td>${p.match}</td><td>${p.granted ? 'yes' : 'no'}</td><td>${p.rpcDue}</td><td>${p.heartbeatDue}</td></tr>`)}</table>
      <textarea rows="3" aria-label="request value" placeholder=${leader ? 'request value (empty: v<n>)' : 'only the leader takes a request'} ?disabled=${!leader} .value=${this.text} @input=${(e: Event) => { this.text = (e.target as HTMLTextAreaElement).value }}></textarea>
      <div class="row">${NODE_OPS.map(([label, op]) => button(label, op))}</div>
      ${this.error ? html`<p class="alert bad" role="alert">${this.error}</p>` : ''}</div>`
  }
}
if (!customElements.get('raft-detail')) customElements.define('raft-detail', RaftDetail)
