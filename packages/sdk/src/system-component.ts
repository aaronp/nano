/**
 * The System component: a System exposed through ops, so anything that can call and subscribe can see what is in
 * it, create and remove instances (from a catalog), connect them, and bind dependencies. It can be registered in
 * its own System, or in another (a System of Systems). Policies, pickers and editors are just components using it.
 */
import Type from 'typebox'
import { Components } from './components'
import type { SystemRuntime } from './system'
import { ComponentId, Instance, Manifest, fail, ok, type Component, type ComponentFactory, type Op } from './types'

const S = Components.declare({ author: 'composable', id: 'system' })
const NewSubscription = Type.Object({ source: Type.String(), op: Type.String(), listener: Type.String(), target: Type.Optional(Type.String()) },
  { $id: 'composable.NewSubscription', description: 'listener hears source\'s (or anyone\'s, \'*\') output op; with a target, it feeds the listener\'s target op.' })
const Sub = Type.Object({ id: Type.String(), source: Type.String(), op: Type.String(), listener: Type.String(), target: Type.Optional(Type.String()) },
  { $id: 'composable.Subscription' })
const Binding = Type.Object({ from: Type.String(), dependency: Type.String(), to: Type.String(), op: Type.String() },
  { $id: 'composable.Binding', description: 'from\'s dependency is served by to\'s op.' })
const Instances = Type.Array(Instance)

export const SystemOps = {
  instances: S.op('instances', 'The instances in this System, with their manifests', { input: Type.Null(), output: Instances }),
  changed: S.op('changed', 'Published whenever an instance is added or removed', { output: Instances }),
  definitions: S.op('definitions', 'The components this System can create', { input: Type.Null(), output: Type.Array(Manifest) }),
  create: S.op('create', 'Create and register an instance of a catalog component', {
    input: Type.Object({ component: ComponentId, name: Type.String() }), output: Type.Object({ name: Type.String() }),
  }),
  remove: S.op('remove', 'Unregister an instance (disposing it if this System created it)', { input: Type.Object({ name: Type.String() }) }),
  subscribe: S.op('subscribe', 'Open a subscription: listener hears source\'s output op (a link when it has a target)', { input: NewSubscription, output: Sub }),
  unsubscribe: S.op('unsubscribe', 'Close a subscription', { input: Type.Object({ id: Type.String() }) }),
  subscriptions: S.op('subscriptions', 'The subscriptions in place', { input: Type.Null(), output: Type.Array(Sub) }),
  subscriptionsChanged: S.op('subscriptions-changed', 'Published whenever a subscription is opened or closed', { output: Type.Array(Sub) }),
  bind: S.op('bind', 'Serve one instance\'s dependency with another\'s op', { input: Binding }),
  unbind: S.op('unbind', 'Remove a binding', { input: Type.Object({ from: Type.String(), dependency: Type.String() }) }),
  bindings: S.op('bindings', 'The bindings in place', { input: Type.Null(), output: Type.Array(Binding) }),
}

const same = (a: ComponentId, b: ComponentId) => a.author === b.author && a.id === b.id

/** A System component over `runtime`. `catalog`: the components its `create` op can make. */
export function systemComponent(runtime: SystemRuntime, opts: { catalog?: readonly ComponentFactory<any>[] } = {}): ComponentFactory {
  const catalog = opts.catalog ?? [], o = SystemOps
  const opOf = (inst: string, op: string) => runtime.snapshot().instances.find(i => i.id === inst)?.manifest.ops.find(x => x.name === op)
  const factory = S.define({
    state: () => ({ made: new Map<string, Component>() }),
    handlers: [
      [o.instances, () => ok(runtime.snapshot().instances)],
      [o.definitions, () => ok(catalog.map(f => f.manifest))],
      [o.create, async ({ component, name }, { state }) => {
        const f = catalog.find(x => same(x.manifest.id, component))
        if (!f) return fail('unknown-target', `${component.author}/${component.id} is not in this System's catalog`)
        const c = await f.create()
        const r = runtime.register(name, c)
        if (r.type !== 'success') { await c.dispose?.(); return r }
        state.made.set(name, c)
        return ok({ name })
      }],
      [o.remove, async ({ name }, { state }) => {
        const r = runtime.unregister(name)
        if (r.type !== 'success') return r
        await state.made.get(name)?.dispose?.(); state.made.delete(name)
      }],
      [o.subscribe, s => runtime.subscribe(s as never)],
      [o.unsubscribe, ({ id }) => runtime.unsubscribe(id)],
      [o.subscriptions, () => ok(runtime.snapshot().subscriptions)],
      [o.bind, (b, { state }) => {
        if (!opOf(b.to, b.op)) return fail('unknown-action', `no ${b.to} ${b.op}`)
        const r = runtime.bind(b.from, b.dependency, b.to, b.op)
        if (r.type !== 'success') return r
      }],
      [o.unbind, b => { const r = runtime.unbind(b.from, b.dependency); if (r.type === 'error') return r }],
      [o.bindings, () => ok(runtime.bindings())],
    ],
  })
  return {
    manifest: factory.manifest,
    create() {
      const m = factory.create()
      const offUpdates = runtime.updates(d => {
        if (d.type === 'added' || d.type === 'removed') void m.notify(o.changed, runtime.snapshot().instances)
        else if (d.type === 'subscription-opened' || d.type === 'subscription-closed') void m.notify(o.subscriptionsChanged, runtime.snapshot().subscriptions)
      })
      const dispose = m.dispose?.bind(m)
      m.dispose = async () => { offUpdates(); await dispose?.() }
      return m
    },
  }
}
