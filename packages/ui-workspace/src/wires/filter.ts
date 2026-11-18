// What a view shows of the model: Show Connected (only jacks a cord touches, only modules with one) or All, narrowed by
// pills. Selected pills narrow; none selected in a group means all of it. Pure; shared by the views that draw jacks.
import { buildModel, type Model } from './model'
import type { Wires } from './wires'

/** The selected pills: runtimes and pods (the Pipes / Call edges boxes pick the kinds of cord). */
export type Pills = { runtimes: string[]; pods: string[] }
export type ViewSettings = { show: 'connected' | 'all'; pills: Pills }

const pick = <A>(sel: A[], a: A) => sel.length === 0 || sel.includes(a)
/** Adds or removes a pill. */
export const toggle = <A>(sel: A[], a: A) => sel.includes(a) ? sel.filter(x => x !== a) : [...sel, a]

export function viewOf(m: Model, { show, pills }: ViewSettings): Model {
  const touches = (from: string, to: string) => pills.pods.length === 0 || pills.pods.includes(from) || pills.pods.includes(to)
  const owner = (k: string) => m.P[k]!.owner
  const wires = m.wires.filter(w => pick(pills.runtimes, w.runtime) && touches(owner(w.from), owner(w.to)))
  const calls = m.calls.filter(c => pick(pills.runtimes, c.runtime) && touches(c.from, c.to))
  const corded = new Set([...wires.flatMap(w => [w.from, w.to]), ...calls.flatMap(c => c.jacks)])
  const ends = new Set([...wires.flatMap(w => [owner(w.from), owner(w.to)]), ...calls.flatMap(c => [c.from, c.to])])
  const inRuntime = (id: string) => pills.runtimes.length === 0 || (m.runtimes[id] ?? []).some(r => pills.runtimes.includes(r))
  const rack = m.rack.filter(r => ends.has(r.id) || (show === 'all' && pick(pills.pods, r.id) && inRuntime(r.id)))
  const shown = new Set([...m.chassis.flatMap(c => c.instance ?? []), ...rack.map(r => r.id)])
  const P = Object.fromEntries(Object.entries(m.P).filter(([k, p]) => show === 'all' ? shown.has(p.owner) : corded.has(k)))
  return { ...m, wires, calls, rack, P }
}

/** What the stage shows: while editing, everything (to patch any jack); else the viewer's settings over the cords their
 * Pipes / Call edges boxes leave. */
export function onStage(el: Wires): Model {
  const { s } = el, kinds = (m: Model) => ({ ...m, wires: s.showPipes ? m.wires : [], calls: s.showCalls ? m.calls : [] })
  if (s.editing) return el.model
  const v = viewOf(kinds(el.model), s), input = el.input
  if (s.show === 'all' || !input) return v
  // Connected: lay the rack out again with only what it shows, so it packs tight
  const key = JSON.stringify([s.pills, s.showPipes, s.showCalls]), hit = packed.get(el.model)
  if (hit?.key === key) return hit.m
  const m = viewOf(kinds(buildModel({ ...input, only: v })), s)
  packed.set(el.model, { key, m })
  return m
}
const packed = new WeakMap<Model, { key: string; m: Model }>()
