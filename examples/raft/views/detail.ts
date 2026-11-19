// `<raft-detail>`: a node's detail panel (raft.github.io's): its fields, its peers and the buttons that call its ops.
import { LitElement, css, html } from 'lit'
import { base, kit } from '@pritzlaff/nano-elements'
import type { ViewTarget } from '@pritzlaff/nano-ui'
import type { Node } from '../core/types.ts'
import { RaftNode } from '../interfaces.ts'
import { detailModel } from './model.ts'

export class RaftDetail extends LitElement {
  static properties = { target: { attribute: false }, status: { attribute: false }, now: { attribute: false }, error: { state: true } }
  static styles = [base, kit, css`table { border-collapse: collapse; font-size: 12px } td, th { padding: 2px 8px; text-align: left } .row { flex-wrap: wrap }`]
  declare target?: ViewTarget
  declare status?: Node
  declare now: number
  declare error?: string
  private n = 0
  constructor() { super(); this.now = 0 }

  private act(op: 'stop' | 'resume' | 'restart' | 'timeOut' | 'request') {
    const t = this.target!
    const call = t.app.call(t.runtime, t.pod)[RaftNode.ops[op].name]!
    void call(op === 'request' ? `v${++this.n}` : null).then(r => { this.error = r.ok ? undefined : r.fail.reason })
  }
  render() {
    if (!this.status) return html``
    const m = detailModel(this.status, this.now)
    const button = (label: string, op: Parameters<RaftDetail['act']>[0]) => html`<button class="btn small" type="button" @click=${() => this.act(op)}>${label}</button>`
    return html`<div class="col">
      <table class="rows">${m.rows.map(([k, v]) => html`<tr><th>${k}</th><td>${v}</td></tr>`)}</table>
      <table class="peers"><tr><th>peer</th><th>next</th><th>match</th><th>vote granted</th><th>RPC due</th><th>heartbeat due</th></tr>
        ${m.peers.map(p => html`<tr><td>${p.peer}</td><td>${p.next}</td><td>${p.match}</td><td>${p.granted ? 'yes' : 'no'}</td><td>${p.rpcDue}</td><td>${p.heartbeatDue}</td></tr>`)}</table>
      <div class="row">${button('stop', 'stop')}${button('resume', 'resume')}${button('restart', 'restart')}${button('time out', 'timeOut')}${button('request', 'request')}</div>
      ${this.error ? html`<p class="alert bad" role="alert">${this.error}</p>` : ''}</div>`
  }
}
if (!customElements.get('raft-detail')) customElements.define('raft-detail', RaftDetail)
