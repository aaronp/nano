// The Desk's boxes: each runtime a box under a header, each pod in it a column of jacks (ins left, outs right).
import { html } from 'lit'
import { PALETTE } from '../wires/constants'
import type { DeskLayout, Sized } from './arrange'
import type { Column, DeskModel } from './model'

/** Header height of a column, and a jack row's: arrange's `columnSize` assumes both. */
export const headH = 44
export const rowH = (compact: boolean) => compact ? 20 : 26
const label = (key: string) => key.slice(key.indexOf(' ') + 1).replace(/:(in|out)$/, '').split('/').pop()!
export type Down = (e: PointerEvent, runtime: string, pod?: string) => void
type Arranged = { runtimes: Record<string, Sized>; columns: Record<string, Record<string, Sized>> }

// the jack's key carries the runtime in the attribute: the same pod in two runtimes has the same keys in both
const jack = (rt: string, key: string, side: 'in' | 'out') => html`<span class="jack ${side}" data-jack="${rt} ${key}"><i></i>${label(key)}</span>`

const column = (c: Column, box: Sized, compact: boolean, down: Down) => html`
  <div class="col" data-pod=${c.pod} style="left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px" @pointerdown=${(e: PointerEvent) => down(e, c.runtime, c.pod)}>
    <h4>${c.pod}</h4><small>${c.implementation}</small>
    ${Array.from({ length: Math.max(c.ins.length, c.outs.length) }, (_, i) => html`
      <div class="row" style="height:${rowH(compact)}px">${c.ins[i] ? jack(c.runtime, c.ins[i]!, 'in') : html`<span></span>`}${c.outs[i] ? jack(c.runtime, c.outs[i]!, 'out') : ''}</div>`)}
  </div>`

export const renderRuntimes = (m: DeskModel, a: Arranged, l: DeskLayout, down: Down) => m.runtimes.map((r, i) => {
  const b = a.runtimes[r.id]!
  return html`<div class="rt" data-runtime=${r.id} style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;--c:${PALETTE[i % PALETTE.length]}">
    <h3 @pointerdown=${(e: PointerEvent) => down(e, r.id)}>${r.id}</h3>
    ${r.columns.map(c => column(c, a.columns[r.id]![c.pod]!, l.compact, down))}
  </div>`
})
