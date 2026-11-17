// The Circuit, as pure functions of the Application's systems, screens, placements and kinds.
import { Ops, type Op, type Snapshot } from '@pritzlaff/nano-core'
import { isInfrastructure, viewIds, type Box, type Kind, type Placement, type Screen } from '@pritzlaff/nano-app'
import { padTypeOf, type Cable, type CableEnd, type Circuit, type Footprint, type Pad } from './types'

const padOf = (system: string, instance: string, op: Op): Pad | null => {
  const key = `${system}/${instance} ${Ops.key(op)}`, base = { key, instance, op: Ops.key(op), label: op.name, ...(op.description !== undefined && { description: op.description }) }
  if (op.input) return { ...base, dir: 'in', kind: op.output ? 'call' : 'event', type: padTypeOf(op.input), schema: op.input }
  if (op.output) return { ...base, dir: 'out', kind: 'event', type: padTypeOf(op.output), schema: op.output }
  return null
}

/** The page's unboxed placements get an equal grid, ceil(sqrt(n)) columns wide. */
const gridBoxes = (n: number): Box[] => {
  const cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols)
  return Array.from({ length: n }, (_, i) => ({ x: (i % cols) / cols, y: Math.floor(i / cols) / rows, w: 1 / cols, h: 1 / rows }))
}

export function buildCircuit({ systems, screens, placements, kinds }: { systems: Snapshot[]; screens: Screen[]; placements: Placement[]; kinds: Kind[] }): Circuit {
  const titleOf = new Map(kinds.map(k => [k.component, k.title])), kindOf = new Map(kinds.map(k => [k.component, k.kind]))
  const snap = new Map(systems.map(s => [s.id, s]))
  const lookup = (system: string, instance: string) => snap.get(system)?.instances.find(i => i.id === instance)
  const padsOf = (system: string, instance: string) => (lookup(system, instance)?.ops ?? []).flatMap(o => padOf(system, instance, o) ?? [])
  const describe = (system: string, instance: string) => { const c = lookup(system, instance)?.component; return { ...(c !== undefined && kindOf.has(c) && { kind: kindOf.get(c)! }), title: (c !== undefined && titleOf.get(c)) || instance, pads: padsOf(system, instance) } }

  const screenOf = new Map(screens.map(s => [s.id, s]))
  const views = new Map(systems.map(s => [s.id, viewIds(s)]))
  // infrastructure is never drawn as a user's component, even when a panel shows it
  placements = placements.filter(p => { const sc = screenOf.get(p.screen); return !sc || !isInfrastructure(p.instance, views.get(sc.system) ?? new Set()) })
  const pages = new Map<string, Set<string>>()
  for (const p of placements) { const sc = screenOf.get(p.screen); if (sc) { const k = `${sc.system}/${p.instance}`; pages.set(k, (pages.get(k) ?? new Set()).add(p.screen)) } }

  const layers = screens.map(sc => {
    const mine = placements.filter(p => p.screen === sc.id)
    const grid = gridBoxes(mine.filter(p => !p.box).length)
    let g = 0
    const footprints: Footprint[] = mine.map(p => ({
      system: sc.system, instance: p.instance, ...describe(sc.system, p.instance), box: p.box ?? grid[g++]!,
      ...(p.tab && { tab: p.tab }), shared: (pages.get(`${sc.system}/${p.instance}`)?.size ?? 0) > 1,
    }))
    return { screen: sc.id, title: sc.title, ...(sc.icon !== undefined && { icon: sc.icon }), system: sc.system, footprints }
  })

  const placed = new Set(pages.keys())
  const side = systems.flatMap(s => {
    const views = viewIds(s)
    const items = s.instances.filter(i => !placed.has(`${s.id}/${i.id}`) && !isInfrastructure(i.id, views)).map(i => ({ system: s.id, instance: i.id, ...describe(s.id, i.id) }))
    return items.length ? [{ system: s.id, items }] : []
  })

  const endAt = (system: string, instance: string): CableEnd['at'] => {
    const layer = layers.find(l => l.footprints.some(f => f.system === system && f.instance === instance))
    return layer ? { layer: layer.screen } : { side: system }
  }
  const cables: Cable[] = systems.flatMap(s => {
    const views = viewIds(s)
    return s.subscriptions.flatMap(sub => {
      if (isInfrastructure(sub.source, views) || isInfrastructure(sub.listener, views)) return []
      const from = padsOf(s.id, sub.source).find(p => p.op === sub.op), to = padsOf(s.id, sub.listener).find(p => p.op === sub.target)
      if (!from || !to) return []
      return [{ id: sub.id, system: s.id, from: { pad: from.key, at: endAt(s.id, sub.source) }, to: { pad: to.key, at: endAt(s.id, sub.listener) }, type: from.type }]
    })
  })
  return { layers, side, cables }
}
