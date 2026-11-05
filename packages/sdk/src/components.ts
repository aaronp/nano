import type { Static, TSchema } from 'typebox'
import { bus, environments } from './contexts/bus'
import {
  fail, ok, sameInstance,
  type Action, type Component, type ComponentFactory, type ComponentId, type Context, type Event,
  type Invocation, type Manifest, type Result, type SystemError,
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
/** The component a factory creates: `bus.component(ref) as Created<typeof myWidget>`. */
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

export type CompositeRoute = { from: [child: string, event: Event]; to: [child: string, action: Action] }
export type Composite<C extends Record<string, Factory>> = Component & {
  children: { [K in keyof C]: Created<C[K]> }
}

/**
 * One component from named children on a private bus. Actions addressed to it go to the child that consumes
 * them (keeping the original sender); routes wire children together; exposed child events bubble out.
 * `expose` (default: everything) picks which child events and actions make up the composite's manifest.
 * Everything is checked here, so a wiring mistake fails when the widget is built.
 */
function composite<const C extends Record<string, Factory>>(opts: Meta & {
  children: C
  routes?: CompositeRoute[]
  expose?: (Event | Action)[]
  onDeliveryError?: (e: SystemError, inv: Invocation) => void
}): Factory<Composite<C>> {
  const { children, routes = [] } = opts
  const all = compose(opts, ...Object.values(children).map(f => f.manifest))
  const has = (child: string, list: 'emits' | 'consumes', name: string) =>
    children[child]?.manifest[list].some(d => d.name === name)
  for (const { from, to } of routes) {
    if (!has(from[0], 'emits', from[1].name)) throw new Error(`route: child "${from[0]}" does not emit ${from[1].name}`)
    if (!has(to[0], 'consumes', to[1].name)) throw new Error(`route: child "${to[0]}" does not consume ${to[1].name}`)
  }
  const shown = opts.expose && new Set(opts.expose.map(d => d.name))
  for (const n of shown ?? []) if (![...all.emits, ...all.consumes].some(d => d.name === n)) throw new Error(`expose: no child has ${n}`)
  const manifest: Manifest = shown
    ? { ...all, emits: all.emits.filter(e => shown.has(e.name)), consumes: all.consumes.filter(a => shown.has(a.name)) }
    : all
  const owner = new Map(Object.entries(children).flatMap(([n, f]) => f.manifest.consumes.map(a => [a.name, n])))
  const bubbles = new Set(manifest.emits.map(e => e.name))

  return {
    manifest,
    async create(ctx, self) {
      // ponytail: inner delivery errors default to console; thread the host's handler through Context if one is needed.
      const inner = bus({ self, parent: ctx, onDeliveryError: opts.onDeliveryError ?? ((e, inv) => console.error(e, inv)) })
      const ref = (name: string) => ({ namespace: [...self.namespace, self.instance], instance: name })
      const bubble = (c: Context): Context => ({
        ...c,
        emit: async (e, p, s) => {
          const r = await c.emit(e, p, s)
          return r.type === 'success' && bubbles.has(e.name) ? ctx.emit(e, p, s) : r
        },
      })
      try { for (const [name, f] of Object.entries(children)) await inner.register(f, name, bubble) }
      catch (e) { for (const i of inner.instances()) await inner.unregister(i); throw e }
      for (const { from, to } of routes)
        inner.route({ from: { instance: ref(from[0]), event: from[1].name }, to: { instance: ref(to[0]), action: to[1].name } })

      const component: Composite<C> = {
        children: Object.fromEntries(Object.keys(children).map(n => [n, inner.component(ref(n))])) as Composite<C>['children'],
        // Addressed to us: delegate by action name. Addressed deeper (a hop): pass it down. Either way keep the sender.
        onAction: (_c, inv) => inner.callFrom(inv.from,
          sameInstance(inv.target, self) ? ref(owner.get(inv.action)!) : inv.target, inv.action, inv.input, { stack: [...inv.stack, inv] }),
        dispose: async () => { for (const i of inner.instances()) await inner.unregister(i) },
      }
      environments.set(component, () => inner.capabilities().environment)
      return component
    },
  }
}

export const Components = { declare, compose: composite }
