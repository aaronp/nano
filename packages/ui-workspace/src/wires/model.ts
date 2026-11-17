// The view model, as pure functions: from a snapshot of the app's deployment, the dock's panel geometry and the
// catalog, the prototype's chassis, jacks (ports), rack modules and blocks, wires and routes.
import { fits, type AppDeployment, type Implementation, type Op, type Registry } from '@pritzlaff/nano-core'
import { BLOCK_DY, BLOCK_H, BLOCK_JACK_DY, JACK_W, MOD_H, PALETTE, ROW_STEP, ROW_Y } from './constants'

/** A rectangle in the dock's (front) coordinates. */
export type Rect = { x: number; y: number; w: number; h: number }
/** One dock panel: the instance its element shows (null for none, like Notes), where it is, and how to name it. */
export type Panel = { instance: string | null; rect: Rect; tag: string }
/** A jack. `kind` is where it sits: a panel's back (chassis), a rack module, or a rack block. */
export type Port = { key: string; owner: string; op: Op; port: string; x: number; y: number; dir: 'in' | 'out'; label: string; kind: 'chassis' | 'module' | 'block' }
/** A panel's back, mirrored into back-face coordinates. */
export type Chassis = { id: string; instance: string | null; deploy?: string; label: string; tag: string; x: number; y: number; w: number; h: number }
/** A component in the rack: an operator module, or (with no out jack) a store block. */
export type RackItem = { id: string; title: string; sub: string; kind?: string; deploy: string; block: boolean; x: number; y: number; w: number; h: number }
/** A subscription drawn as a cord from an out jack to an in jack. */
export type Wire = { id: string; route: string; from: string; to: string }
/** A connected group of components, with its generated name and colour. */
export type Route = { id: string; name: string; color: string }
/** A call edge, drawn from the caller's box to the callee's (a pod as a whole: it has no Op of its own to plug into). */
export type Call = { id: string; from: string; to: string; a: { x: number; y: number }; b: { x: number; y: number }[] }
/** Everything the stage draws. */
export type Model = { W: number; H: number; chassis: Chassis[]; rack: RackItem[]; P: Record<string, Port>; wires: Wire[]; routes: Route[]; rackH: number; calls: Call[] }

/** What the model is made from. `kinds` maps an instance to its catalog kind; `titles` maps a kind to its title. */
export type ModelInput = {
  snapshot: Snapshot; panels: Panel[]; W: number; H: number; application: string
  kinds?: Record<string, string>; titles?: Record<string, string>
}

/** A jack of an implementation: an op at its port (`<interface>/<op>`), as an input or an output (nano-ui's pads). */
export type Jack = { op: Op; port: string; dir: 'in' | 'out' }
/** The pods (instances) and pipes (subscriptions) of a deployment, flattened over its runtimes. */
export type Snapshot = {
  instances: { id: string; ops: Jack[]; labels?: Record<string, string> }[]
  subscriptions: { id: string; source: string; op: string; listener: string; target: string }[]
  /** The call edges, by runtime: `from` may call `to`, at `ops` (its jacks for the interface `from` needs: each
   * action's in jack, each event's out jack, as `<port>:<dir>`). */
  calls?: { id: string; from: string; to: string; ops: string[] }[]
}
/** An action is an in jack and, for its result, an out jack; an event is an out jack (as nano-ui's wiring reads them). */
export const jacksOfImpl = (impl: Implementation | undefined): Jack[] => (impl?.provides ?? []).flatMap(i => Object.values(i.ops).flatMap(op => {
  const port = `${i.coord}/${op.name}`
  return op.kind === 'action' ? [{ op, port, dir: 'in' as const }, { op, port, dir: 'out' as const }] : [{ op, port, dir: 'out' as const }]
}))
/** A pipe's wire id, as nano-ui's cable id: `runtime|from|to|target|source`. */
export const wireId = (runtime: string, s: { from: string; source: string; to: string; target: string }) => `${runtime}|${s.from}|${s.to}|${s.target}|${s.source}`
/** The snapshot of a deployment: each pod with its implementation's jacks and its isolation as `nano/deploy`, each pipe. */
export function snapshotOf(d: AppDeployment, registry: Registry): Snapshot {
  const instances = Object.entries(d.pods).map(([id, p]) => ({ id, ops: jacksOfImpl(registry.implementation(p.implementation)), labels: { 'nano/deploy': p.isolation ?? 'host' } }))
  const calls = Object.entries(d.runtimes).flatMap(([rt, r]) => r.subscriptions.flatMap(s => s.kind === 'call'
    ? [{ id: `${rt}|${s.from}|${s.to}`, from: s.from, to: s.to, ops: calledOps(d, registry, s.from, s.to) }] : []))
  const subscriptions = Object.entries(d.runtimes).flatMap(([rt, r]) => r.subscriptions.flatMap(s => s.kind === 'pipe'
    ? [{ id: wireId(rt, s), source: s.from, op: s.source + ':out', listener: s.to, target: s.target + ':in' }] : []))
  return { instances, subscriptions, calls }
}

/** The jacks of `to` that `from` may call: the ops of the interfaces its dependencies name that `to` provides (all of
 * `to`'s when none names one). */
function calledOps(d: AppDeployment, registry: Registry, from: string, to: string): string[] {
  const provides = registry.implementation(d.pods[to]?.implementation ?? '')?.provides ?? []
  const named = new Set(Object.values(registry.implementation(d.pods[from]?.implementation ?? '')?.dependencies ?? {}).flatMap(s => s.implements ?? []))
  const used = provides.some(i => named.has(i.coord)) ? provides.filter(i => named.has(i.coord)) : provides
  return used.flatMap(i => Object.values(i.ops).map(op => `${i.coord}/${op.name}:${op.kind === 'action' ? 'in' : 'out'}`))
}

/** A jack's key: the instance, and the port with its direction. */
export const portKey = (instance: string, op: string) => instance + ' ' + op
const jackKey = (instance: string, j: Jack) => portKey(instance, j.port + ':' + j.dir)
export const dirOf = (j: Jack): 'in' | 'out' => j.dir
const jacksOf = (ops: Jack[]) => [...ops.filter(o => o.dir === 'in'), ...ops.filter(o => o.dir === 'out')]
/** Instances that are never shown: the host's own pod. */
export const hidden = (id: string, application: string) => id === application

/** Builds the model. Panels are given in front coordinates; the back face mirrors x. */
export function buildModel({ snapshot, panels, W, H, application, kinds = {}, titles = {} }: ModelInput): Model {
  const opsOf = new Map(snapshot.instances.map(i => [i.id, i.ops])), deployOf = new Map(snapshot.instances.map(i => [i.id, i.labels?.['nano/deploy'] ?? 'host']))
  const P: Record<string, Port> = {}
  const chassis: Chassis[] = []
  const placed = new Set<string>()
  panels.forEach((p, n) => {
    const instance = p.instance !== null && opsOf.has(p.instance) && !placed.has(p.instance) ? p.instance : null
    const c = { id: 'panel-' + n, instance, ...(instance !== null && { deploy: deployOf.get(instance) }), label: p.instance ?? p.tag, tag: '<' + p.tag + '>', x: W - p.rect.x - p.rect.w, y: p.rect.y, w: p.rect.w, h: p.rect.h }
    chassis.push(c)
    if (instance === null) return
    placed.add(instance)
    // out jacks along the top of the back, in jacks along the bottom
    for (const dir of ['out', 'in'] as const) {
      const row = jacksOf(opsOf.get(instance)!).filter(o => dirOf(o) === dir)
      row.forEach((op, i) => {
        const key = jackKey(instance, op)
        P[key] = { key, owner: instance, op: op.op, port: op.port, x: Math.round(c.x + (i + 0.5) * c.w / row.length), y: dir === 'out' ? c.y + 56 : c.y + c.h - 40, dir, label: op.op.name, kind: 'chassis' }
      })
    }
  })

  const rack: RackItem[] = []
  let x = 20, row = 0
  for (const inst of snapshot.instances) {
    if (placed.has(inst.id) || hidden(inst.id, application)) continue
    const jacks = jacksOf(inst.ops)
    const block = !jacks.some(o => dirOf(o) === 'out')
    const kind = kinds[inst.id]
    const sub = kind ? (titles[kind] ?? kind) : (inst.ops[0]?.port.replace(/\.[^.]*$/, '') ?? '')
    const w = Math.max(110, jacks.length * JACK_W, Math.ceil(inst.id.length * 7.4 + 24))
    if (x + w > W && x > 20) { x = 20; row += 1 }
    const y = H + ROW_Y + row * ROW_STEP
    const m: RackItem = { id: inst.id, title: inst.id, sub, kind, deploy: inst.labels?.['nano/deploy'] ?? 'host', block, x, y: block ? y + BLOCK_DY : y, w, h: block ? BLOCK_H : MOD_H }
    rack.push(m)
    jacks.forEach((op, i) => {
      const key = jackKey(inst.id, op)
      P[key] = { key, owner: inst.id, op: op.op, port: op.port, x: Math.round(m.x + (i + 0.5) * m.w / jacks.length), y: block ? y + BLOCK_JACK_DY : y + 22, dir: op.dir, label: op.op.name, kind: block ? 'block' : 'module' }
    })
    x += w + 15
  }

  const subs = snapshot.subscriptions.filter(s => P[portKey(s.source, s.op)] && P[portKey(s.listener, s.target)])
  const { routeOf, routes } = routesOf(subs, chassis)
  const wires = subs.map(s => ({ id: s.id, route: routeOf.get(s.id)!, from: portKey(s.source, s.op), to: portKey(s.listener, s.target) }))
  // a call edge leaves the bottom of the caller's box and enters the top of the callee's
  const box = (id: string) => chassis.find(c => c.instance === id) ?? rack.find(r => r.id === id)
  const calls = (snapshot.calls ?? []).flatMap(c => {
    const f = box(c.from), t = box(c.to)
    if (!f || !t) return []
    const ends = (c.ops ?? []).flatMap(o => P[portKey(c.to, o)] ?? [])   // the callee's jacks, else the top of its box
    return [{ id: c.id, from: c.from, to: c.to, a: { x: Math.round(f.x + f.w / 2), y: f.y + f.h }, b: ends.length ? ends.map(j => ({ x: j.x, y: j.y })) : [{ x: Math.round(t.x + t.w / 2), y: t.y }] }]
  })
  return { W, H, chassis, rack, P, wires, routes, rackH: 128 + row * 132, calls }
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
  if (!fits(m.P[from]!.op, m.P[to]!.op)) return { error: portName(m, from) + " doesn't fit " + portName(m, to) }
  return { from, to }
}
