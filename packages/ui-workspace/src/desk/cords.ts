// The Desk's cords, measured from the layout (the boxes and each jack's row), not the DOM: pipes solid in their route's
// colour, calls dashed (opCord).
import { svg } from 'lit'
import { OK_COLOR } from '../wires/constants'
import { opCord } from '../wires/calls'
import { cordD, cordGeo } from '../wires/geometry'
import { COL_HEAD, rowH, type DeskLayout, type Sized } from './arrange'
import type { DeskModel } from './model'

type XY = { x: number; y: number }
type Arranged = { runtimes: Record<string, Sized>; columns: Record<string, Record<string, Sized>> }

/** A jack's centre in the runtime it is drawn in (jack keys are per pod, so the runtime picks the column). */
export function jackAt(m: DeskModel, a: Arranged, l: DeskLayout, runtime: string, key: string): XY | undefined {
  const c = m.runtimes.find(r => r.id === runtime)?.columns.find(c => c.pod === key.slice(0, key.indexOf(' ')))
  const box = c && a.columns[runtime]?.[c.pod], rt = a.runtimes[runtime]
  if (!c || !box || !rt) return
  const out = key.endsWith(':out'), i = (out ? c.outs : c.ins).indexOf(key)
  if (i < 0) return
  return { x: rt.x + box.x + (out ? box.w - 8 : 8), y: rt.y + box.y + COL_HEAD + i * rowH(l.compact) + rowH(l.compact) / 2 }
}

export function renderCords(m: DeskModel, a: Arranged, l: DeskLayout) {
  const at = (rt: string, k: string) => jackAt(m, a, l, rt, k)
  const colour = (route: string) => m.wires.routes.find(r => r.id === route)?.color ?? OK_COLOR
  const pipes = m.pipes.flatMap(w => {
    const p = at(w.runtime, w.from), q = at(w.runtime, w.to)
    return p && q ? [svg`<path data-pipe=${w.id} d=${cordD(cordGeo(p, q))} fill="none" stroke=${colour(w.route)} stroke-width="3" stroke-linecap="round"></path>`] : []
  })
  const calls = m.calls.flatMap(c => c.pairs.flatMap(o => {
    const p = o.source === null ? undefined : at(c.runtime, `${o.from} ${o.source}:out`), q = at(c.runtime, `${o.to} ${o.target}:in`)
    return p && q ? [opCord({ a: p, b: q, declared: o.declared, seen: o.seen })] : []
  }))
  return [...pipes, ...calls]
}
