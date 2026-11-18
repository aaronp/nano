// What the Desk shows, as a pure function of the deployment: runtimes of pod columns (their jacks), the pipes between
// them, the call edges, and each runtime's rank (callers left, callees right). Built over the wires model.
import { lookup, type AppDeployment, type Registry } from '@pritzlaff/nano-core'
import type { OpPair } from '../wires/calls'
import { viewOf, type ViewSettings } from '../wires/filter'
import { buildModel, snapshotOf, type Model, type Wire } from '../wires/model'

/** A pod's column in a runtime: the jack keys (`pod port:dir`) the view leaves, in op order. */
export type Column = { runtime: string; pod: string; implementation: string; ins: string[]; outs: string[] }
export type DeskModel = {
  runtimes: { id: string; columns: Column[] }[]
  pipes: Wire[]
  calls: { id: string; runtime: string; pairs: OpPair[]; jacks: string[] }[]
  rank: Record<string, number>
  /** The unfiltered wires model: what `checkConnect` runs against. */
  wires: Model
}

/** The longest path over runtime links: a call edge in runtime R from caller c links every runtime c is placed in to R. */
export function rankOf(d: AppDeployment): Record<string, number> {
  const { placedIn, callsFrom } = lookup(d)
  const into = new Map<string, Set<string>>()
  for (const [c, edges] of callsFrom) for (const { runtime } of edges) for (const x of placedIn.get(c) ?? [])
    if (x !== runtime) into.set(runtime, (into.get(runtime) ?? new Set()).add(x))
  const rank: Record<string, number> = {}
  const depth = (id: string): number => rank[id] ??= (rank[id] = 0, Math.max(0, ...[...into.get(id) ?? []].map(a => depth(a) + 1)))
  for (const id of Object.keys(d.runtimes)) depth(id)
  return rank
}

export function deskModel(d: AppDeployment, registry: Registry, opCalls: OpPair[], view: ViewSettings, application: string): DeskModel {
  const wires = buildModel({ snapshot: snapshotOf(d, registry, opCalls), panels: [], W: 0, H: 0, application })
  const v = viewOf(wires, view)
  const shown = new Set(v.rack.map(r => r.id))
  const jacks = (pod: string, dir: 'in' | 'out') => Object.values(v.P).filter(p => p.owner === pod && p.dir === dir).map(p => p.key)
  const runtimes = Object.entries(d.runtimes).map(([id, r]) => ({
    id,
    columns: r.pods.filter(pod => shown.has(pod)).map(pod => ({ runtime: id, pod, implementation: d.pods[pod]!.implementation, ins: jacks(pod, 'in'), outs: jacks(pod, 'out') })),
  })).filter(r => r.columns.length > 0)
  const calls = v.calls.map(c => ({ id: c.id, runtime: c.runtime, jacks: c.jacks, pairs: opCalls.filter(o => o.runtime === c.runtime && o.from === c.from && o.to === c.to) }))
  return { runtimes, pipes: v.wires, calls, rank: rankOf(d), wires }
}
