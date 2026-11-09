// Invokes actions and publishes events by coordinate, over one registry. Wrap it with a Policy to change the rules.
import { Type } from 'typebox'
import { Value } from 'typebox/value'
import { Components, type Instance } from './component'
import { err, isOk, Ops, type Coord, type Delta, type Event, type Result, type Subscription } from './data'
import type { Environment } from './env'
import type { Registry } from './registry'

/** Calls and publishes by name within one registry. In-process, remote or policy-checked, it is these two functions. */
export type Runtime = {
  registry: Registry
  call(from: Coord, target: string, op: string, arg: unknown): Promise<Result>
  /** Outer Result: was the publish allowed. Inner: one Result per delivery. */
  notify(e: Event): Promise<Result<Result[]>>
}

/** Rules around a runtime: takes the runtime and returns one that enforces them. */
export type Policy = (inner: Runtime) => Runtime

const any = Type.Unknown()
const deltas = ['instance-added', 'instance-removed', 'op-added', 'op-removed', 'subscription-opened', 'subscription-closed'] as const

/** The registry's own ops: change it, read it, and the changes it publishes. */
export const RegistryOps = {
  add: Ops.action('composable', 'add', Type.Object({ id: Type.String(), instance: any }), any),
  remove: Ops.action('composable', 'remove', Type.String(), any),
  subscribe: Ops.action('composable', 'subscribe', Type.Object({ source: Type.String(), op: Type.String(), listener: Type.String(), target: Type.String() }), any),
  unsubscribe: Ops.action('composable', 'unsubscribe', Type.String(), any),
  snapshot: Ops.action('composable', 'snapshot', Type.Null(), any),
  deltas: Object.fromEntries(deltas.map(d => [d, Ops.source('composable', d, any)])) as Record<Delta['type'], ReturnType<typeof Ops.source<typeof any>>>,
}

const must = <A>(r: Result<A>): A => { if (!isOk(r)) throw new Error(r.error); return r.value }

/** The registry, lifted like any other component, so it can be called and watched. */
function registryComponent(registry: Registry) {
  const c = Components.create({ ns: 'composable', name: 'registry' }, () => registry)
  c.action(RegistryOps.add, (r, a) => must(r.add(a.id, a.instance as Instance)))
  c.action(RegistryOps.remove, (r, id) => must(r.remove(id)))
  c.action(RegistryOps.subscribe, (r, s) => must(r.subscribe(s)) as Subscription)
  c.action(RegistryOps.unsubscribe, (r, id) => must(r.unsubscribe(id)))
  c.action(RegistryOps.snapshot, r => r.snapshot())
  for (const op of Object.values(RegistryOps.deltas)) c.action(op)
  return c
}

/** Makes the runtime for a registry, adds the registry to itself as 'registry', and publishes its changes. */
function create(registry: Registry, policy?: Policy): Runtime {
  if (registry.get('registry')) throw new Error(`registry ${registry.id} already has a runtime`)
  const at = (instance: string): Coord => ({ registry: registry.id, instance })
  const base: Runtime = {
    registry,
    async call(_from, target, op, arg) {
      const inst = registry.get(target), a = inst?.actions.get(op)
      if (!inst || !a) return err(inst ? `unknown op ${op}` : `no instance ${target} in ${registry.id}`)
      if (a.op.input && !Value.Check(a.op.input, arg)) return err(`invalid input for ${op}`)
      return Components.invoke(inst, op, arg)
    },
    async notify(e) {
      const a = registry.get(e.from.instance)?.actions.get(e.op)
      if (e.from.registry !== registry.id || !a) return err(`${e.from.instance} does not publish ${e.op} in ${registry.id}`)
      if (a.op.output && !Value.Check(a.op.output, e.data)) return err(`invalid data for ${e.op}`)
      const results: Result[] = []   // a delivery is a call: same lookup, same input check
      for (const s of registry.matching(e.from.instance, e.op)) results.push(await base.call(e.from, s.listener, s.target, e.data))
      return { value: results }
    },
  }
  const outer = policy ? policy(base) : base
  const envs = new Map<string, Environment>()
  registry.listen(d => {
    if (d.type === 'instance-added') {
      const env = registry.get(d.instance)!.env, coord = at(d.instance)
      envs.set(d.instance, env)
      env.added(
        { coord, notify: (op, data, correlation) => outer.notify({ from: coord, op: Ops.key(op), data, correlation }), call: (t, op, arg) => outer.call(coord, t, Ops.key(op), arg) },
        (type, op) => { registry.announce(d.instance, type, op) },
      )
    }
    if (d.type === 'instance-removed') { envs.get(d.instance)?.removed(at(d.instance)); envs.delete(d.instance) }
    void outer.notify({ from: at('registry'), op: `composable/${d.type}`, data: d })
  })
  registry.add('registry', Components.instantiate(registryComponent(registry)))
  return outer
}

/** Makes runtimes. */
export const Runtimes = { create }
