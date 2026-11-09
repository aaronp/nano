import type { Static, TFunction, TSchema } from 'typebox'
import { Systems, type ErrorInfo } from './system'
import {
  fail, ok, roleOf, routeProblem, unwrap,
  type Component, type ComponentFactory, type ComponentId, type Created, type Dependency, type Input, type Invocation,
  type Manifest, type Op, type Output, type Result, type Source, type SystemDelta, type SystemError, type SystemInstance,
} from './types'

/** A component's dependencies, callable by name: each goes to whatever it is bound to in the System of the call. */
export type Deps = Record<string, (input: unknown) => Promise<Result<unknown>>>
type Handler<P extends Op, S> =
  (input: Input<P>, h: { state: S; system: SystemInstance; inv: Invocation; deps: Deps }) => Result<Output<P>> | void | Promise<Result<Output<P>> | void>

/** A component made by `declare(...).define`. */
export type Model<S> = Component & {
  state: S
  /** The handles of the Systems this instance is in. */
  readonly systems: readonly SystemInstance[]
  /** Notify from the UI: sent to every System this instance is in, each a new correlation (define's choice). */
  notify: SystemInstance['notify']
  onChange(fn: () => void): () => void
}

/**
 * Start a component. Ops are named `author/id/name` from its id, and `define` derives the manifest from them,
 * so nothing is written twice. Input and output: an action. Output only: a source. Input only: a sink.
 */
function declare(id: ComponentId) {
  const ns = `${id.author}/${id.id}`
  const ops: Op[] = [], dependencies: Dependency[] = []
  return {
    /** `requires`: names of dependencies (declared with `dependency`) the op needs. */
    op<I extends TSchema | undefined = undefined, O extends TSchema | undefined = undefined>(
      name: string, description: string, shape: { input?: I; output?: O; requires?: string[] },
    ): Op<I, O> {
      if (!shape.input && !shape.output) throw new Error(`${ns}/${name}: an op needs an input, an output, or both`)
      const op = { name: `${ns}/${name}`, description, ...shape }; ops.push(op); return op
    },
    /** Declare an op this component calls on another (data: what something bound to it must look like). */
    dependency(name: string, description: string, spec: { op: Op<TSchema, TSchema | undefined>; components?: ComponentId[] }) {
      dependencies.push({ name, description, op: spec.op, ...(spec.components ? { components: spec.components } : {}) })
      return name
    },
    /**
     * `handlers`: one per op with an input; `system` is the handle of the System the call came through, carrying
     * its correlation. `added` runs when the instance joins a System (subscribe there; what it returns runs when
     * it leaves); `updated` gets that System's deltas. Call `changed()` after mutating state outside a handler so
     * views re-render.
     */
    define<S, const H extends readonly Op[] = []>(opts: {
      state: () => S
      handlers?: { [K in keyof H]: readonly [H[K], Handler<H[K], S>] }
      added?: (system: SystemInstance, h: { state: S; changed: () => void }) => void | (() => void)
      updated?: (delta: SystemDelta, h: { state: S; system: SystemInstance; changed: () => void }) => void
      dispose?: (state: S) => void | Promise<void>
    }): { manifest: Manifest; create(): Model<S> } {
      const handlers = new Map((opts.handlers ?? []).map(([op, h]) => [op.name, h as Handler<Op, S>]))
      const manifest: Manifest = { id, ops: [...ops], ...(dependencies.length ? { dependencies: [...dependencies] } : {}) }
      for (const op of manifest.ops) {
        if (op.input && !handlers.has(op.name)) throw new Error(`${ns}: no handler for ${op.name}`)
        for (const r of op.requires ?? []) if (!dependencies.some(d => d.name === r)) throw new Error(`${op.name} requires undeclared dependency ${r}`)
      }
      const depsOf = (s: SystemInstance): Deps => Object.fromEntries((manifest.dependencies ?? []).map(d => [d.name, (input: unknown) => s.use(d.name, input)]))
      return {
        manifest,
        create() {
          const state = opts.state(), listeners = new Set<() => void>()
          const changed = () => listeners.forEach(f => f())
          const joined = new Map<string, { system: SystemInstance; leave?: () => void }>()
          const model: Model<S> = {
            manifest, state,
            get systems() { return [...joined.values()].map(j => j.system) },
            onChange: fn => (listeners.add(fn), () => listeners.delete(fn)),
            async notify(op, p) {
              const rs = await Promise.all(model.systems.map(s => s.notify(op, p)))
              changed()
              return rs.find(r => r.type !== 'success') ?? ok(undefined)
            },
            onAddedToSystem(system) {
              const leave = opts.added?.(system, { state, changed }) ?? undefined
              joined.set(system.system.id, { system, leave })
              changed()
            },
            onRemovedFromSystem(systemId) { joined.get(systemId)?.leave?.(); joined.delete(systemId); changed() },
            onSystemUpdated(systemId, delta) {
              const j = joined.get(systemId)
              if (j) opts.updated?.(delta, { state, system: j.system, changed })
            },
            async onAction(system, inv) {
              const h = handlers.get(inv.op)
              if (!h) return fail('unknown-action', `no handler for ${inv.op}`)
              const r = await h(inv.input as never, { state, system, inv, deps: depsOf(system) })
              changed()
              return r ?? ok(undefined)
            },
            async dispose() {
              for (const j of joined.values()) j.leave?.()
              joined.clear()
              await opts.dispose?.(state)
            },
          }
          return model
        },
      }
    },
  }
}

/** Merge manifests under a new id. Throws on a duplicate op name. */
function compose(id: ComponentId, ...ms: Manifest[]): Manifest {
  const ops = ms.flatMap(m => m.ops), names = ops.map(o => o.name)
  const d = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))]
  if (d.length) throw new Error(`${id.author}/${id.id}: duplicate names ${d.join(', ')}`)
  return { id, ops }
}
export const Manifests = { compose }

/** A child op, bound to the child's name: `input(submitted)`. */
export type Bound<P extends Op = Op> = { child: string; op: P }
/** What `use` returns: call it with one of the child's ops to bind it for `route`. */
export type Handle<F extends ComponentFactory<any> = ComponentFactory<any>> = (<P extends Op>(op: P) => Bound<P>) & { child: string; factory: F }
export type Builder = {
  /**
   * Add a child. `wrap` derives its handle (everything it notifies, calls or subscribes to goes through it first);
   * `outer()` is the composite's own handle in (the first of) its Systems, for passing things through.
   */
  use<F extends ComponentFactory<any>>(name: string, factory: F, wrap?: (h: SystemInstance, outer: () => SystemInstance | undefined) => SystemInstance): Handle<F>
  /** Feed one child's output into another child's op. */
  route(from: Bound, to: Bound): void
  /** Which child ops make up the composite's manifest (default: all of them). */
  expose(...ops: Op[]): void
}
export type Composite<R extends Record<string, Handle>> = Component & { children: { [K in keyof R]: Created<R[K]['factory']> } }

/**
 * One component from named children, built once when defined; every mistake throws here, not at runtime.
 * The composite owns a System of its own, where its children live (registered as `..` itself, to reach them).
 * Exposed ops with an input are delegated to the child that has them; exposed sources are re-notified in every
 * System the composite is in. Return the handles to get typed `children`. Errors inside go to `onError`.
 */
function composite<const R extends Record<string, Handle>>(
  meta: { id: ComponentId; onError?: (e: SystemError, info: ErrorInfo) => void }, build: (c: Builder) => R,
): ComponentFactory<Composite<R>> {
  const uses: { name: string; factory: ComponentFactory<any>; wrap?: (h: SystemInstance, outer: () => SystemInstance | undefined) => SystemInstance }[] = []
  const routes: [Bound, Bound][] = []
  let shown: Op[] | undefined
  const manifestOf = (child: string) => uses.find(u => u.name === child)?.factory.manifest
  const children = build({
    use(name, factory, wrap) {
      if (uses.some(u => u.name === name)) throw new Error(`duplicate child "${name}"`)
      if (name === '..') throw new Error('".." is the composite itself')
      uses.push({ name, factory, wrap })
      return Object.assign(<P extends Op>(op: P) => ({ child: name, op }), { child: name, factory })
    },
    route(from, to) {
      const problem = routeProblem(manifestOf(from.child), from.op, manifestOf(to.child), to.op, { from: from.child, to: to.child })
      if (problem) throw new Error(`route: ${problem}`)
      routes.push([from, to])
    },
    expose(...ops) { shown = [...(shown ?? []), ...ops] },
  })
  const all = uses.flatMap(u => u.factory.manifest.ops)
  for (const o of shown ?? []) if (!all.some(x => x.name === o.name)) throw new Error(`expose: no child has ${o.name}`)
  const pick = (o: Op) => !shown || shown.some(s => s.name === o.name)
  // Children are bound inside the composite's System, so exported ops do not carry `requires`.
  const manifest = compose(meta.id, { id: meta.id, ops: all.filter(pick).map(({ requires: _r, ...o }) => o) })
  const owner = new Map(uses.flatMap(u => u.factory.manifest.ops.filter(o => o.input && pick(o)).map(o => [o.name, { child: u.name, op: o }])))

  return {
    manifest,
    async create() {
      const inner = Systems.create({ id: `${meta.id.author}/${meta.id.id}`, onError: meta.onError ?? ((e, info) => console.error(e, info)) })
      const outer: SystemInstance[] = []
      const made: Record<string, Component> = {}
      try {
        for (const u of uses) {
          made[u.name] = await u.factory.create()
          const r = inner.register(u.name, made[u.name], { wrap: u.wrap && (h => u.wrap!(h, () => outer[0])) })
          if (r.type !== 'success') throw new Error(`use ${u.name}: ${r.type === 'error' ? r.error.message : r.reason}`)
        }
        for (const [f, t] of routes) {
          const r = inner.subscribe({ source: f.child, op: f.op.name, listener: t.child, target: t.op.name })
          if (r.type === 'error') throw new Error(`route: ${r.error.message}`)
        }
      } catch (err) { for (const c of Object.values(made)) await c.dispose?.(); throw err }
      const self = unwrap(inner.register('..', { manifest: { id: meta.id, ops: [] }, onAction: async () => fail('unknown-action', 'the composite takes no calls from inside') }))
      for (const u of uses) for (const op of u.factory.manifest.ops.filter(o => roleOf(o) === 'source' && pick(o)))
        self.subscribe(op, (p, d) => { for (const o of outer) void o.within(d.correlation).notify(op as Source, p as never) }, { from: u.name })
      return {
        manifest,
        children: Object.fromEntries(Object.entries(children).map(([k, h]) => [k, made[h.child]])) as Composite<R>['children'],
        onAddedToSystem: s => { outer.push(s) },
        onRemovedFromSystem: id => { const i = outer.findIndex(o => o.system.id === id); if (i >= 0) outer.splice(i, 1) },
        onAction: (_s, inv) => {
          const o = owner.get(inv.op)!
          return self.within(inv.correlation).call(o.child, o.op as Op<TSchema>, inv.input as never)
        },
        async dispose() { for (const [name, c] of Object.entries(made)) { inner.unregister(name); await c.dispose?.() } },
      }
    },
  }
}

/** An operation: a function of one (object) argument. `Type.Function([Type.Object({...})], Type.String())`. */
type Fn = TFunction<[TSchema], TSchema>
type Impl<A extends Record<string, Fn>> =
  { [K in keyof A]: (input: Static<A[K]['parameters'][0]>) => Static<A[K]['returnType']> | Promise<Static<A[K]['returnType']>> }
type LiftedOps<A extends Record<string, Fn>> = { [K in keyof A]: Op<A[K]['parameters'][0], A[K]['returnType']> }

/**
 * Lift plain functions into a component: `api` is the interface (one function schema per operation), `impl`
 * the functions (plain code that knows nothing of the SDK). Each becomes an action named after its key.
 */
function lift<const A extends Record<string, Fn>>(id: ComponentId, api: A, impl: Impl<A>) {
  const C = declare(id)
  const ops = {} as Record<string, Op>
  for (const [name, fn] of Object.entries(api)) {
    if (fn?.type !== 'function' || fn.parameters?.length !== 1 || !fn.returnType)
      throw new Error(`lift ${id.author}/${id.id}: ${name} must be Type.Function([input], output)`)
    if (typeof impl[name] !== 'function') throw new Error(`lift ${id.author}/${id.id}: no implementation for ${name}`)
    ops[name] = C.op(name, (fn as { description?: string }).description ?? name, { input: fn.parameters[0], output: fn.returnType })
  }
  const factory = C.define({
    state: () => impl,
    handlers: Object.entries(ops).map(([name, op]) =>
      [op, async (input: unknown) => ok(await (impl as Record<string, (i: unknown) => unknown>)[name](input))] as const) as never,
  })
  return Object.assign(factory, { ops: ops as LiftedOps<A> })
}

/** A typed proxy over `handle.call`: `client(h, 'thing', myThing.ops).repeat({ y: 'ab', times: 3 })`. Never throws. */
function client<const A extends Record<string, Op<TSchema, TSchema | undefined>>>(h: SystemInstance, target: string, ops: A) {
  return Object.fromEntries(Object.entries(ops).map(([k, op]) => [k, (input: unknown) => h.call(target, op, input as never)])) as
    { [K in keyof A]: (input: Input<A[K]>) => Promise<Result<Output<A[K]>>> }
}

/**
 * A component with no handlers, for a host (a page, a test) that needs a handle to act in a System:
 * `const page = system.register('page', Components.party())`. Give it source ops to let it notify.
 */
const party = (id: ComponentId = { author: 'composable', id: 'party' }, ops: Op[] = []): Component =>
  ({ manifest: { id, ops }, onAction: async () => fail('unknown-action', 'a party takes no calls') })

export const Components = { declare, compose: composite, lift, client, party }
