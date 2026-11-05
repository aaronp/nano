import Value from 'typebox/value'
import { context, scoped } from '../context'
import {
  fail, ok, sameInstance,
  type Called, type Component, type ComponentFactory, type Context, type Emitted, type Environment,
  type Host, type Instance, type InstanceRef, type Invocation, type Result, type Route, type SystemError,
} from '../types'

/** The host's own context plus the registry of running instances and the routes between them. */
export type Registry = Context & Host & {
  unregister(ref: InstanceRef): Promise<void>
  unroute(r: Route): void
  instances(): Instance[]
}

type Entry = { instance: Instance; ctx: Context; component?: Component } // no component while being created

const path = (r: InstanceRef) => [...r.namespace, r.instance]
const key = (r: InstanceRef) => JSON.stringify(path(r))
/** `r` is strictly inside `ancestor`'s subtree. */
const inside = (r: InstanceRef, ancestor: InstanceRef) => {
  const p = path(ancestor)
  return r.namespace.length >= p.length && p.every((n, i) => r.namespace[i] === n)
}
const sameRoute = (a: Route, b: Route) =>
  sameInstance(a.from.instance, b.from.instance) && a.from.event === b.from.event &&
  sameInstance(a.to.instance, b.to.instance) && a.to.action === b.to.action
const gone = (i: Instance) => fail('unknown-target', `instance ${i.instance} is unregistered`)

/**
 * One flat registry for a whole tree of instances. `call` looks the target up and invokes it; `emit` delivers to
 * routed targets. Containers add children through the `Host` their factory receives, under their own path.
 */
export function registry(opts: {
  self: Instance; maxDepth?: number
  onDeliveryError?: (e: SystemError, inv: Invocation) => void
}): Registry {
  const entries = new Map<string, Entry>()
  let routes: Route[] = []
  const maxDepth = opts.maxDepth ?? 16
  const live = (e: Entry) => entries.get(key(e.instance)) === e && !!e.component
  const report = (e: SystemError, inv: Invocation) => { try { opts.onDeliveryError?.(e, inv) } catch {} }
  // Failures produced here (vs. returned by a handler); only these reach onDeliveryError from a delivery.
  const own = new WeakSet<object>()
  const bad = (code: SystemError['code'], message: string) => { const r = fail(code, message); own.add(r); return r }

  async function invoke(inv: Invocation): Promise<Result<unknown>> {
    if (inv.stack.length >= maxDepth) {
      const r = bad('loop', `depth ${inv.stack.length} reached max ${maxDepth}`)
      if (r.type === 'error') report(r.error, inv)
      return r
    }
    const e = entries.get(key(inv.target))
    if (!e?.component) return bad('unknown-target', `no instance ${inv.target.instance}`)
    const def = e.instance.manifest.consumes.find(a => a.name === inv.action)
    if (!def) return bad('unknown-action', `no action ${inv.action}`)
    if (!Value.Check(def.input, inv.input)) return bad('validation', `payload invalid for ${inv.action}`)
    try {
      await Promise.resolve() // let the caller finish before the handler runs
      if (!live(e)) return bad('unknown-target', `instance ${e.instance.instance} was unregistered`)
      const r = await e.component.onAction(scoped(e.ctx, [...inv.stack, inv]), inv)
      if (def.output && r.type === 'success' && !Value.Check(def.output, r.data)) return bad('validation', `output invalid for ${inv.action}`)
      return r
    } catch (err: any) { return bad('handler', String(err?.message ?? err)) }
  }

  const call = (from: Instance, c: Called) =>
    invoke({ id: crypto.randomUUID(), from, target: c.target, action: c.action.name, input: c.input, stack: c.scope.stack })

  const parentOf = (i: Instance) =>
    i.namespace.length ? entries.get(key({ namespace: i.namespace.slice(0, -1), instance: i.namespace.at(-1)! }))?.instance : undefined

  async function emit(from: Instance, em: Emitted): Promise<Result<void>> {
    const name = em.event.name
    const def = from.manifest.emits.find(e => e.name === name)
    if (!def) return fail('validation', `unknown event ${name}`)
    if (!Value.Check(def.schema, em.payload)) return fail('validation', `payload invalid for ${name}`)
    // Deliver from the emitter, then from each enclosing container that re-exposes the event in its manifest.
    for (let src: Instance | undefined = from; src?.manifest.emits.some(e => e.name === name); src = parentOf(src)) {
      for (const r of routes) {
        if (r.from.event !== name || !sameInstance(r.from.instance, src)) continue
        const inv: Invocation = { id: crypto.randomUUID(), from: src, target: r.to.instance, action: r.to.action, input: em.payload, stack: em.scope.stack }
        void invoke(inv).then(res => { if (res.type === 'error' && own.has(res)) report(res.error, inv) })
      }
    }
    return ok(undefined)
  }

  const environment = (i: Instance): Environment => {
    const kids = [...entries.values()]
      .filter(e => e.component && e.instance.namespace.length === path(i).length && inside(e.instance, i))
      .map(e => environment(e.instance))
    return kids.length || i === opts.self ? { type: 'node', instance: i, children: kids } : { type: 'leaf', instance: i }
  }
  const capabilities = () => ({ environment: environment(opts.self), events: { type: 'all' as const }, actions: { type: 'all' as const } })

  async function register(parent: Instance, factory: ComponentFactory, name: string, wrap?: (c: Context) => Context) {
    const instance: Instance = { namespace: path(parent), instance: name, manifest: factory.manifest }
    if (entries.has(key(instance))) throw new Error(`duplicate instance ${name}`)
    const entry: Entry = { instance, ctx: undefined! }
    entries.set(key(instance), entry)
    try {
      entry.ctx = (wrap ?? (c => c))(context({
        self: instance, capabilities,
        emit: e => live(entry) ? emit(instance, e) : Promise.resolve(gone(instance)),
        call: c => live(entry) ? call(instance, c) : Promise.resolve(gone(instance)),
      }))
      entry.component = await factory.create(entry.ctx, instance, hostFor(instance))
      return instance
    } catch (e) { await unregister(instance); throw e }
  }

  /** Removes the instance and everything under it (children first), with their routes. */
  async function unregister(ref: InstanceRef) {
    const doomed = [...entries.values()]
      .filter(e => sameInstance(e.instance, ref) || inside(e.instance, ref))
      .sort((a, b) => b.instance.namespace.length - a.instance.namespace.length)
    for (const e of doomed) entries.delete(key(e.instance))
    const hit = (r: InstanceRef) => doomed.some(d => sameInstance(d.instance, r))
    routes = routes.filter(r => !hit(r.from.instance) && !hit(r.to.instance))
    for (const e of doomed) await e.component?.dispose?.()
  }

  const route = (r: Route) => { if (!routes.some(x => sameRoute(x, r))) routes.push(r) }
  const hostFor = (self: Instance): Host => ({
    register: (f, name, wrap) => register(self, f, name, wrap),
    route: r => {
      if (!inside(r.from.instance, self) || !inside(r.to.instance, self)) throw new Error(`route outside ${self.instance}`)
      route(r)
    },
    component: ref => inside(ref, self) ? entries.get(key(ref))?.component : undefined,
  })

  const ctx = context({ self: opts.self, capabilities, emit: e => emit(opts.self, e), call: c => call(opts.self, c) })
  return Object.assign(ctx, {
    register: (f: ComponentFactory, name: string, wrap?: (c: Context) => Context) => register(opts.self, f, name, wrap),
    unregister,
    route,
    unroute: (r: Route) => { routes = routes.filter(x => !sameRoute(x, r)) },
    instances: () => [...entries.values()].filter(e => e.component).map(e => e.instance),
    component: (ref: InstanceRef) => entries.get(key(ref))?.component,
  })
}

