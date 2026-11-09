// Systems as a component: it holds the registries (host first), creates components from a catalog, adds them to
// systems, connects their actions, and publishes every change in any system.
import { Type } from 'typebox'
import { Components, Ops, Registries, Runtimes, type Component, type Environment, type Registry, type Runtime, type Snapshot } from '@pritzlaff/nano-core'

const NS = 'composable/platform', any = Type.Unknown(), str = Type.String()

/** What is selected in the platform: an instance in a system, and maybe one of its ops. */
export type Selection = { system: string; instance: string; op?: string } | null

/** The platform's ops. */
export const PlatformOps = {
  systems: Ops.source(NS, 'systems', Type.Array(any)),
  selected: Ops.source(NS, 'selected', any),
  catalog: Ops.source(NS, 'catalog', Type.Array(str)),
  selectionChanged: Ops.source(NS, 'selection-changed', any),
  stateChanged: Ops.source(NS, 'state-changed', any),
  createSystem: Ops.action(NS, 'create-system', str, any),
  createComponent: Ops.action(NS, 'create-component', Type.Object({ kind: str, name: str, system: str }), any),
  addToSystem: Ops.action(NS, 'add-to-system', Type.Object({ instance: str, from: str, to: str }), any),
  removeFromSystem: Ops.action(NS, 'remove-from-system', Type.Object({ instance: str, system: str }), any),
  connect: Ops.action(NS, 'connect', Type.Object({ system: str, source: str, op: str, listener: str, target: str }), any),
  disconnect: Ops.action(NS, 'disconnect', Type.Object({ system: str, id: str }), any),
  select: Ops.action(NS, 'select', any, any),
}
const P = PlatformOps

type State = { systems: Map<string, Runtime>; selected: Selection; env: Environment; watch(rt: Runtime): void; changed(id: string, delta: unknown): void }

const must = <A>(r: { value: A } | { error: string }): A => { if ('error' in r) throw new Error(r.error); return r.value }
const system = (s: State, id: string): Registry => {
  const rt = s.systems.get(id)
  if (!rt) throw new Error(`no system ${id}`)
  return rt.registry
}
const snapshots = (s: State): Snapshot[] => [...s.systems.values()].map(rt => rt.registry.snapshot())
const opOf = (reg: Registry, instance: string, key: string) => {
  const op = reg.get(instance)?.actions.get(key)?.op
  if (!op) throw new Error(`${instance} has no ${key} in ${reg.id}`)
  return op
}

/** The platform over `host`, able to create the kinds of component in `catalog` (a host's merged catalogs). */
export function platform(host: Runtime, catalog: Record<string, { component: Component }>): Component<State> {
  const c = Components.create<State>({ ns: 'composable', name: 'platform' }, env => {
    const s: State = {
      systems: new Map([[host.registry.id, host]]), selected: null, env, changed: () => {},
      watch: rt => { rt.registry.listen(delta => changed(rt.registry.id, delta)) },
    }
    // every change is told at once; the snapshots go out once per burst (adding an element makes several deltas)
    let pending = false
    const changed = (id: string, delta: unknown) => {
      void env.notify(P.stateChanged, { system: id, delta })
      if (!pending) { pending = true; queueMicrotask(() => { pending = false; void env.notify(P.systems, snapshots(s)) }) }
    }
    s.changed = changed
    s.watch(host)
    return s
  })
  c.action(P.systems, s => snapshots(s))
  c.action(P.selected, s => s.selected)
  c.action(P.catalog, () => Object.keys(catalog))
  c.action(P.selectionChanged); c.action(P.stateChanged)
  c.action(P.createSystem, (s, name) => {
    if (s.systems.has(name)) throw new Error(`${name} already exists`)
    const rt = Runtimes.create(Registries.create(name))
    s.systems.set(name, rt); s.watch(rt)
    s.changed(name, { type: 'system-created' })
  })
  c.action(P.createComponent, (s, { kind, name, system: id }) => {
    const def = catalog[kind]
    if (!def) throw new Error(`no component kind ${kind}`)
    must(system(s, id).add(name, Components.instantiate(def.component)))
  })
  c.action(P.addToSystem, (s, { instance, from, to }) => {
    const inst = system(s, from).get(instance)
    if (!inst) throw new Error(`no ${instance} in ${from}`)
    must(system(s, to).add(instance, inst))
  })
  c.action(P.removeFromSystem, (s, { instance, system: id }) => {
    const self = s.env.handles().find(h => h.coord.registry === id)?.coord.instance
    if (instance === 'registry' || instance === self) throw new Error(`${instance} can't be removed from ${id}`)
    const reg = system(s, id)
    // gone from the system means gone from its wiring too: core keeps a source's subscriptions, the platform doesn't
    for (const sub of reg.snapshot().subscriptions) if (sub.source === instance) reg.unsubscribe(sub.id)
    must(reg.remove(instance))
  })
  c.action(P.connect, (s, { system: id, source, op, listener, target }) => {
    const reg = system(s, id), from = opOf(reg, source, op), to = opOf(reg, listener, target)
    if (!Ops.fits(from, to)) throw new Error(`${source} · ${op} doesn't fit ${listener} · ${target}`)
    return must(reg.subscribe({ source, op, listener, target }))
  })
  c.action(P.disconnect, (s, { system: id, id: sub }) => { must(system(s, id).unsubscribe(sub)) })
  c.action(P.select, (s, sel) => {
    s.selected = (sel ?? null) as Selection
    void s.env.notify(P.selectionChanged, s.selected)
    void s.env.notify(P.selected, s.selected)
  })
  return c
}

/** A system's runtime, from the platform instance in `registry` (the platform owns the runtimes it creates). */
export function runtimeOf(registry: Registry, system: string, platformId = 'platform'): Runtime | undefined {
  return (registry.get(platformId)?.value as State | undefined)?.systems.get(system)
}
