import Value from 'typebox/value'
import {
  fail, ok, sameInstance,
  type ActionRef, type Component, type ComponentFactory, type Context, type Environment, type EventRef, type Instance,
  type InstanceRef, type Invocation, type Result, type Scope, type SystemError,
} from '../types'

export type Route = { from: EventRef; to: ActionRef }
export interface BusContext extends Context {
  readonly self: Instance
  register(factory: ComponentFactory, instance: string, wrap?: (c: Context) => Context): Promise<Instance>
  unregister(ref: InstanceRef): Promise<void>
  route(r: Route): void
  unroute(r: Route): void
  instances(): Instance[]
  component(ref: InstanceRef): Component | undefined
}

/** Components that host their own bus report their subtree here (see Components.compose). */
export const environments = new WeakMap<Component, () => Environment>()

type Entry = { instance: Instance; component: Component; ctx: Context; dead: boolean }
type BusInternals = {
  emitFrom(from: Instance, event: string, payload: unknown, scope?: Scope): Promise<Result<void>>
  callFrom(from: Instance, target: InstanceRef, action: string, input: unknown, scope?: Scope): Promise<Result<unknown>>
}

const sameRoute = (a: Route, b: Route) =>
  sameInstance(a.from.instance, b.from.instance) && a.from.event === b.from.event &&
  sameInstance(a.to.instance, b.to.instance) && a.to.action === b.to.action

export function bus(opts: {
  self: Instance; parent?: Context; maxDepth?: number
  onDeliveryError?: (e: SystemError, inv: Invocation) => void
}): BusContext & BusInternals {
  const entries: Entry[] = []
  let routes: Route[] = []
  const find = (ref: InstanceRef) => entries.find(e => sameInstance(e.instance, ref))
  const reserved = new Set<string>()
  // A throwing observer must never escape emit.
  const reportError = (e: SystemError, inv: Invocation) => { try { opts.onDeliveryError?.(e, inv) } catch {} }

  // Failures produced by the bus itself (vs. returned by a handler); only these reach onDeliveryError.
  const own = new WeakSet<object>()
  const bad = (code: SystemError['code'], message: string) => { const r = fail(code, message); own.add(r); return r }
  const childNs = [...opts.self.namespace, opts.self.instance]
  const maxDepth = opts.maxDepth ?? 16

  // Awaited delivery. `hop` = host to hand a deeper target to (input is validated by the final target).
  const invoke = async (inv: Invocation, hop?: InstanceRef): Promise<Result<unknown>> => {
    const target = find(hop ?? inv.target)
    if (!target) return bad('unknown-target', `no instance ${(hop ?? inv.target).instance}`)
    const def = hop ? undefined : target.instance.manifest.consumes.find(a => a.name === inv.action)
    if (!hop) {
      if (!def) return bad('unknown-action', `no action ${inv.action}`)
      if (!Value.Check(def.input, inv.input)) return bad('validation', `payload invalid for ${inv.action}`)
    }
    const scope = { stack: [...inv.stack, inv] }
    const scopedCtx: Context = {
      capabilities: () => target.ctx.capabilities(),
      emit: (e, p) => target.ctx.emit(e, p, scope),
      call: (t, a, i) => target.ctx.call(t, a, i, scope),
    }
    try {
      await Promise.resolve() // let the caller finish before the handler runs
      if (find(hop ?? inv.target) !== target) return bad('unknown-target', `instance ${target.instance.instance} was unregistered`)
      const r = await target.component.onAction(scopedCtx, inv)
      if (def?.output && r.type === 'success' && !Value.Check(def.output, r.data))
        return bad('validation', `output invalid for ${inv.action}`)
      return r
    } catch (e: any) { return bad('handler', String(e?.message ?? e)) }
  }
  // Fire-and-forget (emit): bus-originated failures go to onDeliveryError.
  const deliver = (inv: Invocation) => {
    void invoke(inv).then(r => { if (r.type === 'error' && own.has(r)) reportError(r.error, inv) })
  }
  const loopGuard = (inv: Invocation) => {
    if (inv.stack.length < maxDepth) return undefined
    const r = bad('loop', `depth ${inv.stack.length} reached max ${maxDepth}`)
    if (r.type === 'error') reportError(r.error, inv)
    return r
  }

  const self: BusContext & BusInternals = {
    self: opts.self,
    capabilities: () => ({
      environment: {
        type: 'node', instance: opts.self,
        children: entries.map(e => environments.get(e.component)?.() ?? { type: 'leaf' as const, instance: e.instance }),
      },
      events: { type: 'all' }, actions: { type: 'all' },
    }),
    emit: (event, payload, scope) => self.emitFrom(opts.self, event.name, payload, scope),
    call: (target, action, input, scope) => self.callFrom(opts.self, target, action, input, scope),

    async callFrom(from, target, action, input, scope) {
      const inv: Invocation = { id: crypto.randomUUID(), from, target, action, input, stack: scope?.stack ?? [] }
      const loop = loopGuard(inv)
      if (loop) return loop
      const t = target.namespace
      const under = t.length >= childNs.length && childNs.every((n, i) => n === t[i])
      if (under && t.length === childNs.length) return invoke(inv)
      if (under) return invoke(inv, { namespace: childNs, instance: t[childNs.length] })
      if (opts.parent) return opts.parent.call(target, action, input, scope)
      return fail('unknown-target', `no route to ${target.instance}`)
    },

    async emitFrom(from, event, payload, scope) {
      const def = from.manifest.emits.find(e => e.name === event)
      if (!def) return fail('validation', `unknown event ${event}`)
      if (!Value.Check(def.schema, payload)) return fail('validation', `payload invalid for ${event}`)
      const guard = loopGuard({ id: crypto.randomUUID(), from, target: from, action: event, input: payload, stack: scope?.stack ?? [] })
      if (guard) return guard
      for (const r of routes) {
        if (r.from.event !== event || !sameInstance(r.from.instance, from)) continue
        deliver({
          id: crypto.randomUUID(), from, target: r.to.instance, action: r.to.action,
          input: payload, stack: scope?.stack ?? [],
        })
      }
      return ok(undefined)
    },

    async register(factory, instance, wrap) {
      if (reserved.has(instance)) throw new Error(`duplicate instance ${instance}`)
      reserved.add(instance)
      try {
        const inst: Instance = {
          namespace: [...opts.self.namespace, opts.self.instance], instance, manifest: factory.manifest,
        }
        let entry: Entry | undefined
        const ctx = (wrap ?? (c => c))(child(self, inst, () => !!entry && !entry.dead))
        const component = await factory.create(ctx, inst)
        entries.push(entry = { instance: inst, component, ctx, dead: false })
        return inst
      } catch (e) { reserved.delete(instance); throw e }
    },
    async unregister(ref) {
      const i = entries.findIndex(e => sameInstance(e.instance, ref))
      if (i < 0) return
      const [e] = entries.splice(i, 1)
      e.dead = true; reserved.delete(ref.instance)
      routes = routes.filter(r => !sameInstance(r.from.instance, ref) && !sameInstance(r.to.instance, ref))
      await e.component.dispose?.()
    },
    route(r) { if (!routes.some(x => sameRoute(x, r))) routes.push(r) },
    unroute(r) { routes = routes.filter(x => !sameRoute(x, r)) },
    instances: () => entries.map(e => e.instance),
    component: ref => find(ref)?.component,
  }
  return self
}

const gone = (self: Instance) => fail('unknown-target', `instance ${self.instance} is unregistered`)

export function child(b: BusContext, self: Instance, alive: () => boolean = () => true): Context {
  const inner = b as BusContext & BusInternals
  return {
    capabilities: () => b.capabilities(),
    emit: async (event, payload, scope) => alive() ? inner.emitFrom(self, event.name, payload, scope) : gone(self),
    call: async (target, action, input, scope) => alive() ? inner.callFrom(self, target, action, input, scope) : gone(self),
  }
}
