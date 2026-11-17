// The Circuit, as pure functions of the app's deployment (runtimes are the systems, pods the instances, pipes the
// cables), the registry (an implementation's ops are the pads), and the pages with the pods their docks show.
import type { AppDeployment, Registry } from '@pritzlaff/nano-core'
import { jacksOfImpl, wireId, type Jack } from '../wires/model'
import { padTypeOf, type Box, type Cable, type CableEnd, type Circuit, type Footprint, type Pad } from './types'

/** A page (the old Application's screen): a route and its title. */
export type Screen = { id: string; title: string; icon?: string }
/** A pod a page's dock shows, where (fractions of the dock), and its tab group if stacked. */
export type Placement = { screen: string; instance: string; box?: Box; tab?: { group: string; active: boolean } }

// An action is an in pad (a call if it answers) and, for its result, an out pad; an event is an out pad.
const padOf = (system: string, instance: string, j: Jack): Pad => {
  const { op } = j, def = j.dir === 'in' ? op.input : op.output, key = `${system}/${instance} ${j.port}:${j.dir}`
  return { key, instance, op: `${j.port}:${j.dir}`, label: op.name, ...(op.description !== undefined && { description: op.description }),
    dir: j.dir, kind: op.kind === 'action' && op.output ? 'call' : 'event', type: padTypeOf(def?.schema), ...(def && { schema: def.schema }) }
}

/** The page's unboxed placements get an equal grid, ceil(sqrt(n)) columns wide. */
const gridBoxes = (n: number): Box[] => {
  const cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols)
  return Array.from({ length: n }, (_, i) => ({ x: (i % cols) / cols, y: Math.floor(i / cols) / rows, w: 1 / cols, h: 1 / rows }))
}

type Item = { type: string; size?: number; content?: readonly Item[]; activeItemIndex?: number; componentState?: unknown }
/** The pods a dock's golden-layout tree shows on `screen`, boxed by its rows, columns and sizes; a stack is a tab group. */
export function dockPlacements(screen: string, root: Item | null | undefined): Placement[] {
  const out: Placement[] = []
  let groups = 0
  const walk = (it: Item, b: Box, tab?: { group: string; active: boolean }) => {
    const kids = it.content ?? []
    if (it.type === 'component') {
      const name = (it.componentState as { name?: unknown } | undefined)?.name
      if (typeof name === 'string') out.push({ screen, instance: name, box: b, ...(tab && { tab }) })
    } else if (it.type === 'stack') {
      const g = `g${groups++}`
      kids.forEach((k, i) => walk(k, b, kids.length > 1 ? { group: g, active: i === (it.activeItemIndex ?? 0) } : undefined))
    } else {
      const total = kids.reduce((n, k) => n + (k.size ?? 1), 0) || 1, across = it.type === 'row'
      let at = 0
      for (const k of kids) {
        const f = (k.size ?? 1) / total
        walk(k, across ? { ...b, x: b.x + at * b.w, w: f * b.w } : { ...b, y: b.y + at * b.h, h: f * b.h })
        at += f
      }
    }
  }
  if (root) walk(root, { x: 0, y: 0, w: 1, h: 1 })
  return out
}

export function buildCircuit({ deployment: d, registry, screens, placements, application = 'ui' }: { deployment: AppDeployment; registry: Registry; screens: Screen[]; placements: Placement[]; application?: string }): Circuit {
  const systems = Object.entries(d.runtimes).map(([id, r]) => ({ id, pods: r.pods.filter(p => p !== application && d.pods[p]), subscriptions: r.subscriptions }))
  const systemOf = new Map(systems.flatMap(s => s.pods.map(p => [p, s.id] as const)))
  const padsOf = (system: string, instance: string) => jacksOfImpl(registry.implementation(d.pods[instance]?.implementation ?? '')).map(j => padOf(system, instance, j))
  const describe = (system: string, instance: string) => { const c = d.pods[instance]?.implementation; return { ...(c !== undefined && { kind: c }), title: c?.slice(c.indexOf('/') + 1) || instance, pads: padsOf(system, instance) } }

  const screenOf = new Map(screens.map(s => [s.id, s]))
  // only pods of the app (never the host's own) on a known page
  placements = placements.filter(p => screenOf.has(p.screen) && systemOf.has(p.instance))
  const pages = new Map<string, Set<string>>()
  for (const p of placements) pages.set(p.instance, (pages.get(p.instance) ?? new Set()).add(p.screen))

  const layers = screens.map(sc => {
    const mine = placements.filter(p => p.screen === sc.id)
    const grid = gridBoxes(mine.filter(p => !p.box).length)
    let g = 0
    const footprints: Footprint[] = mine.map(p => ({
      system: systemOf.get(p.instance)!, instance: p.instance, ...describe(systemOf.get(p.instance)!, p.instance), box: p.box ?? grid[g++]!,
      ...(p.tab && { tab: p.tab }), shared: (pages.get(p.instance)?.size ?? 0) > 1,
    }))
    return { screen: sc.id, title: sc.title, ...(sc.icon !== undefined && { icon: sc.icon }), system: systemOf.get(mine[0]?.instance ?? '') ?? 'main', footprints }
  })

  const side = systems.flatMap(s => {
    const items = s.pods.filter(p => !pages.has(p)).map(p => ({ system: s.id, instance: p, ...describe(s.id, p) }))
    return items.length ? [{ system: s.id, items }] : []
  })

  const endAt = (system: string, instance: string): CableEnd['at'] => {
    const layer = layers.find(l => l.footprints.some(f => f.system === system && f.instance === instance))
    return layer ? { layer: layer.screen } : { side: system }
  }
  // BACKLOG(6): call edges have no pad, so (as on c-wires) only pipes are drawn.
  const cables: Cable[] = systems.flatMap(s => s.subscriptions.flatMap(sub => {
    if (sub.kind !== 'pipe' || !systemOf.has(sub.from) || !systemOf.has(sub.to)) return []
    const from = padsOf(s.id, sub.from).find(p => p.op === sub.source + ':out'), to = padsOf(s.id, sub.to).find(p => p.op === sub.target + ':in')
    if (!from || !to) return []
    return [{ id: wireId(s.id, sub), system: s.id, from: { pad: from.key, at: endAt(s.id, sub.from) }, to: { pad: to.key, at: endAt(s.id, sub.to) }, type: from.type }]
  }))
  return { layers, side, cables }
}
