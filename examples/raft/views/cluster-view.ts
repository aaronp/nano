// `<raft-cluster>`: creates and removes whole clusters (name, size 3 or 5, seed, heartbeat) and lists the ones made.
import { LitElement, css, html } from 'lit'
import { base, kit } from '@pritzlaff/nano-elements'
import type { ViewTarget } from '@pritzlaff/nano-ui'
import { Cluster, RaftNode } from '../interfaces.ts'
import './ring.ts'

class RaftClusterView extends LitElement {
  static properties = { target: { attribute: false }, names: { state: true }, chosen: { state: true }, ids: { state: true }, error: { state: true } }
  static styles = [base, kit, css`ul { list-style: none; margin: 0; padding: 0 } label { display: inline-flex; align-items: center; gap: .35em; font-size: .85em; color: var(--nano-muted, inherit) }`]
  declare target?: ViewTarget
  declare names: string[]
  declare chosen?: string
  declare ids: string[]
  declare error?: string
  private loaded?: string
  private loadedFor?: ViewTarget
  private stop?: () => void
  private watching?: ViewTarget
  constructor() { super(); this.names = []; this.ids = [] }

  connectedCallback() { super.connectedCallback(); this.watch() }
  disconnectedCallback() { super.disconnectedCallback(); this.stop?.(); this.stop = this.watching = undefined }
  willUpdate(changed: Map<string, unknown>) { if (changed.has('target')) this.watch(); this.draw() }
  private get shown() { return this.chosen !== undefined && this.names.includes(this.chosen) ? this.chosen : this.names[0] }
  private draw() {   // the chosen cluster's node ids: node `<name>-1`'s status names itself and its peers
    const t = this.target, name = this.shown, key = t && name !== undefined ? `${name}` : undefined
    if (this.loaded === key && this.loadedFor === t) return
    this.loaded = key; this.loadedFor = t
    this.ids = []
    if (!t || !name) return
    try { void t.app.runtime(`${name}-1`).get(RaftNode, { pod: `${name}-1-raft` }).status().then(s => { if (this.loaded === key && this.loadedFor === t) this.ids = [s.id, ...s.peers].sort() }, () => { if (this.loadedFor === t) this.loaded = undefined }) } catch { /* no such cluster: nothing drawn */ }
  }

  private pod(t: ViewTarget) { return t.app.runtime(t.runtime).get(Cluster, { pod: t.pod }) }
  private watch() {
    const t = this.target
    if (!t || !this.isConnected || this.watching === t) return
    this.stop?.()
    this.watching = t
    this.stop = undefined
    try { void this.pod(t).list().then(n => { this.names = n }, () => {}) } catch { /* not in this app: nothing listed */ }   // read once; create and remove re-read
  }
  private async run(act: () => Promise<unknown>, after: () => void) {
    this.error = undefined
    try { await act(); await this.pod(this.target!).list().then(n => { this.names = n }); after() } catch (e) { this.error = (e as { fail?: { reason: string } }).fail?.reason ?? String(e) }
  }
  private field = (name: string) => (this.renderRoot.querySelector(`[name=${name}]`) as HTMLInputElement).value
  render() {
    const t = this.target
    if (!t) return html``
    return html`<div class="col"><div class="row">
        <label>cluster <input class="input" name="name" placeholder="name" value="example"></label>
        <label>nodes <select class="input" name="size"><option>3</option><option>5</option></select></label>
        <label title="seeds the election timeouts: the same seed replays the same election">seed <input class="input" name="seed" type="number" value="1"></label>
        <label>heartbeat ms <input class="input" name="heartbeat" type="number" value="1000"></label>
        <button class="btn" name="create" type="button" @click=${() => void this.run(() => this.pod(t).create({ name: this.field('name'), size: Number(this.field('size')) as 3 | 5, seed: Number(this.field('seed')), heartbeatMs: Number(this.field('heartbeat')) }), () => { this.chosen = this.field('name') })}>Create</button>
        <button class="btn" name="remove" type="button" @click=${() => void this.run(() => this.pod(t).remove({ name: this.field('name') }), () => { if (this.chosen === this.field('name')) this.chosen = undefined })}>Remove</button></div>
      ${this.error ? html`<p class="alert bad" role="alert">${this.error}</p>` : ''}
      <ul>${this.names.map(n => html`<li><button class="btn" type="button" aria-pressed=${n === this.shown} @click=${() => { this.chosen = n; (this.renderRoot.querySelector('[name=name]') as HTMLInputElement).value = n }}>${n}</button></li>`)}</ul>
      <raft-ring .target=${t} .ids=${this.ids}></raft-ring><raft-log .target=${t} .ids=${this.ids}></raft-log></div>`
  }
}
if (!customElements.get('raft-cluster')) customElements.define('raft-cluster', RaftClusterView)
