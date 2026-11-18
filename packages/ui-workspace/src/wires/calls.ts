// Call edges as cords: from the caller's op jack to the callee's when op-level pairs resolve to jacks, else (old edges,
// or pairs naming no jack here) the pod-level cord from the bottom of the caller's box to the callee's jacks or box.
import type { AppDeployment, Registry } from '@pritzlaff/nano-core'
import { svg } from 'lit'
import { CALL_COLOR } from './constants'
import { cordD, cordGeo } from './geometry'
import { portKey, type Chassis, type Port, type RackItem, type Snapshot } from './model'

/** A call edge, drawn from the caller's box to the callee's (a pod as a whole: it has no Op of its own to plug into). */
export type Call = { id: string; runtime: string; from: string; to: string; jacks: string[]; a: XY; b: XY[]; ops?: { a: XY; b: XY; declared: boolean; seen: boolean }[] }
type XY = { x: number; y: number }
/** An op-level call on an edge (observed-calls.ts's OpCall, structurally): `source` null when the caller's op is unknown. */
export type OpPair = { runtime: string; from: string; to: string; source: string | null; target: string; declared: boolean; seen: boolean }
type Box = Chassis | RackItem
type OpCord = NonNullable<Call['ops']>[number]

/** The jacks of `to` that `from` may call: the ops of the interfaces its dependencies name that `to` provides (all of
 * `to`'s when none names one). */
export function calledOps(d: AppDeployment, registry: Registry, from: string, to: string): string[] {
  const provides = registry.implementation(d.pods[to]?.implementation ?? '')?.provides ?? []
  const named = new Set(Object.values(registry.implementation(d.pods[from]?.implementation ?? '')?.dependencies ?? {}).flatMap(s => s.implements ?? []))
  const used = provides.some(i => named.has(i.coord)) ? provides.filter(i => named.has(i.coord)) : provides
  return used.flatMap(i => Object.values(i.ops).map(op => `${i.coord}/${op.name}:${op.kind === 'action' ? 'in' : 'out'}`))
}

export function callCords(calls: Snapshot['calls'] = [], box: (id: string) => Box | undefined, P: Record<string, Port>): Call[] {
  return calls.flatMap(c => {
    const f = box(c.from), t = box(c.to)
    if (!f || !t) return []
    // a call leaves the caller's op at its output jack and enters the callee's op at its input jack
    const out = (pod: string, op: string) => P[portKey(pod, op + ':out')], inn = (pod: string, op: string) => P[portKey(pod, op + ':in')]
    const touched: string[] = []
    const pairs = c.pairs ?? [], known = pairs.flatMap(p => { const a = p.source === null ? undefined : out(c.from, p.source), b = inn(c.to, p.target)
      if (!a || !b) return []
      touched.push(a.key, b.key)
      return [{ a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y }, declared: p.declared, seen: p.seen }] })
    // the callee's jacks called from an unknown op (once pairs are known)
    const unknown = pairs.filter(p => p.source === null).flatMap(p => inn(c.to, p.target) ?? [])
    const opLevel = known.length > 0 || unknown.length > 0
    // else every jack it may call, else the top of its box
    const ends = opLevel ? unknown : (c.ops ?? []).flatMap(o => P[portKey(c.to, o)] ?? [])
    const b = ends.length ? ends.map(j => ({ x: j.x, y: j.y })) : opLevel ? [] : [{ x: Math.round(t.x + t.w / 2), y: t.y }]
    return [{ id: c.id, runtime: c.runtime ?? '', from: c.from, to: c.to, jacks: [...new Set([...touched, ...ends.map(j => j.key)])], a: { x: Math.round(f.x + f.w / 2), y: f.y + f.h }, b, ...(opLevel && { ops: known }) }]
  })
}

/** One op-level call cord, dashed in the call colour: seen bright, declared but unseen dim, not declared amber with a visible label. */
export const opCord = (o: OpCord) => {
  const col = !o.declared ? '#F5A524' : CALL_COLOR
  return svg`<path data-op-call=${o.declared ? (o.seen ? 'seen' : 'declared') : 'not-declared'} d=${cordD(cordGeo(o.a, o.b))} fill="none" stroke=${col} stroke-opacity=${o.seen || !o.declared ? 1 : 0.5} stroke-width=${o.seen && o.declared ? 4 : 2.5} stroke-dasharray="10 6" stroke-linecap="round"></path>
    <circle cx=${o.a.x} cy=${o.a.y} r="5" fill=${col}></circle><circle cx=${o.b.x} cy=${o.b.y} r="5" fill=${col}></circle>
    ${o.declared ? '' : svg`<text data-not-declared x=${Math.round((o.a.x + o.b.x) / 2) + 6} y=${Math.round((o.a.y + o.b.y) / 2)} font-family="JetBrains Mono, monospace" font-size="16" fill=${col}>not declared</text>`}`
}
