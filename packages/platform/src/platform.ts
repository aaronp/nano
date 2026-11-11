// Systems as a component: it holds the registries (host first), creates components from a catalog, adds them to
// systems, connects their actions, and publishes every change in any system.
import { Type, type Static } from 'typebox'
import { Components, DeltaSchema, Ops, SnapshotSchema, SubscriptionSchema, Registries, Runtimes, type Component, type Environment, type Owner, type Registry, type Result, type Runtime, type Selectors, type Snapshot } from '@pritzlaff/nano-core'

const NS = 'composable/platform', none = Type.Void()
const str = (description: string, examples: string[]) => Type.String({ description, examples })
const systemId = str('A system (registry) id', ['host', 'lab']), instance = str('An instance id', ['ex-range'])
const ignored = Type.Unknown({ description: 'Ignored: any value triggers it' })

/** What is selected in the platform: an instance in a system, and maybe one of its ops; null when nothing is. */
export const SelectionSchema = Type.Union([
  Type.Object({ system: systemId, instance, op: Type.Optional(str('One of its ops, by key', ['composable.bundle/range/value'])) }),
  Type.Null(),
], { title: 'Selection', description: 'An instance in a system, and maybe one of its ops; null when nothing is selected',
  examples: [{ system: 'host', instance: 'ex-range' }, null] })
export type Selection = Static<typeof SelectionSchema>

/** A kind the platform can make: its catalog name, its component's id (`ns/name`), title and element tag. */
export const KindSchema = Type.Object({
  kind: str('Its catalog name', ['range']), component: str("Its component's id, ns/name", ['composable.bundle/range']),
  title: str('What to call it', ['Range']), tag: Type.Optional(str("Its element's tag, if it has one", ['c-range'])),
  description: Type.Optional(str('What it is for', ['A number between bounds'])),
  modes: Type.Optional(Type.Array(Type.String({ description: 'A deploy mode', examples: ['host'] }), { description: 'The modes it can be deployed in, the first is the default: host, sandbox, isolated-sandbox' })),
}, { title: 'Kind', description: 'A kind of component the platform can make' })
export type Kind = Static<typeof KindSchema>

/** The platform's ops. */
export const PlatformOps = {
  systems: Ops.source(NS, 'systems', Type.Array(SnapshotSchema, { description: 'A snapshot of each system, host first' }), { description: 'Every system, as it is now' }),
  selected: Ops.source(NS, 'selected', SelectionSchema, { description: 'What is selected now' }),
  catalog: Ops.source(NS, 'catalog', Type.Array(Type.String(), { description: 'Kind names', examples: [['range', 'log']] }), { description: 'The kinds it can make, by name' }),
  kinds: Ops.source(NS, 'kinds', Type.Array(KindSchema), { description: 'The kinds it can make, with their component ids, titles and tags' }),
  catalogChanged: Ops.action(NS, 'catalog-changed', ignored, none, { description: 'Tells it the catalog grew (after an import): republishes catalog and kinds' }),
  selectionChanged: Ops.source(NS, 'selection-changed', SelectionSchema, { description: 'The selection, whenever it changes' }),
  stateChanged: Ops.source(NS, 'state-changed', Type.Object({ system: systemId, delta: DeltaSchema }, { description: 'Which system changed, and how' }), { description: 'Every change in any system, as it happens' }),
  createSystem: Ops.action(NS, 'create-system', str('The new system id', ['lab']), none, { description: 'Makes a new, empty system with its own runtime' }),
  createComponent: Ops.action(NS, 'create-component', Type.Object({ kind: str('A catalog kind', ['range']), name: str('The new instance id', ['r1']), system: systemId,
    mode: Type.Optional(str("How to deploy it, one of the kind's modes (default: the kind's first mode)", ['isolated-sandbox'])),
    allow: Type.Optional(Type.Array(Type.String({ description: 'A selector, registry/target/op, * matches anything', examples: ['host/log/*'] }), { description: 'Outward calls it may make; guards it' })),
    deny: Type.Optional(Type.Array(Type.String({ description: 'A selector, registry/target/op, * matches anything', examples: ['host/platform/*'] }), { description: 'Outward calls it may not make; guards it' })) },
    { description: 'What to make, what to call it, where, and optionally how' }), none, { description: 'Makes an instance of a catalog kind in a system' }),
  addToSystem: Ops.action(NS, 'add-to-system', Type.Object({ instance, from: systemId, to: systemId }, { description: 'Which instance, from where, to where' }), none,
    { description: 'Adds the same instance to another system' }),
  removeFromSystem: Ops.action(NS, 'remove-from-system', Type.Object({ instance, system: systemId }, { description: 'Which instance, and from where' }), none,
    { description: 'Takes an instance out of a system, closing its subscriptions there' }),
  connect: Ops.action(NS, 'connect', Type.Object({ system: systemId, source: instance, op: str('The published op, by key', ['composable.bundle/range/value']),
    listener: instance, target: str("The listener's action, by key", ['composable.bundle/debounce/enqueue']) }, { description: 'From which op of which instance, to which action of which' }),
    SubscriptionSchema, { description: 'Connects a published op to an action that fits it, within one system' }),
  disconnect: Ops.action(NS, 'disconnect', Type.Object({ system: systemId, id: str('The subscription id', []) }, { description: 'Which subscription, and where' }), none,
    { description: 'Closes a subscription' }),
  select: Ops.action(NS, 'select', SelectionSchema, none, { description: 'Selects an instance (and maybe an op), or nothing with null' }),
}
const P = PlatformOps

type State = { host: string; systems: Map<string, Runtime>; selected: Selection; env: Environment; watch(rt: Runtime): void; changed(id: string, delta: unknown): void }

// what the platform adds, it owns: named by its own id in the host
const owner = (s: State): Owner => ({ kind: 'platform', name: s.env.handles().find(h => h.coord.registry === s.host)?.coord.instance ?? 'platform' })
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
export function platform(host: Runtime, catalog: Record<string, { component: Component; title?: string; tag?: string; modes?: readonly string[] }>,
  opts: { deploy?: (system: Runtime, id: string, kind: string, mode: string | undefined, owner: Owner, outward?: Selectors) => Result<void> } = {}): Component<State> {
  // read at call time: the host adds imported packages' kinds to this same object, then calls catalog-changed
  const kinds = (): Kind[] => Object.entries(catalog).map(([kind, e]) =>
    ({ kind, component: `${e.component.id.ns}/${e.component.id.name}`, title: e.title ?? kind, ...(e.tag && { tag: e.tag }), ...(e.modes && { modes: [...e.modes] }),
      ...(e.component.description && { description: e.component.description }) }))
  const c = Components.create<State>({ ns: 'composable', name: 'platform' }, env => {
    const s: State = {
      host: host.registry.id, systems: new Map([[host.registry.id, host]]), selected: null, env, changed: () => {},
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
  }, { description: "The systems: makes components from the catalog, adds them to systems, connects their actions, and publishes every change" })
  c.action(P.systems, s => snapshots(s))
  c.action(P.selected, s => s.selected)
  c.action(P.catalog, () => Object.keys(catalog))
  c.action(P.kinds, () => kinds())
  c.action(P.catalogChanged, s => { void s.env.notify(P.kinds, kinds()); void s.env.notify(P.catalog, Object.keys(catalog)) })
  c.action(P.selectionChanged); c.action(P.stateChanged)
  c.action(P.createSystem, (s, name) => {
    if (s.systems.has(name)) throw new Error(`${name} already exists`)
    const rt = Runtimes.create(Registries.create(name))
    s.systems.set(name, rt); s.watch(rt)
    s.changed(name, { type: 'system-created' })
  })
  c.action(P.createComponent, (s, { kind, name, system: id, mode, allow, deny }) => {
    const def = catalog[kind]
    if (!def) throw new Error(`no component kind ${kind}`)
    if (opts.deploy) {
      const rt = s.systems.get(id)
      if (!rt) throw new Error(`no system ${id}`)
      return must(opts.deploy(rt, name, kind, mode ?? def.modes?.[0], owner(s), allow || deny ? { ...(allow && { allow }), ...(deny && { deny }) } : undefined))
    }
    must(system(s, id).add(name, Components.instantiate(def.component), owner(s)))
  })
  c.action(P.addToSystem, (s, { instance, from, to }) => {
    const inst = system(s, from).get(instance)
    if (!inst) throw new Error(`no ${instance} in ${from}`)
    must(system(s, to).add(instance, inst, owner(s)))
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
