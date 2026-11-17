// The pill bar: Whole board, a page per screen, a system per system.
import { html } from 'lit'
import type { Circuit } from './circuit'

export function renderPills(el: Circuit) {
  const { focus } = el.s
  return html`<nav class="pills" aria-label="Circuit views">
    <button class="pill" data-whole @click=${() => el.fitAll()}>Whole board</button>
    ${el.model.layers.map(l => html`<button class="pill" data-screen=${l.screen} aria-pressed=${focus === l.screen} @click=${() => el.go(l.screen)}>
      <span class="ic" aria-hidden="true">${(l.icon ?? l.title).slice(0, 1).toUpperCase()}</span>${l.title}</button>`)}
    ${el.systems.map(id => html`<button class="pill" data-system=${id} @click=${() => el.fitSystem(id)}>${id}</button>`)}
  </nav>`
}
