// `<raft-cluster>`: creates and removes whole clusters (name, size 3 or 5, seed) and lists the ones made.
import { LitElement, css, html } from 'lit'
import { base, kit } from '@pritzlaff/nano-elements'
import type { ViewTarget } from '@pritzlaff/nano-ui'
import { Cluster } from '../interfaces.ts'

class RaftClusterView extends LitElement {
  static properties = { target: { attribute: false }, names: { state: true }, error: { state: true } }
  static styles = [base, kit, css`ul { list-style: none; margin: 0; padding: 0 }`]
  declare target?: ViewTarget
  declare names: string[]
  declare error?: string
  private stop?: () => void
  private watching?: ViewTarget
  constructor() { super(); this.names = [] }

  connectedCallback() { super.connectedCallback(); this.watch() }
  disconnectedCallback() { super.disconnectedCallback(); this.stop?.(); this.stop = this.watching = undefined }
  willUpdate(changed: Map<string, unknown>) { if (changed.has('target')) this.watch() }

  private pod(t: ViewTarget) { return t.app.runtime(t.runtime).get(Cluster, { pod: t.pod }) }
  private watch() {
    const t = this.target
    if (!t || !this.isConnected || this.watching === t) return
    this.stop?.()
    this.watching = t
    this.stop = undefined
    try { void this.pod(t).list().then(n => { this.names = n }, () => {}) } catch { /* not in this app: nothing listed */ }   // read once; create and remove re-read
  }
  private async run(act: () => Promise<unknown>) {
    this.error = undefined
    try { await act(); await this.pod(this.target!).list().then(n => { this.names = n }) } catch (e) { this.error = (e as { fail?: { reason: string } }).fail?.reason ?? String(e) }
  }
  private field = (name: string) => (this.renderRoot.querySelector(`[name=${name}]`) as HTMLInputElement).value
  render() {
    const t = this.target
    if (!t) return html``
    return html`<div class="col"><div class="row">
        <input class="input" name="name" aria-label="Name" placeholder="name" value="example">
        <select class="input" name="size" aria-label="Size"><option>3</option><option>5</option></select>
        <input class="input" name="seed" type="number" aria-label="Seed" value="1">
        <button class="btn" name="create" type="button" @click=${() => void this.run(() => this.pod(t).create({ name: this.field('name'), size: Number(this.field('size')) as 3 | 5, seed: Number(this.field('seed')) }))}>Create</button>
        <button class="btn" name="remove" type="button" @click=${() => void this.run(() => this.pod(t).remove({ name: this.field('name') }))}>Remove</button></div>
      ${this.error ? html`<p class="alert bad" role="alert">${this.error}</p>` : ''}
      <ul>${this.names.map(n => html`<li>${n}</li>`)}</ul></div>`
  }
}
if (!customElements.get('raft-cluster')) customElements.define('raft-cluster', RaftClusterView)
