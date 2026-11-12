// Covers: a title card over each footprint, lifted off the board by `lift`. Nothing live is mounted. Plus the lift controls.
import { html } from 'lit'
import { styleMap } from 'lit/directives/style-map.js'
import type { Circuit } from './circuit'
import { LIFT_Z, PAD } from './constants'
import type { LayerFrame } from './layout'

/** The covers of one page. Inset by a pad's radius so the pads on the footprint's edges stay clickable. */
export function renderCovers(el: Circuit, f: LayerFrame) {
  const { lift, sel, hidden } = el.s, screen = f.layer.screen, gone = hidden[screen]
  return f.boxes.filter(b => !gone?.has(b.item.instance)).map(b => {
    const inst = b.item.instance, key = `cover:${screen}|${inst}`, d = el.coverDrag?.key === key ? el.coverDrag : null
    const style = { left: `${b.rect.x + PAD / 2}px`, top: `${b.rect.y}px`, width: `${b.rect.w - PAD}px`, height: `${b.rect.h}px`,
      transform: `translate(${(d?.dx ?? 0) / el.s.zoom}px, ${(d?.dy ?? 0) / el.s.zoom}px) translateZ(${lift * LIFT_Z}px)` }
    return html`<button class="cover ${d || el.reduced() ? '' : 'anim'}" data-cover=${inst} aria-pressed=${sel === key} style=${styleMap(style)}
      @pointerdown=${(e: PointerEvent) => el.coverDown(e, key, screen, inst)} @click=${() => el.select(key)}>${b.item.title}</button>`
  })
}

export function renderLiftTools(el: Circuit) {
  const { lift } = el.s
  return html`<div class="tools">
    <button class="lift" @click=${() => el.toggleLift()}>${lift > 0.5 || el.anyHidden() ? 'Put covers back' : 'Lift covers'}</button>
    <label>Covers <input type="range" min="0" max="100" .value=${String(Math.round(lift * 100))} @input=${(e: Event) => el.setLift(Number((e.target as HTMLInputElement).value) / 100)}></label>
  </div>`
}
