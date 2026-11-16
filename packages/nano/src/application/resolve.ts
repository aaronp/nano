/**
 * A runtime as the host sees it (`app.runtime(id)`): only the pods placed there, only what it exports, every message
 * policed by its policy. `resolve(api, where?)` answers the one pod providing `api` there, narrowed by `where.pod`, with
 * the implementation found and the plain object over it; or why not (`not-found`, `not-exported`, `not-unique`).
 *
 *   const r = app.runtime('frontend').resolve(TodoList)   // r.ok: r.pod, r.runtime, r.implementation, r.value; else r.reason
 *   const todos = r.getOrThrow()                          // the plain object, or an Error carrying r.fail
 */
import type { Static, TSchema } from 'typebox'
import type { Interface } from '../iface.ts'
import type { Op } from '../op.ts'
import { plain } from '../plain.ts'
import { failure, success, type Fail, type NanoResult } from '../result.ts'
import { client } from './emit.ts'
import { impl, type Hear, type Live } from './messages.ts'

type Reason = 'not-found' | 'not-exported' | 'not-unique'
export type Resolution<T> =
  | { readonly ok: true; readonly runtime: string; readonly pod: string; readonly implementation: string; readonly value: T; getOrThrow(): T }
  | { readonly ok: false; readonly reason: Reason; readonly fail: Fail; getOrThrow(): never }

/** A success, or a Fail whose type is one of the resolution reasons. */
type Found<T> = { ok: true; value: T } | { ok: false; fail: Fail & { type: Reason } }
const miss = (type: Reason, reason: string) => ({ ok: false as const, fail: { type, reason } })

type Where = { pod?: string }
type Placed = { pod: string; runtime: string; implementation: string }
type Client = Record<string, (input: unknown) => Promise<NanoResult<unknown>>>

/** A runtime as the host sees it. */
export type Entry = {
  resolve<I extends Interface>(api: I, where?: Where): Resolution<Interface.Type<I>>
  get<I extends Interface>(api: I, where?: Where): Interface.Type<I>
  call(pod: string): Client
  /** Each successful call of action `op` travelling in this runtime, after it returns; gives an unsubscribe. */
  subscribe<O extends Op>(op: O, fn: (call: { input: In<O>; output: Out<O> }) => unknown): () => void
}
type DataOf<S> = S extends TSchema ? Static<S> : unknown
type In<O> = O extends Op<infer I, any> ? DataOf<I> : unknown
type Out<O> = O extends Op<any, infer S> ? DataOf<S> : unknown

/** Whether runtime `id` offers interface `coord` to the host: absent `exports` offers everything. */
const offered = (live: Live, id: string, coord: string) => { const x = live.now().runtimes[id]?.exports; return !x || x.includes(coord) }

/** The one pod placed in `runtime` providing `api` now, narrowed by `where`, if the runtime exports it. */
export function placement(live: Live, runtime: string, api: Interface, where: Where): Found<Placed> {
  const found: Placed[] = []
  for (const pod of live.now().runtimes[runtime]?.pods ?? []) {
    const i = impl(live, pod)
    if ((where.pod ?? pod) === pod && i?.provides.some(x => x.coord === api.coord)) found.push({ pod, runtime, implementation: i.coord })
  }
  const what = `${api.coord} in ${runtime}${where.pod ? ` at ${where.pod}` : ''}`
  if (!found.length) return miss('not-found', `no pod provides ${what}`)
  if (!offered(live, runtime, api.coord)) return miss('not-exported', `${runtime} does not export ${api.coord}`)
  return found.length === 1 ? { ok: true, value: found[0]! } : miss('not-unique', `${found.length} pods provide ${what}`)
}

const thrown = (fail: Fail) => () => { throw Object.assign(new Error(`${fail.type}: ${fail.reason}`), { fail }) }

/**
 * Runtime `id` (or, absent, the application's one runtime) as the host sees it, looked up again at each use, so one
 * added later by `apply` works and a missing one is `not-found`.
 * Its plain objects resolve again at each call, so a rewired placement is followed.
 */
export function entry(live: Live, id?: string): Entry {
  const at = () => id === undefined ? only(live) : named(live, id)
  const call = (pod: string): Client => {
    const r = at(), id = r.ok ? r.value : ''
    return client(live, id, 'host', pod, () => { const now = at(); return !now.ok ? now
      : now.value !== id ? failure('not-found', `runtime ${now.value} is not the one this client was made for`)
      : live.closed() ? failure('not-found', 'application is closed')
      : live.now().runtimes[id]?.pods.includes(pod) ? undefined : failure('not-found', `${pod} is not placed in ${id}`) }, c => offered(live, id, c))
  }
  const found = (api: Interface, where: Where): Found<Placed> => { const r = at(); return r.ok ? placement(live, r.value, api, where) : r }
  const resolve = <I extends Interface>(api: I, where: Where = {}): Resolution<Interface.Type<I>> => {
    const now = found(api, where)
    if (!now.ok) return { ok: false, reason: now.fail.type, fail: now.fail, getOrThrow: thrown(now.fail) }
    const value = plain<Interface.Type<I>>(() => {
      const p = found(api, where)
      return p.ok ? success({ call: call(p.value.pod) }) : p
    })
    return { ok: true, ...now.value, value, getOrThrow: () => value }
  }
  const subscribe: Entry['subscribe'] = (op, fn) => {
    const r = at()
    if (!r.ok) thrown(r.fail)()
    const h = { runtime: r.ok ? r.value : '', op: op.coord, fn: fn as Hear['fn'] }
    live.ons.add(h)
    return () => { live.ons.delete(h) }
  }
  return { resolve, get: (api, where) => resolve(api, where).getOrThrow(), call, subscribe }
}

/** Runtime `id` if the application has it now, else `not-found`. */
const named = (live: Live, id: string): Found<string> =>
  Object.hasOwn(live.now().runtimes, id) ? { ok: true, value: id } : miss('not-found', `no runtime ${id}`)

/** The application's one runtime, or `not-unique` ("name a runtime") when it has several. */
const only = (live: Live): Found<string> => {
  const ids = Object.keys(live.now().runtimes)
  return ids.length === 1 ? { ok: true, value: ids[0]! } : miss(ids.length ? 'not-unique' : 'not-found', `${ids.length} runtimes: name a runtime`)
}
