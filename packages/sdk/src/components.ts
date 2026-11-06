import type { Static, TFunction, TSchema } from 'typebox'
import { Scopes, type ErrorInfo } from './contexts/scope'
import {
  fail, ok, roleOf, routeProblem,
  type Component, type ComponentFactory, type ComponentId, type Context, type Created, type Input, type Invocation,
  type Manifest, type Op, type Output, type Publication, type Result, type SystemError,
} from './types'

type Handler<P extends Op, S> =
  (input: Input<P>, h: { state: S; ctx: Context; inv: Invocation }) => Result<Output<P>> | void | Promise<Result<Output<P>> | void>

/** A component made by `declare(...).define`: its state, a publish for UI-originated publications, and change notification. */
export type Model<S> = Component & {
  state: S
  /** Publish from the UI: each call starts a new correlation (it is a new trigger). */
  publish: Context['publish']
  onChange(fn: () => void): () => void
}

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
     * `handlers`: one per op that has an input (it may arrive by call or be fed from a publication); a handler's
     * `ctx` carries the correlation of what invoked it. `setup` runs once when created: use `mountContext` to react
     * to the mount, and keep `appContext` (each of its operations is a new trigger). Call `changed()` after
     * mutating state outside a handler so views re-render. What `setup` returns runs on dispose.
     */
    define<S, const H extends readonly Op[] = []>(opts: {
      state: () => S
      handlers?: { [K in keyof H]: readonly [H[K], Handler<H[K], S>] }
      setup?: (m: { state: S; mountContext: Context; appContext: Context; changed: () => void }) => void | (() => void)
    }): ComponentFactory<Model<S>> {
      const handlers = new Map((opts.handlers ?? []).map(([op, h]) => [op.name, h as Handler<Op, S>]))
      const manifest: Manifest = { id, ops: [...ops] }
      for (const op of manifest.ops) if (op.input && !handlers.has(op.name)) throw new Error(`${ns}: no handler for ${op.name}`)
      return {
        manifest,
        async create({ mountContext, appContext }) {
          const state = opts.state(), listeners = new Set<() => void>()
          const changed = () => listeners.forEach(f => f())
          const cleanup = opts.setup?.({ state, mountContext, appContext, changed })
          return {
            state,
            onChange: fn => (listeners.add(fn), () => listeners.delete(fn)),
            publish: async (op, p) => { const r = await appContext.publish(op, p); changed(); return r },
            async onAction(ctx, inv) {
              const h = handlers.get(inv.op)
              if (!h) return fail('unknown-action', `no handler for ${inv.op}`)
              const r = await h(inv.input as never, { state, ctx, inv })
              changed()
              return r ?? ok(undefined)
            },
            dispose: () => cleanup?.(),
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
export type Handle<F extends ComponentFactory<any> = ComponentFactory<any>> = (<P extends Op>(op: P) => Bound<P>) & { child: string; factory: F }
export type Builder = {
  /**
   * Add a child. `wrap` derives its context (everything it publishes, calls or subscribes to goes through it
   * first); `outer` is the composite's own context, for passing things through to the outside.
   */
  use<F extends ComponentFactory<any>>(name: string, factory: F, wrap?: (ctx: Context, outer: Context) => Context): Handle<F>
  /** Feed one child's publication into another child's op. */
  route(from: Bound, to: Bound): void
  /** Which child ops make up the composite's manifest (default: all of them). */
  expose(...ops: Op[]): void
}
export type Composite<R extends Record<string, Handle>> = Component & { children: { [K in keyof R]: Created<R[K]['factory']> } }

/**
 * One component from named children, built once when defined; every mistake throws here, not at runtime.
 * Children live in the composite's own scope, invisible from outside. Exposed ops with an input are delegated to
 * the child that has them; exposed publications are re-published as the composite's own. Correlation carries
 * across the boundary both ways. Return the handles to get typed `children`. Errors inside go to `onError`.
 */
function composite<const R extends Record<string, Handle>>(
  meta: { id: ComponentId; onError?: (e: SystemError, info: ErrorInfo) => void }, build: (c: Builder) => R,
): ComponentFactory<Composite<R>> {
  const uses: { name: string; factory: ComponentFactory<any>; wrap?: (ctx: Context, outer: Context) => Context }[] = []
  const routes: [Bound, Bound][] = []
  let shown: Op[] | undefined
  const manifestOf = (child: string) => uses.find(u => u.name === child)?.factory.manifest
  const children = build({
    use(name, factory, wrap) {
      if (uses.some(u => u.name === name)) throw new Error(`duplicate child "${name}"`)
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
  const manifest = compose(meta.id, { id: meta.id, ops: all.filter(pick) })
  const owner = new Map(uses.flatMap(u => u.factory.manifest.ops.filter(o => o.input && pick(o)).map(o => [o.name, { child: u.name, op: o }])))

  return {
    manifest,
    async create({ mountContext, appContext: outer }) {
      const inner = Scopes.create({ onError: meta.onError ?? ((e, info) => console.error(e, info)) })
      try {
        for (const u of uses) await inner.add(u.name, u.factory, { wrap: u.wrap && (c => u.wrap!(c, outer)), correlation: mountContext.correlation })
      } catch (err) { await inner.clear(); throw err }
      for (const [f, t] of routes) inner.route(f.child, f.op, t.child, t.op)
      // The composite inside its own scope: re-publishes exposed child publications outside, same correlation.
      const host = inner.context(outer.self)
      for (const u of uses) for (const op of u.factory.manifest.ops.filter(o => roleOf(o) === 'publication' && pick(o)))
        host.subscribe(op, (p, d) => outer.within(d.correlation).publish(op as Publication, p as never), { from: u.name })
      return {
        children: Object.fromEntries(Object.entries(children).map(([k, h]) => [k, inner.component(h.child)])) as Composite<R>['children'],
        onAction: (_c, inv) => {
          const o = owner.get(inv.op)!
          return host.within(inv.correlation).call(o.child, o.op as Op<TSchema>, inv.input as never)
        },
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
function client<const A extends Record<string, Op<TSchema, TSchema | undefined>>>(ctx: Context, target: string, ops: A) {
  return Object.fromEntries(Object.entries(ops).map(([k, op]) => [k, (input: unknown) => ctx.call(target, op, input as never)])) as
    { [K in keyof A]: (input: Input<A[K]>) => Promise<Result<Output<A[K]>>> }
}

export const Components = { declare, compose: composite, lift, client }
