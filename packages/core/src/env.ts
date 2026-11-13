// An instance's view of the registries it is in: one handle per registry, and its own ops.
import type { Action } from './component'
import { err, Ops, type Coord, type Op, type Result } from './data'

/** One registry as seen by an instance in it: its coordinate there, and how to publish and call. */
export type Handle = {
  coord: Coord
  notify(op: Op, data: unknown, correlation?: string): Promise<Result<Result[]>>
  call(target: string, op: Op, arg: unknown): Promise<Result>
  /** Calls `op` on whatever this instance's `need` is bound to, read at call time. */
  use(need: string, op: Op, arg: unknown): Promise<Result>
}

/** Tells a registry that the instance's ops changed. */
export type Announce = (type: 'op-added' | 'op-removed', op: Op) => void

/** All the registries an instance is in. It publishes to each, and lets the instance add or drop its own ops. */
export type Environment = {
  handles(): Handle[]
  added(h: Handle, announce: Announce): void
  removed(coord: Coord): void
  notify(op: Op, data: unknown, correlation?: string): Promise<Result<Result[]>[]>
  /** Calls a need through the first handle: an instance in several registries uses its first registry's binding (the others' are ignored). */
  use(need: string, op: Op, arg: unknown): Promise<Result>
  register(op: Op, run?: Action<any>['run'], opts?: { emits?: Op[] }): 'added' | 'replaced'
  unregister(op: Op): boolean
}

const same = (a: Coord, b: Coord) => a.registry === b.registry && a.instance === b.instance

/** Makes the environment over an instance's action map. */
export const Environments = {
  create(actions: Map<string, Action<any>>): Environment {
    let members: { h: Handle; announce: Announce }[] = []
    const tell = (type: 'op-added' | 'op-removed', op: Op) => members.forEach(m => m.announce(type, op))
    return {
      handles: () => members.map(m => m.h),
      added: (h, announce) => { if (!members.some(m => same(m.h.coord, h.coord))) members.push({ h, announce }) },
      removed: coord => { members = members.filter(m => !same(m.h.coord, coord)) },
      notify: (op, data, correlation) => Promise.all(members.map(m => m.h.notify(op, data, correlation))),
      use: async (need, op, arg) => members[0] ? members[0].h.use(need, op, arg) : err('not in a registry'),
      register(op, run, opts) {
        const had = actions.has(Ops.key(op))
        actions.set(Ops.key(op), { op, run, emits: opts?.emits })
        tell('op-added', op)
        return had ? 'replaced' : 'added'
      },
      unregister(op) {
        const had = actions.delete(Ops.key(op))
        if (had) tell('op-removed', op)
        return had
      },
    }
  },
}
