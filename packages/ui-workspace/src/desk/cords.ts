// The Desk's cords, measured from the layout (the boxes and each jack's row), not the DOM: the spike's left-to-right
// S-curves, pipes solid in their route's colour (the selected one outlined), calls dashed (opCord).
import { svg } from 'lit'
import type { Message } from '@pritzlaff/nano-ui'
import { CALL_COLOR, OK_COLOR } from '../wires/constants'
import { opCord } from '../wires/calls'
import { cordD, type Cord } from '../wires/geometry'
import { colHead, rowH, type DeskLayout, type Sized } from './arrange'
import type { DeskModel } from './model'

type Sent = Message['sent']
type XY = { x: number; y: number }
type Arranged = { runtimes: Record<string, Sized>; columns: Record<string, Record<string, Sized>> }

/** Leaves to the right, enters from the left, an S between. */
export const sCurve = (a: XY, z: XY): Cord => {
  const dx = Math.max(60, Math.abs(z.x - a.x) / 2)
  return { a: [a.x, a.y], c1: [a.x + dx, a.y], c2: [z.x - dx, z.y], b: [z.x, z.y] }
}

/** A jack's centre in the runtime it is drawn in (jack keys are per pod, so the runtime picks the column). */
export function jackAt(m: DeskModel, a: Arranged, l: DeskLayout, runtime: string, key: string): XY | undefined {
  const c = m.runtimes.find(r => r.id === runtime)?.columns.find(c => c.pod === key.slice(0, key.indexOf(' ')))
  const box = c && a.columns[runtime]?.[c.pod], rt = a.runtimes[runtime]
  if (!c || !box || !rt) return
  const out = key.endsWith(':out'), i = (out ? c.outs : c.ins).indexOf(key)
  if (i < 0) return
  // the dot's centre: 1px border, 8px padding, half the 14px dot
  return { x: rt.x + box.x + (out ? box.w - 16 : 16), y: rt.y + box.y + colHead(l.compact) + i * rowH(l.compact) + rowH(l.compact) / 2 }
}

/** The runtime a pod's column is drawn in: `prefer` when it has one there, else the first that has one. */
const home = (m: DeskModel, pod: string, prefer: string) => {
  const has = (r: DeskModel['runtimes'][number]) => r.columns.some(c => c.pod === pod)
  return m.runtimes.find(r => r.id === prefer && has(r))?.id ?? m.runtimes.find(has)?.id
}
/** A column's side, level with its header: where a pod-level call leaves (right) or enters (left). */
const sideAt = (a: Arranged, l: DeskLayout, runtime: string, pod: string, right: boolean): XY | undefined => {
  const box = a.columns[runtime]?.[pod], rt = a.runtimes[runtime]
  return box && rt ? { x: rt.x + box.x + (right ? box.w : 0), y: rt.y + box.y + colHead(l.compact) / 2 } : undefined
}

export function renderCords(m: DeskModel, a: Arranged, l: DeskLayout, selected?: string) {
  const at = (rt: string | undefined, k: string) => rt === undefined ? undefined : jackAt(m, a, l, rt, k)
  const colour = (route: string) => m.wires.routes.find(r => r.id === route)?.color ?? OK_COLOR
  const pipes = m.pipes.flatMap(w => {
    const p = at(w.runtime, w.from), q = at(w.runtime, w.to), d = p && q && cordD(sCurve(p, q)), on = w.id === selected
    return d ? [svg`${on ? svg`<path d=${d} fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round"></path>` : ''}
      <path data-pipe=${w.id} ?data-selected=${on} d=${d} fill="none" stroke=${colour(w.route)} stroke-width=${on ? 6 : 3} stroke-linecap="round"></path>`] : []
  })
  // each end in a runtime where that pod has a column (the edge's own first: the caller may live only elsewhere)
  const calls = m.calls.map(c => {
    const from = home(m, c.from, c.runtime), to = home(m, c.to, c.runtime)
    const ops = c.pairs.flatMap(o => {
      const p = o.source === null ? undefined : at(from, `${o.from} ${o.source}:out`), q = at(to, `${o.to} ${o.target}:in`)
      return p && q ? [{ a: p, b: q, declared: o.declared, seen: o.seen }] : []
    })
    // else from the caller column: to the callee's jacks called from an unknown op, else (no usable pair) every jack it may call
    const unknown = c.pairs.flatMap(o => o.source === null ? at(to, `${o.to} ${o.target}:in`) ?? [] : [])
    const ends = ops.length || unknown.length ? unknown : c.jacks.filter(k => k.startsWith(c.to + ' ')).flatMap(k => at(to, k) ?? [])
    const start = from && sideAt(a, l, from, c.from, true), none = !ops.length && !ends.length && to && sideAt(a, l, to, c.to, false)
    return svg`<g data-call=${c.id}>${ops.map(o => opCord(o, sCurve))}${start ? [...ends, ...none ? [none] : []].map(b => svg`<path d=${cordD(sCurve(start, b))} fill="none" stroke=${CALL_COLOR} stroke-opacity="0.6" stroke-width="2.5" stroke-dasharray="10 6" stroke-linecap="round"></path>`) : ''}</g>`
  })
  return [...pipes, ...calls]
}

/**
 * The cord a message travels, from the current model (none when its pod, pipe or runtime isn't drawn). A pipe: the pipe
 * into the target jack (the source jack the `cause` names, else the first). A call: caller to the callee's jack, from
 * the op the `cause` shows the caller was in, else from the caller column's side. Only calls and pipes have one.
 */
export function cordOf(m: DeskModel, a: Arranged, l: DeskLayout, s: Sent, cause?: Sent): Cord | undefined {
  const into = `${s.to} ${s.port}:in`, via = cause?.to === s.from ? `${s.from} ${cause.port}:out` : undefined
  if (s.kind === 'pipe') {
    const ws = m.pipes.filter(w => w.runtime === s.runtime && w.from.startsWith(s.from + ' ') && w.to === into)
    const w = ws.find(w => w.from === via) ?? ws[0], p = w && jackAt(m, a, l, s.runtime, w.from), q = w && jackAt(m, a, l, s.runtime, w.to)
    return p && q ? sCurve(p, q) : undefined
  }
  const c = s.kind === 'call' ? m.calls.find(c => c.runtime === s.runtime && c.from === s.from && c.to === s.to) : undefined
  const from = c && home(m, s.from, s.runtime), to = c && home(m, s.to, s.runtime)
  if (!from || !to) return
  const p = (via && jackAt(m, a, l, from, via)) || sideAt(a, l, from, s.from, true), q = jackAt(m, a, l, to, into) ?? sideAt(a, l, to, s.to, false)
  return p && q ? sCurve(p, q) : undefined
}
