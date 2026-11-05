import { AsyncLocalStorage } from 'node:async_hooks'
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

type Entry = { instance: Instance; component: Component & { dispose?(): void | Promise<void> } }
type BusInternals = { emitFrom(from: Instance, event: string, payload: unknown, scope?: Scope): Promise<Result<void>> }

// Component.onAction receives only the invocation, so the scope (stack) a handler's
// emits/calls inherit travels via async context: set around each delivery, read in child.emit.
const current = new AsyncLocalStorage<{ owner: InstanceRef; stack: Invocation[] }>()

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
  const reportError = (e: SystemError, inv: Invocation) => opts.onDeliveryError?.(e, inv)

  const deliver = (inv: Invocation) => {
    const err = (code: SystemError['code'], message: string) => reportError({ code, message }, inv)
    const target = find(inv.target)
    if (!target) return err('unknown-target', `no instance ${inv.target.instance}`)
    const def = target.instance.manifest.consumes.find(a => a.name === inv.action)
    if (!def) return err('unknown-action', `no action ${inv.action}`)
    if (!Value.Check(def.input, inv.input)) return err('validation', `payload invalid for ${inv.action}`)
    const store = { owner: inv.target, stack: [...inv.stack, inv] }
    // Deliver without awaiting; sync throws and rejections both become 'handler'.
    Promise.resolve().then(() => current.run(store, () => target.component.onAction(inv)))
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
      if (entries.some(e => e.instance.instance === instance)) throw new Error(`duplicate instance ${instance}`)
      const inst: Instance = {
        namespace: [...opts.self.namespace, opts.self.instance], instance, manifest: factory.manifest,
      }
      const ctx = (wrap ?? (c => c))(child(self, inst))
      const component = await factory.create(ctx, inst)
      entries.push({ instance: inst, component })
      return inst
    },
    async unregister(ref) {
      const i = entries.findIndex(e => sameInstance(e.instance, ref))
      if (i < 0) return
      const [e] = entries.splice(i, 1)
      routes = routes.filter(r => !sameInstance(r.from.instance, ref) && !sameInstance(r.to.instance, ref))
      await e.component.dispose?.()
    },
    route(r) { if (!routes.some(x => sameRoute(x, r))) routes.push(r) },
    unroute(r) { routes = routes.filter(x => !sameRoute(x, r)) },
    instances: () => entries.map(e => e.instance),
  }
  return self
}

export function child(b: BusContext, self: Instance): Context {
  const inner = b as BusContext & BusInternals
  // Explicit scope wins; otherwise inherit the stack of the delivery this code is running inside.
  const scopeOf = (s?: Scope) => s ?? (() => {
    const cur = current.getStore()
    return cur && sameInstance(cur.owner, self) ? { stack: cur.stack } : undefined
  })()
  return {
    capabilities: () => b.capabilities(),
    emit: (event, payload, scope) => inner.emitFrom(self, event, payload, scopeOf(scope)),
    call: (target, action, input, scope) => b.call(target, action, input, scopeOf(scope)),
  }
}
