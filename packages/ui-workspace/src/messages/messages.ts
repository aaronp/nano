// <c-messages>: the page time machine's messages as a searchable table, and the detail of the one selected. Hand it the
// time machine and the store behind it (as the bars are); it follows both when they are replaced after a Reset.
import { LitElement, css, html } from 'lit'
import { type Frame, type Message, type MessageStore, type TimeMachine } from '@pritzlaff/nano-ui'
import { renderDetail } from './detail.ts'
import { causeChain, follow } from './follow.ts'

const text = (m: Message) => JSON.stringify([m.sent.from, m.sent.to, m.sent.port, m.sent.input, m.outcome]).toLowerCase()

export class Messages extends LitElement {
  static properties = { tm: { attribute: false }, store: { attribute: false }, frame: { state: true }, query: { state: true }, picked: { state: true }, chain: { state: true } }
  static styles = css`
    :host { display: block; background: #0B0E12; color: #E6EDF3; font: 12px system-ui, sans-serif; padding: 8px }
    input { box-sizing: border-box; width: 100%; padding: 4px 10px; margin-bottom: 6px; border: 1px solid #2A323D; border-radius: 999px; background: #12161C; color: inherit; font: inherit }
    table { width: 100%; border-collapse: collapse } th, td { text-align: left; padding: 3px 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 24ch }
    tbody tr { cursor: pointer } tr[data-at] { background: #1C3A4D } tr[data-picked] { outline: 1px solid #4CC2FF }
    button { padding: 2px 8px; border: 1px solid #2A323D; border-radius: 999px; background: #12161C; color: inherit; font: inherit; cursor: pointer }
    pre { margin: 0; padding: 6px; background: #12161C; white-space: pre-wrap; word-break: break-all }`
  declare tm?: TimeMachine
  declare store?: MessageStore
  declare frame?: Frame
  declare query: string
  declare picked?: Message
  declare chain: Message[]
  #off?: () => void

  constructor() { super(); this.query = ''; this.chain = [] }
  connectedCallback() { super.connectedCallback(); this.#watch() }
  disconnectedCallback() { super.disconnectedCallback(); this.#off?.(); this.#off = undefined }
  willUpdate(changed: Map<string, unknown>) { if (changed.has('tm')) { this.picked = undefined; this.chain = []; this.#watch() } }

  #watch() {
    this.#off?.()
    this.#off = this.isConnected ? follow(this.tm, f => { this.frame = f }) : undefined
  }
  async #pick(m: Message) {
    this.tm?.seek(m.at); this.picked = m   // seek pauses
    const chain = await causeChain(this.store, m)
    if (this.picked === m) this.chain = chain
  }

  render() {
    const q = this.query.trim().toLowerCase(), at = this.frame?.at
    const rows = (this.frame?.recent ?? []).filter(m => !q || text(m).includes(q)).reverse()
    return html`
      <input type="search" aria-label="Search messages" placeholder="Search by pod, port or value" .value=${this.query}
        @input=${(e: Event) => { this.query = (e.target as HTMLInputElement).value }}>
      <table><thead><tr><th>At</th><th>From</th><th>To</th><th>Port</th><th>Input</th><th>Result</th></tr></thead>
        <tbody>${rows.map(m => html`<tr ?data-at=${m === at} ?data-picked=${m === this.picked} @click=${() => void this.#pick(m)}>
          <td>${m.at}</td><td>${m.sent.from}</td><td>${m.sent.to}</td><td>${m.sent.port}</td><td>${m.sent.input ?? ''}</td>
          <td>${!m.outcome ? '' : m.outcome.type === 'denied' ? `denied: ${m.outcome.reason}` : m.outcome.result}</td></tr>`)}</tbody></table>
      ${this.picked ? renderDetail(this.picked, this.chain, c => this.tm?.seek(c.at)) : ''}`
  }
}

export const defineMessages = () => { if (!customElements.get('c-messages')) customElements.define('c-messages', Messages) }
