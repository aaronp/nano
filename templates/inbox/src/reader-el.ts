// <inbox-reader name="…">: places a Reader by name (or attaches to one) and shows its message.
import { css, html } from 'lit'
import { PlacedElement, base } from '@pritzlaff/nano-elements'
import { Reader } from './reader'
import type { Message } from './sample-data'

export class ReaderEl extends PlacedElement {
  static component = Reader
  static styles = [base, css`
    article { display: grid; gap: 6px }
    h2 { margin: 0; font-size: 16px } .meta { color: var(--nano-muted, #A3AAB8); font-size: 12px; display: flex; gap: 10px; flex-wrap: wrap }
    pre { margin: 6px 0 0; font: inherit; white-space: pre-wrap; overflow-wrap: anywhere }
    .empty { color: var(--nano-muted, #A3AAB8) }`]
  render() {
    const m = this.read<Message | null>(Reader.ops.message)
    return html`${m ? html`<article aria-label="Message"><h2>${m.subject}</h2><div class="meta"><span>${m.from}</span><span>${m.date}</span></div><pre>${m.body}</pre></article>`
      : html`<div class="empty">Nothing selected</div>`}
      ${this.problem ? html`<div class="problem">${this.problem}</div>` : ''}`
  }
}
