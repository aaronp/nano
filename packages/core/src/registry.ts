// One place holding instances by id, and the subscriptions between them. Data only: it never runs an action.
import type { Instance } from './component'
import { Type, type Static } from 'typebox'
import { err, ok, Ops, OwnerSchema, SubscriptionSchema, type Delta, type Op, type Owner, type Result, type Subscription } from './data'

// ops are data with schemas inside: described, not checked; typed as Op
const OpSchema = Type.Unsafe<Op>(Type.Unknown({ description: 'An op: its ns, name, input and output schemas, and description' }))

/** What a registry holds, as plain data. `component` is the instance's component id, `ns/name`. */
export const SnapshotSchema = Type.Object({
  id: Type.String({ description: 'The registry id', examples: ['host'] }),
  instances: Type.Array(Type.Object({
    id: Type.String({ description: 'The instance id', examples: ['ex-range'] }),
    component: Type.String({ description: 'Its component id, ns/name', examples: ['composable.bundle/range'] }),
    description: Type.Optional(Type.String({ description: "Its component's description" })),
    owner: Type.Optional(OwnerSchema),
    ops: Type.Array(OpSchema, { description: 'What it offers' }),
  }), { description: 'Every instance, in the order added' }),
  subscriptions: Type.Array(SubscriptionSchema, { description: 'Every subscription' }),
}, { title: 'Snapshot', description: 'What a registry holds' })
export type Snapshot = Static<typeof SnapshotSchema>

/** Stores instances and subscriptions, and tells its listeners about every change as a Delta. */
export type Registry = {
  id: string
  get(id: string): Instance | undefined
  /** `owner` belongs to this entry: one instance shared by two registries can have a different owner in each. */
  add(id: string, inst: Instance, owner?: Owner): Result<void>
  /** Puts `inst` at an id already in use, keeping its subscriptions and (unless `owner` is given) its owner. */
  replace(id: string, inst: Instance, owner?: Owner): Result<void>
  remove(id: string): Result<void>
  subscribe(s: Omit<Subscription, 'id'>): Result<Subscription>
  unsubscribe(id: string): Result<void>
  /** The subscriptions a publish of `op` by `source` reaches. */
  matching(source: string, op: string): Subscription[]
  snapshot(): Snapshot
  /** Records that an instance's ops changed; refused for an unknown instance. */
  announce(instance: string, type: 'op-added' | 'op-removed', op: Op): Result<void>
  listen(fn: (d: Delta) => void): () => void
}

/** Makes an empty registry. */
export const Registries = {
  create(id: string): Registry {
    const instances = new Map<string, Instance>(), owners = new Map<string, Owner>(), subs = new Map<string, Subscription>()
    const listeners = new Set<(d: Delta) => void>()
    // subscriptions by `source op`, so a publish looks at its matches only; seq keeps them in subscription order
    const index = new Map<string, Set<Subscription>>(), seq = new Map<Subscription, number>()
    let n = 0
    const bucket = (source: string, op: string) => index.get(`${source} ${op}`) ?? index.set(`${source} ${op}`, new Set()).get(`${source} ${op}`)!
    const emit = (d: Delta) => listeners.forEach(fn => fn(d))
    const keys = (inst: Instance) => [...inst.actions.keys()]
    const componentOf = (inst: Instance) => `${inst.component.id.ns}/${inst.component.id.name}`
    const about = (inst: Instance) => (inst.component.description === undefined ? {} : { description: inst.component.description })
    const close = (s: Subscription) => { subs.delete(s.id); bucket(s.source, s.op).delete(s); seq.delete(s); emit({ type: 'subscription-closed', subscription: s }) }
    return {
      id,
      get: i => instances.get(i),
      add(i, inst, owner) {
        if (instances.has(i)) return err(`${i} is already in ${id}`)
        instances.set(i, inst)
        if (owner) owners.set(i, owner)
        emit({ type: 'instance-added', instance: i, ops: keys(inst), component: componentOf(inst), ...about(inst), ...(owner && { owner }) })
        return ok(undefined)
      },
      replace(i, inst, owner) {
        if (!instances.has(i)) return err(`no instance ${i} in ${id}`)
        instances.set(i, inst)
        if (owner) owners.set(i, owner)
        const o = owners.get(i)
        emit({ type: 'instance-replaced', instance: i, ops: keys(inst), component: componentOf(inst), ...about(inst), ...(o && { owner: o }) })
        return ok(undefined)
      },
      remove(i) {
        const inst = instances.get(i)
        if (!inst) return err(`no instance ${i} in ${id}`)
        for (const s of [...subs.values()]) if (s.listener === i) close(s)
        instances.delete(i); owners.delete(i)
        emit({ type: 'instance-removed', instance: i, ops: keys(inst) })
        return ok(undefined)
      },
      subscribe(s) {
        if (!instances.has(s.listener)) return err(`no listener ${s.listener} in ${id}`)
        const sub = { id: crypto.randomUUID(), ...s }
        subs.set(sub.id, sub); bucket(sub.source, sub.op).add(sub); seq.set(sub, n++)
        emit({ type: 'subscription-opened', subscription: sub })
        return ok(sub)
      },
      unsubscribe(sid) {
        const s = subs.get(sid)
        if (!s) return err(`no subscription ${sid} in ${id}`)
        close(s)
        return ok(undefined)
      },
      announce(i, type, op) {
        if (!instances.has(i)) return err(`no instance ${i} in ${id}`)
        emit({ type, instance: i, op: Ops.key(op) })
        return ok(undefined)
      },
      matching: (source, op) => [...(index.get(`* ${op}`) ?? []), ...(source === '*' ? [] : index.get(`${source} ${op}`) ?? [])].sort((a, b) => seq.get(a)! - seq.get(b)!),
      snapshot: () => ({
        id,
        instances: [...instances].map(([i, inst]) => ({ id: i, component: componentOf(inst), ...about(inst), ...(owners.has(i) && { owner: owners.get(i) }), ops: [...inst.actions.values()].map(a => a.op) })),
        subscriptions: [...subs.values()],
      }),
      listen(fn) { listeners.add(fn); return () => { listeners.delete(fn) } },
    }
  },
}
