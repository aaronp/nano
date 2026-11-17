// `<chat-room>`: one participant's view of the general room, a Lit element over an `example.chat/participant` pod.
import { LitElement, css, html } from 'lit'
import { base, kit } from '@pritzlaff/nano-elements'
import type { ViewTarget } from '@pritzlaff/nano-ui'
import { MessagingDef } from '../messaging/contract.ts'
import { ChatDef } from './contract.ts'

export class ChatRoomView extends LitElement {
  static properties = { target: { attribute: false }, lines: { state: true }, error: { state: true } }
  static styles = [base, kit, css`ul { list-style: none; margin: 0; padding: 0 } li > span { flex: 1 } [role='alert'] { margin: 0 }`]
  declare target?: ViewTarget
  declare lines: MessagingDef.Message[]
  declare error?: string
  private watching?: ViewTarget
  private iter?: AsyncIterator<MessagingDef.Message>
  constructor() { super(); this.lines = [] }

  connectedCallback() { super.connectedCallback(); void this.watch() }
  disconnectedCallback() { super.disconnectedCallback(); this.stop() }
  willUpdate(changed: Map<string, unknown>) { if (changed.has('target')) void this.watch() }
  private stop() { void this.iter?.return?.(); this.iter = this.watching = undefined }

  private pod(t: ViewTarget) { return t.app.runtime(t.runtime).get(ChatDef.api, { pod: t.pod }) }
  private async watch() {
    const t = this.target
    if (!t || !this.isConnected || this.watching === t) return
    this.stop()
    this.watching = t
    this.error = undefined
    const room = this.pod(t), it = this.iter = room.lines()[Symbol.asyncIterator]()   // connected before the transcript, so no line is missed
    try {
      const past = await room.transcript()
      if (this.iter !== it) return
      this.lines = past
      for (let m = await it.next(); !m.done && this.iter === it; m = await it.next()) this.lines = [...this.lines, m.value]
    } catch (e) { if (this.iter === it) this.error = String(e) }
  }
  private async send(t: ViewTarget, input: HTMLInputElement) {
    const text = input.value.trim()
    if (!text) return
    input.value = ''
    await this.pod(t).say(text).catch(e => { this.error = String(e) })
  }
  render() {
    const t = this.target
    if (!t) return html``
    return html`<div class="col">${this.error ? html`<p class="alert bad" role="alert">${this.error}</p>` : ''}<h3 class="display-s">${t.pod}</h3>
      <ul>${this.lines.map(m => html`<li class="list-row"><b>${m.from}</b> <span>${m.text}</span></li>`)}</ul>
      <form class="row" @submit=${(e: Event) => { e.preventDefault(); void this.send(t, this.renderRoot.querySelector('input')!) }}>
        <input class="input" aria-label="Message" placeholder="Say something"><button class="btn" type="submit">Send</button></form></div>`
  }
}
