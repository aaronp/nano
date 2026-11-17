// The pill bar: Whole board, and a page per runtime.
import { html } from 'lit'
import type { NanoWiring } from './wiring'

export function renderPills(el: NanoWiring) {
  const { focus } = el.s
  return html`<nav class="pills" aria-label="Wiring views">
    <button class="pill" data-whole @click=${() => el.fitAll()}>Whole board</button>
    ${el.model.layers.map(l => html`<button class="pill" data-screen=${l.screen} aria-pressed=${focus === l.screen} @click=${() => el.go(l.screen)}>
      <span class="ic" aria-hidden="true">${l.title.slice(0, 1).toUpperCase()}</span>${l.title}</button>`)}
  </nav>`
}
