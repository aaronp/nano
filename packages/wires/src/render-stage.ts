// The stage: the 3D world (the live dock on its front face, the wiring on its back), and the hint and toast bar.
import { html } from 'lit'
import { ERR_COLOR, OK_COLOR, SCALE } from './constants'
import { onCancel, onDbl, onDown, onMove, onUp } from './pointer'
import { renderBack } from './render-back'
import { renderBlocks, renderPuzzle } from './render-pieces'
import type { Vals } from './render-root'
import type { Wires } from './wires'

export function renderStage(el: Wires, d: Vals) {
  const { s, m, isRelay } = d
  const { W, H } = m
  const worldT = 'scale(' + SCALE + ') rotateX(' + s.rx.toFixed(2) + 'deg) rotateY(' + s.ry.toFixed(2) + 'deg)'
  const worldTr = s.dragging ? 'none' : 'transform 900ms cubic-bezier(0.2, 0.75, 0.15, 1)'
  const cursor = s.editing ? (s.cord || s.lift ? 'grabbing' : 'crosshair') : s.dragging ? 'grabbing' : 'grab'
  const armed = s.armed ? el.catalog[s.armed]?.title ?? s.armed : null
  const hint = !s.editing
    ? 'Drag the pane to rotate · double-click to flip'
    : isRelay
      ? 'Drag from a jack to patch · drag a plugged input to move it, drop it in space to unplug · click a module to select it, drag it onto the pane to open it'
      : armed !== null
        ? 'Click a + to insert ' + armed + ' there'
        : 'Pick an operator, then click a + between pieces · click × to unplug · click an operator piece to select it'
  const toast = s.cord && s.cord.err ? { kind: 'err', text: s.cord.err } : s.toast
  return html`<div class="stage-bg" @pointerdown=${(e: PointerEvent) => onDown(el, e)} @pointermove=${(e: PointerEvent) => onMove(el, e)} @pointerup=${(e: PointerEvent) => onUp(el, e)} @pointercancel=${() => onCancel(el)} @dblclick=${() => onDbl(el)} style="position:relative; flex:1; min-width:0; overflow:hidden; perspective:2400px; perspective-origin:50% 40%; cursor:${cursor}; touch-action:none; user-select:none">

  <div style="position:absolute; left:50%; top:46%; width:${W}px; height:${H}px; margin-left:${-W / 2}px; margin-top:${-H / 2 - 50}px; transform-style:preserve-3d; transform:${worldT}; transition:${worldTr}">

    <div style="position:absolute; left:0; top:0; width:${W}px; height:12px; background:#2A313C; transform:translateY(-6px) rotateX(90deg)"></div>
    <div style="position:absolute; left:0; top:${H - 12}px; width:${W}px; height:12px; background:#1A1F27; transform:translateY(6px) rotateX(90deg)"></div>
    <div style="position:absolute; left:0; top:0; width:12px; height:${H}px; background:#222831; transform:translateX(-6px) rotateY(90deg)"></div>
    <div style="position:absolute; left:${W - 12}px; top:0; width:12px; height:${H}px; background:#222831; transform:translateX(6px) rotateY(90deg)"></div>

    <div class="front" style="position:absolute; left:0; top:0; width:${W}px; height:${H}px; background:#0A0D11; transform:translateZ(6px); backface-visibility:hidden; -webkit-backface-visibility:hidden"><slot></slot></div>

    <div style="position:absolute; left:0; top:0; width:${W}px; height:${H}px; transform-style:preserve-3d; transform:translateZ(-6px) rotateY(180deg)">
      ${renderBack(el, d)}
      ${isRelay ? '' : renderPuzzle(el, d)}
      ${renderBlocks(d)}
    </div>
  </div>

  <div style="position:absolute; left:20px; bottom:18px; right:20px; display:flex; align-items:center; gap:12px; pointer-events:none">
    <div style="display:flex; align-items:center; gap:10px; font-size:12px; color:#8B96A5">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8B96A5" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"></path><path d="M21 3v5h-5"></path><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"></path><path d="M3 21v-5h5"></path></svg>
      ${hint}
    </div>
    <div style="flex:1"></div>
    ${toast ? html`<p role="status" style="margin:0; font-size:12px; font-weight:500; padding:8px 12px; border-radius:6px; background:#161B22; border:1px solid ${toast.kind === 'err' ? ERR_COLOR : OK_COLOR}; color:${toast.kind === 'err' ? ERR_COLOR : OK_COLOR}">${toast.text}</p>` : ''}
  </div>
</div>`
}
