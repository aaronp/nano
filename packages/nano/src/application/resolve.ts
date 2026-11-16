/**
 * A runtime as the host sees it (`app.runtime(id)`): only the pods placed there, only what it exports, every message
 * policed by its policy. `resolve(api, where?)` answers the one pod providing `api` there, narrowed by `where.pod`, with
 * the implementation found and the plain object over it; or why not (`not-found`, `not-exported`, `not-unique`).
 *
 *   const r = app.runtime('frontend').resolve(TodoList)   // r.ok: r.pod, r.runtime, r.implementation, r.value; else r.reason
 *   const todos = r.getOrThrow()                          // the plain object, or an Error carrying r.fail
 */
import type { Interface } from '../iface.ts'
import { plain } from '../plain.ts'
import { failure, success, type Fail, type NanoResult } from '../result.ts'
import { client } from './emit.ts'
import { impl, type Live } from './messages.ts'

export type Resolution<T> =
  | { readonly ok: true; readonly runtime: string; readonly pod: string; readonly implementation: string; readonly value: T; getOrThrow(): T }
  | { readonly ok: false; readonly reason: 'not-found' | 'not-exported' | 'not-unique'; readonly fail: Fail; getOrThrow(): never }

type Where = { pod?: string }
type Found = { pod: string; runtime: string; implementation: string }
type Client = Record<string, (input: unknown) => Promise<NanoResult<unknown>>>

/** A runtime as the host sees it. */
export type Entry = {
  resolve<I extends Interface>(api: I, where?: Where): Resolution<Interface.Type<I>>
  get<I extends Interface>(api: I, where?: Where): Interface.Type<I>
  call(pod: string): Client
}

/** Whether runtime `id` offers interface `coord` to the host: absent `exports` offers everything. */
const offered = (live: Live, id: string, coord: string) => { const x = live.now().runtimes[id]?.exports; return !x || x.includes(coord) }

/** The one pod placed in `runtime` providing `api` now, narrowed by `where`, if the runtime exports it. */
export function placement(live: Live, runtime: string, api: Interface, where: Where): NanoResult<Found> {
  const found: Found[] = []
  for (const pod of live.now().runtimes[runtime]?.pods ?? []) {
    const i = impl(live, pod)
    if ((where.pod ?? pod) === pod && i?.provides.some(x => x.coord === api.coord)) found.push({ pod, runtime, implementation: i.coord })
  }
  const what = `${api.coord} in ${runtime}${where.pod ? ` at ${where.pod}` : ''}`
  if (!found.length) return failure('not-found', `no pod provides ${what}`)
  if (!offered(live, runtime, api.coord)) return failure('not-exported', `${runtime} does not export ${api.coord}`)
  return found.length === 1 ? success(found[0]!) : failure('not-unique', `${found.length} pods provide ${what}`)
}

const thrown = (fail: Fail) => () => { throw Object.assign(new Error(`${fail.type}: ${fail.reason}`), { fail }) }

/**
 * The runtime `at()` names (asked again at each use: the shorthand's one runtime, or a Fail) as the host sees it.
 * Its plain objects resolve again at each call, so a rewired placement is followed.
 */
export function entry(live: Live, at: () => NanoResult<string>): Entry {
  const call = (pod: string): Client => {
    const r = at()
    if (!r.ok) return client(live, '', 'host', pod, () => r)
    const id = r.value
    return client(live, id, 'host', pod, () => live.closed() ? failure('not-found', 'application is closed')
      : live.now().runtimes[id]?.pods.includes(pod) ? undefined : failure('not-found', `${pod} is not placed in ${id}`), c => offered(live, id, c))
  }
  const found = (api: Interface, where: Where) => { const r = at(); return r.ok ? placement(live, r.value, api, where) : r }
  const resolve = <I extends Interface>(api: I, where: Where = {}): Resolution<Interface.Type<I>> => {
    const now = found(api, where)
    if (!now.ok) return { ok: false, reason: now.fail.type as 'not-found', fail: now.fail, getOrThrow: thrown(now.fail) }
    const value = plain<Interface.Type<I>>(() => {
      const p = found(api, where)
      return p.ok ? success({ call: call(p.value.pod) }) : p
    })
    return { ok: true, ...now.value, value, getOrThrow: () => value }
  }
  return { resolve, get: (api, where) => resolve(api, where).getOrThrow(), call }
}

/** The application's one runtime, or `not-unique` ("name a runtime") when it has several. */
export const only = (live: Live): NanoResult<string> => {
  const ids = Object.keys(live.now().runtimes)
  return ids.length === 1 ? success(ids[0]!) : failure(ids.length ? 'not-unique' : 'not-found', `${ids.length} runtimes: name a runtime`)
}
