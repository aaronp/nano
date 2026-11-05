import type { Static, TFunction, TSchema } from 'typebox'
import {
  fail, ok,
  type Action, type Component, type ComponentFactory, type ComponentId, type Context, type Event,
  type InstanceRef, type Invocation, type Manifest, type Output, type Result,
} from './types'

type Meta = { id: ComponentId; version: string }
type Handler<A extends Action, S> =
  (input: Static<A['input']>, on: { state: S; ctx: Context; inv: Invocation }) => Result<unknown> | void | Promise<Result<unknown> | void>

/** A component made by `declare(...).define`: its state, an emit for UI-originated events, and change notification. */
export type Model<S> = Component & {
  state: S
  emit: Context['emit']
  onChange(fn: () => void): () => void
}
/** A factory whose `create` result type is known, so composites and views get typed children. */
export type Factory<C extends Component = Component> = ComponentFactory & { create(...a: Parameters<ComponentFactory['create']>): Promise<C> }
/** The component a factory creates: `registry.component(ref) as Created<typeof myWidget>`. */
export type Created<F extends Factory> = Awaited<ReturnType<F['create']>>

/**
 * Start a component: events and actions are named `author/id/name` from its id, and `define` derives the
 * manifest from what was declared, so nothing is written twice.
 */
function declare(id: ComponentId, version: string) {
  const ns = `${id.author}/${id.id}`
  const emits: Event[] = [], consumes: Action[] = []
  return {
    event<S extends TSchema>(name: string, description: string, schema: S): Event<S> {
      const e = { name: `${ns}/${name}`, description, schema }; emits.push(e); return e
    },
    action<I extends TSchema, O extends TSchema | undefined = undefined>(name: string, description: string, input: I, output?: O): Action<I, O> {
      const a = { name: `${ns}/${name}`, description, input, ...(output ? { output } : {}) }; consumes.push(a); return a
    },
    /** Handlers get the per-call ctx (keeps loop detection); `emit` on the model is for UI-originated events. */
    define<S, const A extends readonly Action[]>(opts: {
      state: () => S
      actions: { [K in keyof A]: readonly [A[K], Handler<A[K], S>] }
      dispose?: (state: S) => void | Promise<void>
    }): Factory<Model<S>> {
      const handlers = new Map(opts.actions.map(([a, h]) => [a.name, h as Handler<Action, S>]))
      for (const a of consumes) if (!handlers.has(a.name)) throw new Error(`${ns}: no handler for ${a.name}`)
      const manifest: Manifest = { id, version, emits, consumes }
      return {
        manifest,
        async create(ctx) {
          const state = opts.state(), listeners = new Set<() => void>()
          const changed = () => listeners.forEach(f => f())
          return {
            state,
            onChange: fn => (listeners.add(fn), () => listeners.delete(fn)),
            emit: async (e, p) => { const r = await ctx.emit(e, p); changed(); return r },
            async onAction(c, inv) {
              const h = handlers.get(inv.action)
              if (!h) return fail('unknown-action', `no handler for ${inv.action}`)
              const r = await h(inv.input, { state, ctx: c, inv })
              changed()
              return r ?? ok(undefined)
            },
            dispose: () => opts.dispose?.(state),
          }
        },
      }
    },
  }
}

/** Merge manifests under a new identity. Throws on a duplicate event or action name. */
function compose(meta: Meta, ...ms: Manifest[]): Manifest {
  const emits = ms.flatMap(m => m.emits), consumes = ms.flatMap(m => m.consumes)
  const dupes = (ns: string[]) => ns.filter((n, i) => ns.indexOf(n) !== i)
  const d = [...new Set([...dupes(emits.map(e => e.name)), ...dupes(consumes.map(a => a.name))])]
  if (d.length) throw new Error(`${meta.id.author}/${meta.id.id}: duplicate names ${d.join(', ')}`)
  return { ...meta, emits, consumes }
}
export const Manifests = { compose }

/** A child event or action, bound to the child's name: `input(submitted)`. */
export type Bound<D extends Event | Action> = { child: string; def: D }
/** What `use` returns: call it with one of the child's events or actions to bind it for `route`. */
export type Handle<F extends Factory = Factory> = (<D extends Event | Action>(def: D) => Bound<D>) & { child: string; factory: F }
export type Builder = {
  /** Add a child. `wrap` derives its context: everything it emits or calls goes through it first. */
  use<F extends Factory>(name: string, factory: F, wrap?: (ctx: Context) => Context): Handle<F>
  route(from: Bound<Event>, to: Bound<Action>): void
  /** Which child events and actions make up the composite's manifest (default: all of them). */
  expose(...defs: (Event | Action)[]): void
}
export type Composite<R extends Record<string, Handle>> = Component & { children: { [K in keyof R]: Created<R[K]['factory']> } }

/**
 * One component from named children, built once when defined; every mistake throws here, not at runtime.
 * Children live under the composite's path in the same registry. Exposed actions are delegated to the child that
 * consumes them; exposed child events are re-emitted as the composite's own. Return the handles to get typed `children`.
 */
function composite<const R extends Record<string, Handle>>(meta: Meta, build: (c: Builder) => R): Factory<Composite<R>> {
  const uses: { name: string; factory: Factory; wrap?: (ctx: Context) => Context }[] = []
  const routes: [Bound<Event>, Bound<Action>][] = []
  let shown: (Event | Action)[] | undefined
  const factoryOf = (child: string) => uses.find(u => u.name === child)!.factory
  const children = build({
    use(name, factory, wrap) {
      if (uses.some(u => u.name === name)) throw new Error(`duplicate child "${name}"`)
      uses.push({ name, factory, wrap })
      return Object.assign(<D extends Event | Action>(def: D) => ({ child: name, def }), { child: name, factory })
    },
    route(from, to) {
      if (!factoryOf(from.child).manifest.emits.some(e => e.name === from.def.name)) throw new Error(`route: child "${from.child}" does not emit ${from.def.name}`)
      if (!factoryOf(to.child).manifest.consumes.some(a => a.name === to.def.name)) throw new Error(`route: child "${to.child}" does not consume ${to.def.name}`)
      routes.push([from, to])
    },
    expose(...defs) { shown = [...(shown ?? []), ...defs] },
  })
  const emits = uses.flatMap(u => u.factory.manifest.emits), consumes = uses.flatMap(u => u.factory.manifest.consumes)
  for (const d of shown ?? []) if (![...emits, ...consumes].some(x => x.name === d.name)) throw new Error(`expose: no child has ${d.name}`)
  const pick = (d: { name: string }) => !shown || shown.some(s => s.name === d.name)
  const manifest = compose(meta, { ...meta, emits: emits.filter(pick), consumes: consumes.filter(pick) })
  const owner = new Map(uses.flatMap(u => u.factory.manifest.consumes.filter(pick).map(a => [a.name, u.name])))

  return {
    manifest,
    async create(_ctx, self, host) {
      const ref = (child: string) => ({ namespace: [...self.namespace, self.instance], instance: child })
      for (const u of uses) await host.register(u.factory, u.name, u.wrap)
      for (const [f, t] of routes) host.route({ from: { instance: ref(f.child), event: f.def.name }, to: { instance: ref(t.child), action: t.def.name } })
      return {
        children: Object.fromEntries(Object.entries(children).map(([k, h]) => [k, host.component(ref(h.child))])) as Composite<R>['children'],
        onAction: (c, inv) => c.call(ref(owner.get(inv.action)!), { name: inv.action } as Action, inv.input as never),
      }
    },
  }
}

/** An operation: a function of one (object) argument. `Type.Function([Type.Object({...})], Type.String())`. */
type Op = TFunction<[TSchema], TSchema>
type Impl<A extends Record<string, Op>> =
  { [K in keyof A]: (input: Static<A[K]['parameters'][0]>) => Static<A[K]['returnType']> | Promise<Static<A[K]['returnType']>> }
type LiftedActions<A extends Record<string, Op>> = { [K in keyof A]: Action<A[K]['parameters'][0], A[K]['returnType']> }

/**
 * Lift plain functions into a component: `api` is the interface (one function schema per operation), `impl`
 * the functions. Each becomes an action named after its key; input and output are validated by the registry.
 */
function lift<const A extends Record<string, Op>>(id: ComponentId, version: string, api: A, impl: Impl<A>) {
  const C = Components.declare(id, version)
  const actions = {} as Record<string, Action>
  for (const [name, fn] of Object.entries(api)) {
    if (fn?.type !== 'function' || fn.parameters?.length !== 1 || !fn.returnType)
      throw new Error(`lift ${id.author}/${id.id}: ${name} must be Type.Function([input], output)`)
    if (typeof impl[name] !== 'function') throw new Error(`lift ${id.author}/${id.id}: no implementation for ${name}`)
    actions[name] = C.action(name, (fn as { description?: string }).description ?? name, fn.parameters[0], fn.returnType)
  }
  const factory = C.define({
    state: () => impl,
    actions: Object.entries(actions).map(([name, a]) =>
      [a, async (input: unknown) => ok(await (impl as Record<string, (i: unknown) => unknown>)[name](input))] as const) as never,
  })
  return Object.assign(factory, { actions: actions as LiftedActions<A> })
}

/** A typed proxy over `ctx.call`: `client(ctx, inst, myThing.actions).repeat({ y: 'ab', times: 3 })`. Never throws. */
function client<const A extends Record<string, Action>>(ctx: Context, target: InstanceRef, actions: A) {
  return Object.fromEntries(Object.entries(actions).map(([k, a]) => [k, (input: unknown) => ctx.call(target, a, input as never)])) as
    { [K in keyof A]: (input: Static<A[K]['input']>) => Promise<Result<Output<A[K]>>> }
}

export const Components = { declare, compose: composite, lift, client }
