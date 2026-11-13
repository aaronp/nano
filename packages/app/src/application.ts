// Systems as a component: it holds the registries (host first), creates components from a catalog, adds them to
// systems, connects their actions, and publishes every change in any system.
import { Type, type Static } from 'typebox'
import type { AppCatalog } from './catalog'
import { parseRef, ref, type Ref } from './refs'
import { resolve, type Resolution, type Selector } from './resolve'
import { SelectorSchema } from './document'
import { Components, CoordSchema, DeltaSchema, Tags, Ops, SnapshotSchema, SubscriptionSchema, Registries, Runtimes, type Component, type Environment, type Interface, type Owner, type Registry, type Result, type Runtime, type Selectors, type Snapshot } from '@pritzlaff/nano-core'

const NS = 'nano.app/application', none = Type.Void()
const str = (description: string, examples: string[]) => Type.String({ description, examples })
const systemId = str('A system (registry) id', ['host', 'lab']), instance = str('An instance id', ['ex-range'])
const ignored = Type.Unknown({ description: 'Ignored: any value triggers it' })

/** What is selected in the application: an instance in a system, and maybe one of its ops; null when nothing is. */
export const SelectionSchema = Type.Union([
  Type.Object({ system: systemId, instance, op: Type.Optional(str('One of its ops, by key', ['composable.bundle/range/value'])) }),
  Type.Null(),
], { title: 'Selection', description: 'An instance in a system, and maybe one of its ops; null when nothing is selected',
  examples: [{ system: 'host', instance: 'ex-range' }, null] })
export type Selection = Static<typeof SelectionSchema>

/** A kind the application can make: its catalog name, its component's id (`ns/name`), title and element tag. */
export const KindSchema = Type.Object({
  kind: str('Its catalog name', ['range']), component: str("Its component's id, ns/name", ['composable.bundle/range']),
  title: str('What to call it', ['Range']), tag: Type.Optional(str("Its element's tag, if it has one", ['c-range'])),
  description: Type.Optional(str('What it is for', ['A number between bounds'])),
  modes: Type.Optional(Type.Array(Type.String({ description: 'A deploy mode', examples: ['host'] }), { description: 'The modes it can be deployed in, the first is the default: host, sandbox, isolated-sandbox' })),
  implements: Type.Optional(Type.Array(Type.String({ description: 'An interface id', examples: ['example/db'] }), { description: 'The interfaces it implements' })),
  needs: Type.Optional(Type.Record(Type.String(), Type.String(), { description: 'Its needs: name to interface id' })),
}, { title: 'Kind', description: 'A kind of component the application can make' })
export type Kind = Static<typeof KindSchema>

/** A route in the application: a path, what it shows, and a layout only the host understands. */
export const ScreenSchema = Type.Object({
  id: str('Its route path', ['/lab']), title: str('Its name in navigation', ['Lab']), icon: Type.Optional(str('Its icon', ['flask'])),
  system: systemId, layout: Type.Unknown({ description: 'Opaque: only the host reads it' }),
}, { title: 'Screen', description: 'A route: its title, its system and an opaque layout' })
export type Screen = Static<typeof ScreenSchema>

/** One instance shown in one panel of one screen. */
/** A rectangle as fractions of the page, each in [0, 1]. */
export const BoxSchema = Type.Object({
  x: Type.Number({ minimum: 0, maximum: 1 }), y: Type.Number({ minimum: 0, maximum: 1 }), w: Type.Number({ minimum: 0, maximum: 1 }), h: Type.Number({ minimum: 0, maximum: 1 }),
}, { title: 'Box', description: 'A rectangle, as fractions of the page' })
export type Box = Static<typeof BoxSchema>

/** One instance shown in one panel of one screen; its box on the page and its tab in a group, when known. */
export const PlacementSchema = Type.Object({
  screen: str('A screen id', ['/lab']), panel: str('A panel of that screen', ['gauge']), instance,
  box: Type.Optional(BoxSchema), tab: Type.Optional(Type.Object({ group: str('The tab group', ['main']), active: Type.Boolean({ description: 'Whether it is the group\'s open tab' }) })),
}, { title: 'Placement', description: 'An instance shown in a panel of a screen' })
export type Placement = Static<typeof PlacementSchema>

const refArg = str('A ref: system:<id>, instance:<system>/<id> or screen:<path>', ['instance:host/r1'])
export const ResolutionSchema = Type.Union([
  Type.Object({ bound: CoordSchema }), Type.Object({ make: str('A catalog kind to make', ['db']) }),
  Type.Object({ choose: Type.Object({ candidates: Type.Array(CoordSchema), kinds: Type.Array(Type.String()) }), reason: str('Why it needs a choice', ['2 match']) }),
], { title: 'Resolution', description: 'Bound to an instance, a kind to make, or a choice' })
const need = str('A need, by name', ['db'])
const TagArg = Type.Object({ ref: refArg, tag: str('A tag', ['billing']) }, { description: 'Which ref, and which tag' })

/** The application's ops. */
export const ApplicationOps = {
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
    deny: Type.Optional(Type.Array(Type.String({ description: 'A selector, registry/target/op, * matches anything', examples: ['host/application/*'] }), { description: 'Outward calls it may not make; guards it' })) },
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
  screens: Ops.source(NS, 'screens', Type.Array(ScreenSchema), { description: 'Every screen, in navigation order' }),
  setScreen: Ops.action(NS, 'set-screen', ScreenSchema, none, { description: 'Adds a screen, or replaces the one with that id in place; works out its placements' }),
  removeScreen: Ops.action(NS, 'remove-screen', str('A screen id', ['/lab']), none, { description: 'Removes a screen and its placements' }),
  moveScreen: Ops.action(NS, 'move-screen', Type.Object({ id: str('A screen id', ['/lab']), by: Type.Union([Type.Literal(-1), Type.Literal(1)], { description: '-1 earlier, 1 later' }) }), none, { description: 'Moves a screen one place in navigation order' }),
  placements: Ops.action(NS, 'placements', Type.Object({ screen: Type.Optional(str('Only this screen', ['/lab'])) }), Type.Array(PlacementSchema), { description: 'Which instances are shown where, on one screen or all' }),
  changed: Ops.source(NS, 'changed', Type.Object({ what: Type.Union([Type.Literal('systems'), Type.Literal('screens'), Type.Literal('tags')]), ref: Type.Optional(Type.String({ description: 'The ref that changed' })) }), { description: 'Something the application keeps changed' }),
  tag: Ops.action(NS, 'tag', TagArg, none, { description: 'Tags a system, instance or screen' }),
  untag: Ops.action(NS, 'untag', TagArg, none, { description: 'Removes a tag from a system, instance or screen' }),
  tagsOf: Ops.action(NS, 'tags-of', refArg, Type.Array(Type.String()), { description: 'The tags of a ref, sorted' }),
  tagged: Ops.action(NS, 'tagged', str('A tag', ['billing']), Type.Array(Type.String()), { description: 'The refs with a tag, sorted' }),
  allTags: Ops.action(NS, 'all-tags', ignored, Type.Record(Type.String(), Type.Array(Type.String())), { description: 'Every ref with its tags, for saving' }),
  query: Ops.action(NS, 'query', Type.Object({ screen: Type.Optional(str('Placed on this screen', ['/lab'])), system: Type.Optional(systemId),
    kind: Type.Optional(str('A catalog kind', ['range'])), tag: Type.Optional(str('Tagged with this', ['billing'])) }, { description: 'Filters that all must hold' }),
    Type.Array(Type.String()), { description: 'The instances (as refs, sorted) that match every filter given' }),
  screensOf: Ops.action(NS, 'screens-of', refArg, Type.Array(Type.String()), { description: 'The screens that place an instance' }),
  needsOf: Ops.action(NS, 'needs-of', refArg, Type.Array(Type.Object({ need, implements: str('Its interface id', ['example/db']), selector: SelectorSchema,
    binding: Type.Optional(str('The instance it is bound to, as a ref', ['instance:storage/db'])) })), { description: "An instance's needs: each one's selector and binding (none: it is disabled)" }),
  setSelector: Ops.action(NS, 'set-selector', Type.Object({ ref: refArg, need, selector: SelectorSchema }), ResolutionSchema,
    { description: "Sets a need's selector and resolves it, binding when exactly one instance fits; never makes one" }),
  bindNeed: Ops.action(NS, 'bind-need', Type.Object({ ref: refArg, need, to: refArg }), none, { description: 'Binds a need to an instance, pinning its selector there' }),
  unbindNeed: Ops.action(NS, 'unbind-need', Type.Object({ ref: refArg, need }), none, { description: 'Clears a need\'s binding, leaving its instance disabled' }),
  select: Ops.action(NS, 'select', SelectionSchema, none, { description: 'Selects an instance (and maybe an op), or nothing with null' }),
}
const P = ApplicationOps

type State = { tags: Tags<Ref>; selectors: Map<string, Selector>;   // by `ref need`
  screens: Map<string, { screen: Screen; placements: Placement[] }>; host: string; systems: Map<string, Runtime>; selected: Selection; env: Environment; watch(rt: Runtime): void; changed(id: string, delta: unknown): void }

// what the application adds, it owns: named by its own id in the host
const owner = (s: State): Owner => ({ kind: 'platform', name: s.env.handles().find(h => h.coord.registry === s.host)?.coord.instance ?? 'application' })
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

/** The application over `host`, able to create the kinds of component in `catalog` (a host's merged catalogs). */
export function application(host: Runtime, catalog: AppCatalog,
  opts: { placementsOf?: (layout: unknown) => Omit<Placement, 'screen'>[]; gateways?: readonly string[]; locked?: (id: string) => boolean; deploy?: (system: Runtime, id: string, kind: string, mode: string | undefined, owner: Owner, outward?: Selectors) => Result<void> } = {}): Component<State> {
  // read at call time: the host adds imported packages' kinds to this same object, then calls catalog-changed
  const kinds = (): Kind[] => Object.entries(catalog).map(([kind, e]) =>
    ({ kind, component: `${e.component.id.ns}/${e.component.id.name}`, title: e.title ?? kind, ...(e.tag && { tag: e.tag }), ...(e.modes && { modes: [...e.modes] }),
      ...(e.component.description && { description: e.component.description }),
      ...(e.component.implements && { implements: e.component.implements.map(i => i.id) }),
      ...(e.component.needs && { needs: Object.fromEntries(Object.entries(e.component.needs).map(([n, i]) => [n, i.id])) }) }))
  // needs: the instance at a ref, its declared need, and resolving a selector for it over every system
  const instanceAt = (s: State, r: string) => {
    const p = parseRef(r)
    if (p?.kind !== 'instance') throw new Error(`not an instance ref: ${JSON.stringify(r)}`)
    const reg = system(s, p.system), inst = reg.get(p.id)
    if (!inst) throw new Error(`no such thing: ${r}`)
    return { reg, id: p.id, inst, system: p.system }
  }
  const needAt = (s: State, r: string, need: string) => {
    const { reg, id, inst } = instanceAt(s, r), i = inst.component.needs?.[need]
    if (!i) throw new Error(`${id} has no need ${need}`)
    return { reg, id, iface: i, key: `${r} ${need}` }
  }
  const selectorOf = (s: State, key: string, i: Interface): Selector => s.selectors.get(key) ?? { implements: i.id }
  const resolveNeed = (s: State, reg: Registry, id: string, need: string, i: Interface, selector: Selector): Resolution => {
    const snaps = snapshots(s)
    const r = resolve(selector, {
      requester: { registry: reg.id, instance: id }, interfaceOps: Object.values(i.ops).map(op => Ops.key(op)), systems: snaps.map(x => x.id),
      candidates: snaps.flatMap(x => x.instances.map(c => ({ coord: { registry: x.id, instance: c.id }, ops: c.ops.map(op => Ops.key(op)), tags: [...s.tags.tagsOf(`instance:${x.id}/${c.id}`)] }))),
      providers: kinds().flatMap(k => k.implements ? [{ kind: k.kind, implements: k.implements }] : []),
    })
    if ('bound' in r) must(reg.bind(id, need, r.bound))
    return r
  }
  // after an instance is added (never inside it), each unbound need binds when exactly one instance fits
  const autoBind = (s: State, reg: Registry, id: string) => {
    for (const [need, i] of Object.entries(reg.get(id)?.component.needs ?? {}))
      if (!reg.binding(id, need)) resolveNeed(s, reg, id, need, i, selectorOf(s, `instance:${reg.id}/${id} ${need}`, i))
  }
  // the same instance, owned by the application, keeping its labels (a sandboxed instance stays one)
  const share = (s: State, instance: string, from: string, to: string) => {
    const inst = system(s, from).get(instance)
    if (!inst) throw new Error(`no ${instance} in ${from}`)
    must(system(s, to).add(instance, inst, owner(s)))
    must(system(s, to).label(instance, system(s, from).labels(instance)))
  }
  const c = Components.create<State>({ ns: 'nano.app', name: 'application' }, env => {
    const s: State = {
      tags: Tags.create<Ref>(), selectors: new Map(), screens: new Map(), host: host.registry.id, systems: new Map([[host.registry.id, host]]), selected: null, env, changed: () => {},
      watch: rt => { rt.registry.listen(delta => {
        if (delta.type === 'instance-removed') {
          const r = `instance:${rt.registry.id}/${delta.instance}` as Ref
          s.tags.remove(r); for (const k of s.selectors.keys()) if (k.startsWith(`${r} `)) s.selectors.delete(k)
        }
        if (delta.type === 'instance-added') queueMicrotask(() => autoBind(s, rt.registry, delta.instance))
        changed(rt.registry.id, delta)
      }) },
    }
    // every change is told at once; the snapshots go out once per burst (adding an element makes several deltas)
    let pending = false
    const changed = (id: string, delta: unknown) => {
      void env.notify(P.stateChanged, { system: id, delta })
      if (!pending) { pending = true; queueMicrotask(() => { pending = false; void env.notify(P.systems, snapshots(s)); void env.notify(P.changed, { what: 'systems' }) }) }
    }
    s.changed = changed
    s.tags.listen(c => { void env.notify(P.changed, { what: 'tags', ref: c.item }) })
    s.watch(host)
    return s
  }, { description: "The application: its systems, makes components from the catalog, adds them to systems, connects their actions, and publishes every change" })
  c.action(P.systems, s => snapshots(s))
  c.action(P.selected, s => s.selected)
  c.action(P.catalog, () => Object.keys(catalog))
  c.action(P.kinds, () => kinds())
  c.action(P.catalogChanged, s => { void s.env.notify(P.kinds, kinds()); void s.env.notify(P.catalog, Object.keys(catalog)) })
  c.action(P.selectionChanged); c.action(P.stateChanged); c.action(P.changed)
  c.action(P.createSystem, (s, name) => {
    if (s.systems.has(name)) throw new Error(`${name} already exists`)
    const rt = Runtimes.create(Registries.create(name), undefined, { peers: id => s.systems.get(id) })
    s.systems.set(name, rt); s.watch(rt)
    for (const g of opts.gateways ?? []) if (host.registry.get(g)) share(s, g, s.host, name)   // the same instance in every system
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
  c.action(P.addToSystem, (s, { instance, from, to }) => { share(s, instance, from, to) })
  c.action(P.removeFromSystem, (s, { instance, system: id }) => {
    const self = s.env.handles().find(h => h.coord.registry === id)?.coord.instance
    if (instance === 'registry' || instance === self || opts.gateways?.includes(instance) || opts.locked?.(instance)) throw new Error(`${instance} can't be removed from ${id}`)
    const reg = system(s, id)
    // gone from the system means gone from its wiring too: core keeps a source's subscriptions, the application doesn't
    for (const sub of reg.snapshot().subscriptions) if (sub.source === instance) reg.unsubscribe(sub.id)
    must(reg.remove(instance))
  })
  c.action(P.connect, (s, { system: id, source, op, listener, target }) => {
    const reg = system(s, id), from = opOf(reg, source, op), to = opOf(reg, listener, target)
    if (!Ops.fits(from, to)) throw new Error(`${source} · ${op} doesn't fit ${listener} · ${target}`)
    return must(reg.subscribe({ source, op, listener, target }))
  })
  c.action(P.disconnect, (s, { system: id, id: sub }) => { must(system(s, id).unsubscribe(sub)) })
  const screenList = (s: State) => [...s.screens.values()].map(e => e.screen)
  const screensChanged = (s: State, id: string) => {
    void s.env.notify(P.screens, screenList(s)); void s.env.notify(P.changed, { what: 'screens', ref: ref.screen(id) })
  }
  c.action(P.screens, s => screenList(s))
  c.action(P.setScreen, (s, screen) => {
    ref.screen(screen.id)
    if (!screen.title.trim()) throw new Error('a screen needs a title')
    if (!s.systems.has(screen.system)) throw new Error(`no system ${screen.system}`)
    const placements = (opts.placementsOf?.(screen.layout) ?? []).map(p => ({ screen: screen.id, ...p }))
    s.screens.set(screen.id, { screen, placements })   // a replaced key keeps its place
    screensChanged(s, screen.id)
  })
  c.action(P.removeScreen, (s, id) => {
    if (!s.screens.delete(id)) throw new Error(`no screen ${id}`)
    s.tags.remove(ref.screen(id))
    screensChanged(s, id)
  })
  c.action(P.moveScreen, (s, { id, by }) => {
    const all = [...s.screens], i = all.findIndex(([k]) => k === id), j = i + by
    if (i < 0) throw new Error(`no screen ${id}`)
    if (j < 0 || j >= all.length) throw new Error(`${id} can't move further`)
    ;[all[i], all[j]] = [all[j]!, all[i]!]
    s.screens = new Map(all)
    screensChanged(s, id)
  })
  c.action(P.placements, (s, { screen }) => [...s.screens.values()].filter(e => !screen || e.screen.id === screen).flatMap(e => e.placements))
  // a ref must be well formed and name something that exists
  const known = (s: State, r: string): Ref => {
    const p = parseRef(r)
    if (!p) throw new Error(`bad ref: ${JSON.stringify(r)}`)
    if (p.kind === 'system' ? !s.systems.has(p.id) : p.kind === 'screen' ? !s.screens.has(p.path) : !s.systems.get(p.system)?.registry.get(p.id)) throw new Error(`no such thing: ${r}`)
    return r as Ref
  }
  c.action(P.tag, (s, a) => { s.tags.tag(known(s, a.ref), a.tag) })
  c.action(P.untag, (s, a) => { s.tags.untag(known(s, a.ref), a.tag) })
  c.action(P.tagsOf, (s, r) => [...s.tags.tagsOf(r as Ref)].sort())
  c.action(P.tagged, (s, t) => [...s.tags.tagged(t)].sort())
  c.action(P.allTags, s => Object.fromEntries([...s.tags.all()].map(([k, v]) => [k, [...v].sort()])))
  // the screens placing an instance that exists
  const screensOf = (s: State, r: string) => {
    const p = parseRef(r)
    if (p?.kind !== 'instance' || !s.systems.get(p.system)?.registry.get(p.id)) return []
    return [...s.screens.values()].filter(e => e.screen.system === p.system && e.placements.some(x => x.instance === p.id)).map(e => e.screen.id)
  }
  c.action(P.screensOf, (s, r) => screensOf(s, r))
  c.action(P.query, (s, f) => {
    const kinds_ = f.kind ? new Set(kinds().filter(k => k.kind === f.kind).map(k => k.component)) : null
    const out: string[] = []
    for (const snap of snapshots(s)) {
      if (f.system && snap.id !== f.system) continue
      for (const i of snap.instances) {
        const r = `instance:${snap.id}/${i.id}` as Ref
        if (kinds_ && !kinds_.has(i.component)) continue
        if (f.tag && !s.tags.tagged(f.tag).has(r)) continue
        if (f.screen && !screensOf(s, r).includes(f.screen)) continue
        out.push(r)
      }
    }
    return out.sort()
  })
  c.action(P.needsOf, (s, r) => {
    const { reg, id, inst } = instanceAt(s, r)
    return Object.entries(inst.component.needs ?? {}).map(([need, i]) => {
      const b = reg.binding(id, need)
      return { need, implements: i.id, selector: selectorOf(s, `${r} ${need}`, i), ...(b && { binding: `instance:${b.registry}/${b.instance}` }) }
    })
  })
  c.action(P.setSelector, (s, { ref: r, need, selector }) => {
    const n = needAt(s, r, need)
    s.selectors.set(n.key, selector)
    return resolveNeed(s, n.reg, n.id, need, n.iface, selector)
  })
  c.action(P.bindNeed, (s, { ref: r, need, to }) => {
    const n = needAt(s, r, need), t = instanceAt(s, to)
    if (t.system === n.reg.id && t.id === n.id) throw new Error(`${n.id} can't depend on itself`)
    if (!Object.values(n.iface.ops).every(op => t.inst.actions.has(Ops.key(op)))) throw new Error(`${t.system}/${t.id} doesn't implement ${n.iface.id}`)   // as resolve checks a candidate
    must(n.reg.bind(n.id, need, { registry: t.system, instance: t.id }))
    s.selectors.set(n.key, { implements: n.iface.id, layer: t.system, at: t.id, tags: [...s.tags.tagsOf(to as Ref)].sort() })
  })
  c.action(P.unbindNeed, (s, { ref: r, need }) => { const n = needAt(s, r, need); must(n.reg.unbind(n.id, need)) })
  c.action(P.select, (s, sel) => {
    s.selected = (sel ?? null) as Selection
    void s.env.notify(P.selectionChanged, s.selected)
    void s.env.notify(P.selected, s.selected)
  })
  return c
}

/** A system's runtime, from the application instance in `registry` (the application owns the runtimes it creates). */
export function runtimeOf(registry: Registry, system: string, id = 'application'): Runtime | undefined {
  return (registry.get(id)?.value as State | undefined)?.systems.get(system)
}
