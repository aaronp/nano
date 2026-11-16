/**
 * What `app.resolve(api, where?)` answers: the one placement (runtime, pod) providing `api`, narrowed by `where`, with
 * the implementation found there and the plain object over it; or why not (`not-found`, `not-unique`).
 *
 *   const r = app.resolve(TodoList)      // r.ok: r.pod, r.runtime, r.implementation, r.value
 *   const todos = r.getOrThrow()         // the plain object, or an Error carrying r.fail
 */
import type { Interface } from '../iface.ts'
import { plain } from '../plain.ts'
import { failure, success, type Fail, type NanoResult } from '../result.ts'
import { impl, type Live } from './messages.ts'

export type Resolution<T> = {
  readonly ok: boolean
  readonly pod?: string
  readonly runtime?: string
  readonly implementation?: string
  readonly value?: T
  readonly fail?: Fail
  getOrThrow(): T
}

type Where = { runtime?: string; pod?: string }
type Found = { pod: string; runtime: string; implementation: string }

/** The one placement providing `api` in the deployment now, narrowed by `where`: a pod in several runtimes needs `where.runtime`. */
export function placement(live: Live, api: Interface, where: Where): NanoResult<Found> {
  const found: Found[] = []
  for (const [runtime, r] of Object.entries(live.now().runtimes))
    for (const pod of r.pods) {
      const i = impl(live, pod)
      if ((where.runtime ?? runtime) === runtime && (where.pod ?? pod) === pod && i?.provides.some(x => x.coord === api.coord))
        found.push({ pod, runtime, implementation: i.coord })
    }
  const what = `${api.coord}${where.runtime ? ` in ${where.runtime}` : ''}${where.pod ? ` at ${where.pod}` : ''}`
  return found.length === 1 ? success(found[0]!)
    : failure(found.length ? 'not-unique' : 'not-found', `${found.length} placements provide ${what}`)
}

/** `api` resolved now; its plain object is resolved again at each call (so a rewired placement is followed). */
export function resolution<I extends Interface>(live: Live, api: I, where: Where, call: (runtime: string, pod: string) => object): Resolution<Interface.Type<I>> {
  const now = placement(live, api, where)
  if (!now.ok) {
    const fail = now.fail
    return { ok: false, fail, getOrThrow: () => { throw Object.assign(new Error(`${fail.type}: ${fail.reason}`), { fail }) } }
  }
  const value = plain<Interface.Type<I>>(() => {
    const p = placement(live, api, where)
    return p.ok ? success({ call: call(p.value.runtime, p.value.pod) }) : p
  })
  return { ok: true, ...now.value, value, getOrThrow: () => value }
}
