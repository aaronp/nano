// `<chat-room>`: one participant's view of the general room, a Lit element over an `example.chat/participant` pod.
import { LitElement, html } from 'lit'
import { base, kit } from '@pritzlaff/nano-elements'
import type { ViewTarget } from '@pritzlaff/nano-ui'
import { MessagingDef } from '../messaging/contract.ts'
import { ChatDef } from './contract.ts'

export class ChatRoomView extends LitElement {
  static properties = { target: { attribute: false }, lines: { state: true } }
  static styles = [base, kit]
  declare target?: ViewTarget
  declare lines: MessagingDef.Message[]
  private watching?: ViewTarget
  private live = false
  constructor() { super(); this.lines = [] }

  connectedCallback() { super.connectedCallback(); this.live = true; void this.watch() }
  disconnectedCallback() { super.disconnectedCallback(); this.live = false; this.watching = undefined }
  willUpdate(changed: Map<string, unknown>) { if (changed.has('target')) void this.watch() }

  private pod(t: ViewTarget) { return t.app.runtime(t.runtime).get(ChatDef.api, { pod: t.pod }) }
  private async watch() {
    const t = this.target
    if (!t || !this.live || this.watching === t) return
    this.watching = t
    const room = this.pod(t), heard = room.lines()[Symbol.asyncIterator]()   // connected before the transcript, so no line is missed
    try {
      this.lines = await room.transcript()
      for (let m = await heard.next(); !m.done && this.live && this.watching === t; m = await heard.next()) this.lines = [...this.lines, m.value]
    } finally { void heard.return?.() }
  }
  private async send(t: ViewTarget, input: HTMLInputElement) {
    const text = input.value.trim()
    if (!text) return
    input.value = ''
    await this.pod(t).say(text)
  }
  render() {
    const t = this.target
    if (!t) return html``
    return html`<h3>${t.pod}</h3>
      <ul>${this.lines.map(m => html`<li><b>${m.from}</b> ${m.text}</li>`)}</ul>
      <form @submit=${(e: Event) => { e.preventDefault(); void this.send(t, this.renderRoot.querySelector('input')!) }}>
        <input class="input" aria-label="Message" placeholder="Say something"><button class="btn" type="submit">Send</button></form>`
  }
}
