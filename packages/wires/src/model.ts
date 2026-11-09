// The view model, as pure functions: from a registry snapshot, the dock's panel geometry and the catalog, the
// prototype's chassis, jacks (ports), rack modules and blocks, wires and routes.
import { Ops, type Op, type Snapshot } from '@composable/core'
import { BLOCK_DY, BLOCK_H, BLOCK_JACK_DY, JACK_W, MOD_H, PALETTE, ROW_STEP, ROW_Y } from './constants'

/** A rectangle in the dock's (front) coordinates. */
export type Rect = { x: number; y: number; w: number; h: number }
/** One dock panel: the instance its element shows (null for none, like Notes), where it is, and how to name it. */
export type Panel = { instance: string | null; rect: Rect; tag: string }
/** A jack. `kind` is where it sits: a panel's back (chassis), a rack module, or a rack block. */
export type Port = { key: string; owner: string; op: Op; x: number; y: number; dir: 'in' | 'out'; label: string; kind: 'chassis' | 'module' | 'block' }
/** A panel's back, mirrored into back-face coordinates. */
export type Chassis = { id: string; instance: string | null; label: string; tag: string; x: number; y: number; w: number; h: number }
/** A component in the rack: an operator module, or (with no out jack) a store block. */
export type RackItem = { id: string; title: string; sub: string; kind?: string; block: boolean; x: number; y: number; w: number; h: number }
/** A subscription drawn as a cord from an out jack to an in jack. */
export type Wire = { id: string; route: string; from: string; to: string }
/** A connected group of components, with its generated name and colour. */
export type Route = { id: string; name: string; color: string }
/** Everything the stage draws. */
export type Model = { W: number; H: number; chassis: Chassis[]; rack: RackItem[]; P: Record<string, Port>; wires: Wire[]; routes: Route[]; rackH: number }

/** What the model is made from. `kinds` maps an instance to its catalog kind; `titles` maps a kind to its title. */
export type ModelInput = {
  snapshot: Snapshot; panels: Panel[]; W: number; H: number; platform: string
  kinds?: Record<string, string>; titles?: Record<string, string>
}

/** A jack's key: the instance and the op's key. */
export const portKey = (instance: string, op: string) => instance + ' ' + op
/** An op with an input is an in jack; one with an output and no input is an out jack; the rest get none. */
export const dirOf = (op: Op): 'in' | 'out' | null => (op.input ? 'in' : op.output ? 'out' : null)
const jacksOf = (ops: Op[]) => [...ops.filter(o => dirOf(o) === 'in'), ...ops.filter(o => dirOf(o) === 'out')]
/** Instances that are never shown: the registry itself, element views, and the platform. */
export const hidden = (id: string, platform: string) => id === 'registry' || id.includes('~view') || id === platform

/** Builds the model. Panels are given in front coordinates; the back face mirrors x. */
export function buildModel({ snapshot, panels, W, H, platform, kinds = {}, titles = {} }: ModelInput): Model {
  const opsOf = new Map(snapshot.instances.map(i => [i.id, i.ops]))
  const P: Record<string, Port> = {}
  const chassis: Chassis[] = []
  const placed = new Set<string>()
  panels.forEach((p, n) => {
    const instance = p.instance !== null && opsOf.has(p.instance) && !placed.has(p.instance) ? p.instance : null
    const c = { id: 'panel-' + n, instance, label: p.instance ?? p.tag, tag: '<' + p.tag + '>', x: W - p.rect.x - p.rect.w, y: p.rect.y, w: p.rect.w, h: p.rect.h }
    chassis.push(c)
    if (instance === null) return
    placed.add(instance)
    // out jacks along the top of the back, in jacks along the bottom
    for (const dir of ['out', 'in'] as const) {
      const row = jacksOf(opsOf.get(instance)!).filter(o => dirOf(o) === dir)
      row.forEach((op, i) => {
        const key = portKey(instance, Ops.key(op))
        P[key] = { key, owner: instance, op, x: Math.round(c.x + (i + 0.5) * c.w / row.length), y: dir === 'out' ? c.y + 56 : c.y + c.h - 40, dir, label: op.name, kind: 'chassis' }
      })
    }
  })

  const rack: RackItem[] = []
  let x = 20, row = 0
  for (const inst of snapshot.instances) {
    if (placed.has(inst.id) || hidden(inst.id, platform)) continue
    const jacks = jacksOf(inst.ops)
    const block = !jacks.some(o => dirOf(o) === 'out')
    const kind = kinds[inst.id]
    const sub = kind ? (titles[kind] ?? kind) : (inst.ops[0]?.ns ?? '')
    const w = Math.max(110, jacks.length * JACK_W, Math.ceil(inst.id.length * 7.4 + 24))
    if (x + w > W && x > 20) { x = 20; row += 1 }
    const y = H + ROW_Y + row * ROW_STEP
    const m: RackItem = { id: inst.id, title: inst.id, sub, kind, block, x, y: block ? y + BLOCK_DY : y, w, h: block ? BLOCK_H : MOD_H }
    rack.push(m)
    jacks.forEach((op, i) => {
      const key = portKey(inst.id, Ops.key(op))
      P[key] = { key, owner: inst.id, op, x: Math.round(m.x + (i + 0.5) * m.w / jacks.length), y: block ? y + BLOCK_JACK_DY : y + 22, dir: dirOf(op)!, label: op.name, kind: block ? 'block' : 'module' }
    })
    x += w + 15
  }

  const subs = snapshot.subscriptions.filter(s => !s.listener.includes('~view') && P[portKey(s.source, s.op)] && P[portKey(s.listener, s.target)])
  const { routeOf, routes } = routesOf(subs, chassis)
  const wires = subs.map(s => ({ id: s.id, route: routeOf.get(s.id)!, from: portKey(s.source, s.op), to: portKey(s.listener, s.target) }))
  return { W, H, chassis, rack, P, wires, routes, rackH: 128 + row * 132 }
}

/** Routes: the weakly connected groups of components, named `<first source> → <last sink>`, coloured in order. */
function routesOf(subs: { id: string; source: string; listener: string }[], chassis: Chassis[]) {
  const parent = new Map<string, string>()
  const find = (a: string): string => { const p = parent.get(a) ?? a; if (p === a) return a; const r = find(p); parent.set(a, r); return r }
  for (const s of subs) parent.set(find(s.source), find(s.listener))
  const groups = new Map<string, typeof subs>()
  for (const s of subs) { const g = find(s.source); groups.set(g, [...(groups.get(g) ?? []), s]) }
  const label = (id: string) => chassis.find(c => c.instance === id)?.label ?? id
  const routeOf = new Map<string, string>()
  const routes = [...groups.values()].map((g, i) => {
    const r = { id: g[0]!.id, name: label(g[0]!.source) + ' → ' + label(g[g.length - 1]!.listener), color: PALETTE[i % PALETTE.length]! }
    for (const s of g) routeOf.set(s.id, r.id)
    return r
  })
  return { routeOf, routes }
}

/** A label for an owner: its panel's label or its rack title. */
export const ownerLabel = (m: Model, id: string) => m.chassis.find(c => c.instance === id)?.label ?? m.rack.find(r => r.id === id)?.title ?? id
/** `owner.op` for a jack. */
export const portName = (m: Model, key: string) => ownerLabel(m, m.P[key]!.owner) + '.' + m.P[key]!.label

/** The prototype's checkConnect, over the system's rules: out into in, and the output must fit the input. */
export function checkConnect(m: Model, aKey: string, bKey: string): { error: string } | { from: string; to: string } {
  if (aKey === bKey) return { error: 'Drop the cord on a different jack' }
  const a = m.P[aKey]!, b = m.P[bKey]!
  if (a.owner === b.owner) return { error: ownerLabel(m, a.owner) + " can't patch into itself" }
  if (a.dir === b.dir) return { error: a.dir === 'out' ? 'Both jacks emit events — patch an output into an input' : 'Both jacks are inputs — patch an output into an input' }
  const [from, to] = a.dir === 'out' ? [aKey, bKey] : [bKey, aKey]
  if (m.wires.some(w => w.from === from && w.to === to)) return { error: 'Those jacks are already connected' }
  if (!Ops.fits(m.P[from]!.op, m.P[to]!.op)) return { error: portName(m, from) + " doesn't fit " + portName(m, to) }
  return { from, to }
}
