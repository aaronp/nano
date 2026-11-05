import Value from 'typebox/value'
import {
  fail, ok, sameInstance,
  type ActionRef, type Component, type ComponentFactory, type Context, type EventRef, type Instance,
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
}

type Entry = { instance: Instance; component: Component; ctx: Context; dead: boolean }
type BusInternals = { emitFrom(from: Instance, event: string, payload: unknown, scope?: Scope): Promise<Result<void>> }

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

  const deliver = (inv: Invocation) => {
    const err = (code: SystemError['code'], message: string) => reportError({ code, message }, inv)
    const target = find(inv.target)
    if (!target) return err('unknown-target', `no instance ${inv.target.instance}`)
    const def = target.instance.manifest.consumes.find(a => a.name === inv.action)
    if (!def) return err('unknown-action', `no action ${inv.action}`)
    if (!Value.Check(def.input, inv.input)) return err('validation', `payload invalid for ${inv.action}`)
    const scope = { stack: [...inv.stack, inv] }
    const scopedCtx: Context = {
      capabilities: () => target.ctx.capabilities(),
      emit: (e, p) => target.ctx.emit(e, p, scope),
      call: (t, a, i) => target.ctx.call(t, a, i, scope),
    }
    // Deliver without awaiting; sync throws and rejections both become 'handler'.
    Promise.resolve().then(() => {
      if (find(inv.target) !== target) { err('unknown-target', `instance ${inv.target.instance} was unregistered`); return }
      return target.component.onAction(scopedCtx, inv)
    })
      .catch(e => err('handler', String(e?.message ?? e)))
  }

  const self: BusContext & BusInternals = {
    self: opts.self,
    capabilities: () => ({
      environment: { type: 'leaf', instance: opts.self },
      events: { type: 'all' }, actions: { type: 'all' },
    }),
    emit: (event, payload, scope) => self.emitFrom(opts.self, event, payload, scope),
    // ponytail: call routing arrives in Task 3.
    call: async (target, action) => fail('unknown-target', `call not implemented: ${target.instance}.${action}`),

    async emitFrom(from, event, payload, scope) {
      const def = from.manifest.emits.find(e => e.name === event)
      if (!def) return fail('validation', `unknown event ${event}`)
      if (!Value.Check(def.schema, payload)) return fail('validation', `payload invalid for ${event}`)
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
      await e.component.dispose()
    },
    route(r) { if (!routes.some(x => sameRoute(x, r))) routes.push(r) },
    unroute(r) { routes = routes.filter(x => !sameRoute(x, r)) },
    instances: () => entries.map(e => e.instance),
  }
  return self
}

const gone = (self: Instance) => fail('unknown-target', `instance ${self.instance} is unregistered`)

export function child(b: BusContext, self: Instance, alive: () => boolean = () => true): Context {
  const inner = b as BusContext & BusInternals
  return {
    capabilities: () => b.capabilities(),
    emit: async (event, payload, scope) => alive() ? inner.emitFrom(self, event, payload, scope) : gone(self),
    call: async (target, action, input, scope) => alive() ? b.call(target, action, input, scope) : gone(self),
  }
}
