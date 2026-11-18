// The Desk's boxes: each runtime a box under a header, each pod in it a column of jacks (ins left, outs right).
import { html } from 'lit'
import { PALETTE } from '../wires/constants'
import { COL_HEAD, jackLabel, rowH, type DeskLayout, type Sized } from './arrange'
import type { Column, DeskModel } from './model'

export type Down = (e: PointerEvent, runtime: string, pod?: string) => void
type Arranged = { runtimes: Record<string, Sized>; columns: Record<string, Record<string, Sized>> }

// the jack's key carries the runtime in the attribute: the same pod in two runtimes has the same keys in both
const jack = (m: DeskModel, rt: string, key: string, side: 'in' | 'out') => html`<span class="jack ${side}" data-jack="${rt} ${key}" ?data-event=${m.wires.P[key]?.op.kind === 'event'}><i></i>${jackLabel(key)}</span>`

const column = (m: DeskModel, c: Column, box: Sized, compact: boolean, down: Down) => html`
  <div class="col" data-pod=${c.pod} style="left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px" @pointerdown=${(e: PointerEvent) => down(e, c.runtime, c.pod)}>
    <h4>${c.pod}</h4><small style="height:${COL_HEAD - 30}px">${c.implementation}</small>
    ${Array.from({ length: Math.max(c.ins.length, c.outs.length) }, (_, i) => html`
      <div class="row" style="height:${rowH(compact)}px">${c.ins[i] ? jack(m, c.runtime, c.ins[i]!, 'in') : html`<span></span>`}${c.outs[i] ? jack(m, c.runtime, c.outs[i]!, 'out') : ''}</div>`)}
  </div>`

export const renderRuntimes = (m: DeskModel, a: Arranged, l: DeskLayout, down: Down) => m.runtimes.map((r, i) => {
  const b = a.runtimes[r.id]!
  return html`<div class="rt" data-runtime=${r.id} style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;--c:${PALETTE[i % PALETTE.length]}">
    <h3 @pointerdown=${(e: PointerEvent) => down(e, r.id)}>${r.id}</h3>
    ${r.columns.map(c => column(m, c, a.columns[r.id]![c.pod]!, l.compact, down))}
  </div>`
})
