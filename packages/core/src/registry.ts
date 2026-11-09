// One place holding instances by id, and the subscriptions between them. Data only: it never runs an action.
import type { Instance } from './component'
import { err, ok, type Delta, type Op, type Result, type Subscription } from './data'

/** What a registry holds, as plain data. */
export type Snapshot = { id: string; instances: { id: string; ops: Op[] }[]; subscriptions: Subscription[] }

/** Stores instances and subscriptions, and tells its listeners about every change as a Delta. */
export type Registry = {
  id: string
  get(id: string): Instance | undefined
  add(id: string, inst: Instance): Result<void>
  remove(id: string): Result<void>
  subscribe(s: Omit<Subscription, 'id'>): Result<Subscription>
  unsubscribe(id: string): Result<void>
  /** The subscriptions a publish of `op` by `source` reaches. */
  matching(source: string, op: string): Subscription[]
  snapshot(): Snapshot
  emit(d: Delta): void
  listen(fn: (d: Delta) => void): () => void
}

/** Makes an empty registry. */
export const Registries = {
  create(id: string): Registry {
    const instances = new Map<string, Instance>(), subs = new Map<string, Subscription>()
    const listeners = new Set<(d: Delta) => void>()
    const emit = (d: Delta) => listeners.forEach(fn => fn(d))
    const keys = (inst: Instance) => [...inst.actions.keys()]
    const close = (s: Subscription) => { subs.delete(s.id); emit({ type: 'subscription-closed', subscription: s }) }
    return {
      id, emit,
      get: i => instances.get(i),
      add(i, inst) {
        if (instances.has(i)) return err(`${i} is already in ${id}`)
        instances.set(i, inst)
        emit({ type: 'instance-added', instance: i, ops: keys(inst) })
        return ok(undefined)
      },
      remove(i) {
        const inst = instances.get(i)
        if (!inst) return err(`no instance ${i} in ${id}`)
        for (const s of [...subs.values()]) if (s.listener === i) close(s)
        instances.delete(i)
        emit({ type: 'instance-removed', instance: i, ops: keys(inst) })
        return ok(undefined)
      },
      subscribe(s) {
        if (!instances.has(s.listener)) return err(`no listener ${s.listener} in ${id}`)
        const sub = { id: crypto.randomUUID(), ...s }
        subs.set(sub.id, sub)
        emit({ type: 'subscription-opened', subscription: sub })
        return ok(sub)
      },
      unsubscribe(sid) {
        const s = subs.get(sid)
        if (!s) return err(`no subscription ${sid} in ${id}`)
        close(s)
        return ok(undefined)
      },
      matching: (source, op) => [...subs.values()].filter(s => (s.source === '*' || s.source === source) && s.op === op),
      snapshot: () => ({
        id,
        instances: [...instances].map(([i, inst]) => ({ id: i, ops: [...inst.actions.values()].map(a => a.op) })),
        subscriptions: [...subs.values()],
      }),
      listen(fn) { listeners.add(fn); return () => { listeners.delete(fn) } },
    }
  },
}
