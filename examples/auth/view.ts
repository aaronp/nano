// `<auth-passkey>`: the auth example's view over one `example.auth/passkey` pod: Passkey and Register buttons, and a
// status line of the last result (its own, or an `authenticated` from any caller).
import { LitElement, html } from 'lit'
import { base, kit } from '@pritzlaff/nano-elements'
import type { ViewTarget } from '@pritzlaff/nano-ui'
import { AuthDef } from './contract.ts'
import { register } from './passkey.ts'

export class AuthPasskeyView extends LitElement {
  static properties = { target: { attribute: false }, last: { state: true }, error: { state: true } }
  static styles = [base, kit]
  declare target?: ViewTarget
  declare last?: AuthDef.Result
  declare error?: string
  private watching?: ViewTarget
  private iter?: AsyncIterator<AuthDef.Result>

  connectedCallback() { super.connectedCallback(); void this.watch() }
  disconnectedCallback() { super.disconnectedCallback(); this.stop() }
  willUpdate(changed: Map<string, unknown>) { if (changed.has('target')) void this.watch() }
  private stop() { void this.iter?.return?.(); this.iter = this.watching = undefined }

  private pod(t: ViewTarget) { return t.app.runtime(t.runtime).get(AuthDef.api, { pod: t.pod }) }
  private async watch() {
    const t = this.target
    if (!t || !this.isConnected || this.watching === t) return
    this.stop()
    this.watching = t
    this.error = this.last = undefined
    const it = this.iter = this.pod(t).authenticated()[Symbol.asyncIterator]()
    try {
      for (let n = await it.next(); !n.done && this.iter === it; n = await it.next()) this.last = n.value
    } catch (e) { if (this.iter === it) this.error = String(e) }
  }
  /** The Register button's ceremony (origin-key registers for its own origin). */
  protected register() { return register() }
  private run(p: Promise<AuthDef.Result>) { p.then(r => { this.last = r }, e => { this.error = String(e) }) }
  render() {
    const t = this.target
    if (!t) return html``
    const l = this.last
    return html`<div class="col">${this.error ? html`<p class="alert bad" role="alert">${this.error}</p>` : ''}
      <div class="row"><button class="btn" @click=${() => this.run(this.pod(t).authenticate('sign in'))}>Passkey</button>
      <button class="btn" @click=${() => this.run(this.register())}>Register</button></div>
      <p class="muted" role="status">${!l ? 'Not yet authenticated.' : l.ok ? `${l.purpose}: ok (${l.credentialId}) at ${l.at}` : `${l.purpose}: ${l.reason} at ${l.at}`}</p></div>`
  }
}
