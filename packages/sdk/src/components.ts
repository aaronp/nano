import type { Static, TFunction, TSchema } from 'typebox'
import { scoped, stackOf } from './context'
import { scope, type ErrorInfo } from './contexts/scope'
import {
  fail, ok, roleOf,
  type Component, type ComponentFactory, type ComponentId, type Context, type Input, type Invocation,
  type Manifest, type Op, type Output, type Result, type SystemError,
} from './types'

type Handler<P extends Op, S> =
  (input: Input<P>, on: { state: S; ctx: Context; inv: Invocation }) => Result<unknown> | void | Promise<Result<unknown> | void>

/** A component made by `declare(...).define`: its state, a publish for UI-originated publications, and change notification. */
export type Model<S> = Component & {
  state: S
  publish: Context['publish']
  onChange(fn: () => void): () => void
}
/** A factory whose `create` result type is known, so composites and views get typed children. */
export type Factory<C extends Component = Component> = ComponentFactory & { create(ctx: Context): Promise<C> }
/** The component a factory creates (what `scope.add` resolves to). */
export type Created<F extends Factory> = Awaited<ReturnType<F['create']>>

/**
 * Start a component. Ops are named `author/id/name` from its id, and `define` derives the manifest from them,
 * so nothing is written twice. Input and output: an action. Output only: a publication. Input only: a subscription.
 */
function declare(id: ComponentId) {
  const ns = `${id.author}/${id.id}`
  const ops: Op[] = []
  return {
    op<I extends TSchema | undefined = undefined, O extends TSchema | undefined = undefined>(
      name: string, description: string, shape: { input?: I; output?: O },
    ): Op<I, O> {
      if (!shape.input && !shape.output) throw new Error(`${ns}/${name}: an op needs an input, an output, or both`)
      const op = { name: `${ns}/${name}`, description, ...shape }; ops.push(op); return op
    },
    /**
     * `handlers`: one per op that has an input (it may arrive by call or be fed from a publication). Handlers get
     * the per-call ctx (keeps the stack). `setup` runs once when created (subscribe, watch, start timers); call
     * `changed()` after mutating state outside a handler so views re-render. Whatever it returns runs on dispose.
     */
    define<S, const H extends readonly Op[] = []>(opts: {
      state: () => S
      handlers?: { [K in keyof H]: readonly [H[K], Handler<H[K], S>] }
      setup?: (on: { state: S; ctx: Context; changed: () => void }) => void | (() => void)
      dispose?: (state: S) => void | Promise<void>
    }): Factory<Model<S>> {
      const handlers = new Map((opts.handlers ?? []).map(([op, h]) => [op.name, h as Handler<Op, S>]))
      for (const op of ops) if (op.input && !handlers.has(op.name)) throw new Error(`${ns}: no handler for ${op.name}`)
      const manifest: Manifest = { id, ops }
      return {
        manifest,
        async create(ctx) {
          const state = opts.state(), listeners = new Set<() => void>()
          const changed = () => listeners.forEach(f => f())
          const cleanup = opts.setup?.({ state, ctx, changed })
          return {
            state,
            onChange: fn => (listeners.add(fn), () => listeners.delete(fn)),
            publish: async (op, p) => { const r = await ctx.publish(op, p); changed(); return r },
            async onAction(c, inv) {
              const h = handlers.get(inv.op)
              if (!h) return fail('unknown-action', `no handler for ${inv.op}`)
              const r = await h(inv.input as never, { state, ctx: c, inv })
              changed()
              return r ?? ok(undefined)
            },
            dispose: async () => { cleanup?.(); await opts.dispose?.(state) },
          }
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
export type Handle<F extends Factory = Factory> = (<P extends Op>(op: P) => Bound<P>) & { child: string; factory: F }
export type Builder = {
  /**
   * Add a child. `wrap` derives its context (everything it publishes, calls or subscribes to goes through it
   * first); `outer` is the composite's own context, for passing things through to the outside.
   */
  use<F extends Factory>(name: string, factory: F, wrap?: (ctx: Context, outer: Context) => Context): Handle<F>
  /** Feed one child's publication into another child's op. */
  route(from: Bound, to: Bound): void
  /** Which child ops make up the composite's manifest (default: all of them). */
  expose(...ops: Op[]): void
}
export type Composite<R extends Record<string, Handle>> = Component & { children: { [K in keyof R]: Created<R[K]['factory']> } }

/**
 * One component from named children, built once when defined; every mistake throws here, not at runtime.
 * Children live in the composite's own scope, invisible from outside. Exposed ops with an input are delegated to
 * the child that has them; exposed publications are re-published as the composite's own. Return the handles to
 * get typed `children`. Errors inside go to `onError` (default: console).
 */
function composite<const R extends Record<string, Handle>>(
  meta: { id: ComponentId; onError?: (e: SystemError, info: ErrorInfo) => void }, build: (c: Builder) => R,
): Factory<Composite<R>> {
  const uses: { name: string; factory: Factory; wrap?: (ctx: Context, outer: Context) => Context }[] = []
  const routes: [Bound, Bound][] = []
  let shown: Op[] | undefined
  const opOf = (b: Bound) => uses.find(u => u.name === b.child)!.factory.manifest.ops.find(o => o.name === b.op.name)
  const children = build({
    use(name, factory, wrap) {
      if (uses.some(u => u.name === name)) throw new Error(`duplicate child "${name}"`)
      uses.push({ name, factory, wrap })
      return Object.assign(<P extends Op>(op: P) => ({ child: name, op }), { child: name, factory })
    },
    route(from, to) {
      const f = opOf(from), t = opOf(to)
      if (!f || roleOf(f) !== 'publication') throw new Error(`route: child "${from.child}" does not publish ${from.op.name}`)
      if (!t?.input) throw new Error(`route: child "${to.child}" has no op ${to.op.name} taking input`)
      routes.push([from, to])
    },
    expose(...ops) { shown = [...(shown ?? []), ...ops] },
  })
  const all = uses.flatMap(u => u.factory.manifest.ops)
  for (const o of shown ?? []) if (!all.some(x => x.name === o.name)) throw new Error(`expose: no child has ${o.name}`)
  const pick = (o: Op) => !shown || shown.some(s => s.name === o.name)
  const manifest = compose(meta.id, { id: meta.id, ops: all.filter(pick) })
  const owner = new Map(uses.flatMap(u => u.factory.manifest.ops.filter(o => o.input && pick(o)).map(o => [o.name, u.name])))

  return {
    manifest,
    async create(outer) {
      const inner = scope({ onError: meta.onError ?? ((e, info) => console.error(e, info)) })
      try {
        for (const u of uses) await inner.add(u.name, u.factory, u.wrap && (c => u.wrap!(c, outer)))
      } catch (err) { await inner.clear(); throw err }
      for (const [f, t] of routes) inner.route(f.child, f.op, t.child, t.op)
      // The composite inside its own scope: re-publishes exposed child publications outside, keeping their stack.
      const host = inner.context(outer.self)
      for (const u of uses) for (const op of u.factory.manifest.ops.filter(o => roleOf(o) === 'publication' && pick(o)))
        host.subscribe(u.name, op as Op, (p, d) => scoped(outer, d.stack).publish(op as Op, p))
      return {
        children: Object.fromEntries(Object.entries(children).map(([k, h]) => [k, inner.component(h.child)])) as Composite<R>['children'],
        onAction: (c, inv) => scoped(host, stackOf(c)).call(owner.get(inv.op)!, { name: inv.op, input: {} as TSchema }, inv.input as never),
        dispose: () => inner.clear(),
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
 * the functions. Each becomes an action named after its key; input and output are validated on every call.
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

/** A typed proxy over `ctx.call`: `client(ctx, 'thing', myThing.ops).repeat({ y: 'ab', times: 3 })`. Never throws. */
function client<const A extends Record<string, Op>>(ctx: Context, target: string, ops: A) {
  return Object.fromEntries(Object.entries(ops).map(([k, op]) => [k, (input: unknown) => ctx.call(target, op, input as never)])) as
    { [K in keyof A]: (input: Input<A[K]>) => Promise<Result<Output<A[K]>>> }
}

export const Components = { declare, compose: composite, lift, client }
