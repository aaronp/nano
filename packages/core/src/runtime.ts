// Invokes actions and publishes events by coordinate, over one registry. Wrap it with a Policy to change the rules.
import { Type, type TSchema } from 'typebox'
import { Value } from 'typebox/value'
import { Components, type Instance } from './component'
import { DeltaSchemas, err, isOk, Ops, SubscriptionSchema, type Coord, type Delta, type Op, type Event, type Result, type Subscription } from './data'
import type { Environment } from './env'
import { SnapshotSchema, type Registry } from './registry'

/** Calls and publishes by name within one registry. In-process, remote or policy-checked, it is these two functions. */
export type Runtime = {
  registry: Registry
  call(from: Coord, target: string, op: string, arg: unknown): Promise<Result>
  /** Outer Result: was the publish allowed. Inner: one Result per delivery. */
  notify(e: Event): Promise<Result<Result[]>>
  /** Tells `fn` about every call, publish and delivery as it ends. Returns a function that stops telling it. */
  listen(fn: (t: Trace) => void): () => void
}

/** One message through a runtime, as data: what a histogram, a live wire view or a replay is built from. */
export type Trace =
  | { kind: 'call'; time: number; from: Coord; target: string; op: string; data: unknown; result: Result }
  | { kind: 'publish'; time: number; from: Coord; op: string; data: unknown; result: Result<Result[]> }
  | { kind: 'delivery'; time: number; from: Coord; target: string; op: string; data: unknown; subscription: string; result: Result }

/** Rules around a runtime: takes the runtime and returns one that enforces them. */
export type Policy = (inner: Runtime) => Runtime


/** The registry's own ops: change it, read it, and the changes it publishes. */
export const RegistryOps = {
  add: Ops.action('composable', 'add', Type.Object({ id: Type.String({ description: 'The id to add it as', examples: ['ex-range'] }), instance: Type.Unknown({ description: 'A made instance (Components.instantiate)' }) }),
    Type.Void(), { description: 'Adds an instance to the registry' }),
  replace: Ops.action('composable', 'replace', Type.Object({ id: Type.String({ description: 'The id in use', examples: ['ex-range'] }), instance: Type.Unknown({ description: 'A made instance to put there (Components.instantiate)' }) }),
    Type.Void(), { description: 'Puts an instance at an id in use, keeping its subscriptions' }),
  remove: Ops.action('composable', 'remove', Type.String({ description: 'The instance id', examples: ['ex-range'] }), Type.Void(), { description: 'Removes an instance, closing the subscriptions it listens on' }),
  subscribe: Ops.action('composable', 'subscribe', Type.Omit(SubscriptionSchema, ['id']), SubscriptionSchema, { description: 'Connects a published op to an action' }),
  unsubscribe: Ops.action('composable', 'unsubscribe', Type.String({ description: 'The subscription id' }), Type.Void(), { description: 'Closes a subscription' }),
  snapshot: Ops.action('composable', 'snapshot', Type.Null({ description: 'Nothing' }), SnapshotSchema, { description: 'What the registry holds now' }),
  deltas: Object.fromEntries(Object.entries(DeltaSchemas).map(([d, s]) => [d, Ops.source('composable', d, s, { description: (s as { description?: string }).description })])) as unknown as Record<Delta['type'], Op<undefined, TSchema>>,
}

const must = <A>(r: Result<A>): A => { if (!isOk(r)) throw new Error(r.error); return r.value }

/** The registry, lifted like any other component, so it can be called and watched. */
function registryComponent(registry: Registry) {
  const c = Components.create({ ns: 'composable', name: 'registry' }, () => registry)
  c.action(RegistryOps.add, (r, a) => must(r.add(a.id, a.instance as Instance)))
  c.action(RegistryOps.replace, (r, a) => must(r.replace(a.id, a.instance as Instance)))
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
  const listeners = new Set<(t: Trace) => void>()
  // an observer can't change what happens: its error is reported, never thrown into the call or the delivery loop
  const tell = (t: Trace) => listeners.forEach(fn => { try { fn(t) } catch (e) { reportError(e) } })
  /** Runs `op` on `target`: the lookup and input check every call and delivery share. */
  const run = async (target: string, op: string, arg: unknown): Promise<Result> => {
    const inst = registry.get(target), a = inst?.actions.get(op)
    if (!inst || !a) return err(inst ? `unknown op ${op}` : `no instance ${target} in ${registry.id}`)
    if (a.op.input && !Value.Check(a.op.input, arg)) return err(`invalid input for ${op}`)
    return Components.invoke(inst, op, arg)
  }
  const base: Runtime = {
    registry,
    async call(from, target, op, arg) {
      const result = await run(target, op, arg)
      tell({ kind: 'call', time: Date.now(), from, target, op, data: arg, result })
      return result
    },
    listen(fn) { listeners.add(fn); return () => { listeners.delete(fn) } },
    async notify(e) {
      const a = registry.get(e.from.instance)?.actions.get(e.op)
      const refuse = (error: string) => {   // a refused publish is traced too, with its error
        const result = err(error)
        tell({ kind: 'publish', time: Date.now(), from: e.from, op: e.op, data: e.data, result })
        return result
      }
      if (e.from.registry !== registry.id || !a) return refuse(`${e.from.instance} does not publish ${e.op} in ${registry.id}`)
      if (a.op.output && !Value.Check(a.op.output, e.data)) return refuse(`invalid data for ${e.op}`)
      const results: Result[] = []   // a delivery is a call: same lookup, same input check
      for (const s of registry.matching(e.from.instance, e.op)) {
        const result = await run(s.listener, s.target, e.data)
        tell({ kind: 'delivery', time: Date.now(), from: e.from, target: s.listener, op: s.target, data: e.data, subscription: s.id, result })
        results.push(result)
      }
      const result = { value: results }
      tell({ kind: 'publish', time: Date.now(), from: e.from, op: e.op, data: e.data, result })
      return result
    },
  }
  const outer = policy ? policy(base) : base
  const envs = new Map<string, Environment>()
  /** Gives the instance at `id` its handle on this runtime. */
  const attach = (id: string) => {
    const env = registry.get(id)!.env, coord = at(id)
    envs.set(id, env)
    env.added(
      { coord, notify: (op, data, correlation) => outer.notify({ from: coord, op: Ops.key(op), data, correlation }), call: (t, op, arg) => outer.call(coord, t, Ops.key(op), arg) },
      (type, op) => { registry.announce(id, type, op) },
    )
  }
  registry.listen(d => {
    if (d.type === 'instance-added') attach(d.instance)
    if (d.type === 'instance-replaced') { envs.get(d.instance)?.removed(at(d.instance)); attach(d.instance) }
    if (d.type === 'instance-removed') { envs.get(d.instance)?.removed(at(d.instance)); envs.delete(d.instance) }
    void outer.notify({ from: at('registry'), op: `composable/${d.type}`, data: d })
  })
  registry.add('registry', Components.instantiate(registryComponent(registry)))
  return outer
}

/** Makes runtimes. */
export const Runtimes = { create }
