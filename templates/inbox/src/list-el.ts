// <inbox-list name="…">: places a List by name (or attaches to one) and shows the messages of the folder as buttons.
import { css, html } from 'lit'
import { PlacedElement, base } from '@pritzlaff/nano-elements'
import { List } from './list'
import type { Message } from './sample-data'

export class ListEl extends PlacedElement {
  static component = List
  static styles = [base, css`
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px }
    button { font: inherit; width: 100%; text-align: left; color: inherit; background: none; border: 0; border-radius: var(--nano-radius-s, 6px); padding: 8px 10px; cursor: pointer; display: grid; gap: 2px }
    button:hover { background: var(--nano-surface-2, #212632) }
    button:focus-visible { outline: 2px solid var(--nano-focus, #6FA8FF); outline-offset: 1px }
    .top { display: flex; justify-content: space-between; gap: 8px } .from { font-weight: 600 }
    .date { color: var(--nano-muted, #A3AAB8); font-size: 12px } .subject { color: var(--nano-muted, #A3AAB8); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
    .empty { color: var(--nano-muted, #A3AAB8); padding: 8px 10px }`]
  render() {
    const shown = this.read<Message[]>(List.ops.shown) ?? []
    return html`${shown.length ? html`<ul aria-label="Messages">${shown.map(m => html`<li><button type="button" @click=${() => this.act(List.ops.open, m.id)}>
      <span class="top"><span class="from">${m.from}</span><span class="date">${m.date}</span></span><span class="subject">${m.subject}</span></button></li>`)}</ul>`
      : html`<div class="empty">No messages</div>`}
      ${this.problem ? html`<div class="problem">${this.problem}</div>` : ''}`
  }
}
