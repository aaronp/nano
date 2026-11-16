/**
 * AppDeployment: the whole system as data — pods by name, runtimes by id, tags. `nano.json` is one, serialised.
 * `assemble` checks it level by level: `Pods.create` of its pods, then `Runtime.create` of each runtime over its scope.
 *
 *   const d = { pods: { db: Pod.lazy(kv) }, runtimes: { app: { pods: ['db'], subscriptions: [] } } }
 *   AppDeployment.assemble(d, registry)   // success({ app: Runtime }), or the first failure naming the offender; never throws
 */
import { Type } from 'typebox'
import { Id, Pods, shapeError, type PodDeployment } from './pods.ts'
import type { Registry } from './registry.ts'
import { failure, success, type NanoResult } from './result.ts'
import { Runtime, type RuntimeDeployment } from './runtime.ts'

export type AppDeployment = {
  pods: PodDeployment; runtimes: Record<string, RuntimeDeployment>; tags?: Record<string, string[]>
  /** Host-owned: nano shape-checks these and otherwise ignores them. */
  modules?: Record<string, string>; views?: Record<string, string>
  /** The deployer's choice, a plain object: nano shape-checks it and otherwise ignores it; `deployment()` omits it. */
  layout?: Record<string, unknown>
}

const strict = { additionalProperties: false } as const
/** A table by runtime id: ids follow the id rule, at most 50. */
export const RuntimeIds = Type.Record(Id, Type.Unknown(), { ...strict, maxProperties: 50 })
const Shape = Type.Object({
  pods: Type.Unknown(),
  runtimes: RuntimeIds,
  tags: Type.Optional(Type.Record(Id, Type.Array(Type.String()), strict)),
  modules: Type.Optional(Type.Record(Id, Type.String({ minLength: 1 }), strict)),
  views: Type.Optional(Type.Record(Id, Type.String({ minLength: 1 }), strict)),
  layout: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
}, strict)

/** `d`'s runtimes, if every level of it checks out; the first failure otherwise. Pure; never throws. */
function assemble(d: unknown, registry: Registry): NanoResult<Record<string, Runtime>> {
  try {
    const copy = structuredClone(d)
    const why = shapeError(Shape, copy, 'deployment')
    if (why) return failure('invalid-input', why)
    const { pods: podDeployment, runtimes, tags } = copy as AppDeployment
    const pods = Pods.create(podDeployment, { registry, tags })
    if (!pods.ok) return pods
    const out: Record<string, Runtime> = Object.create(null)
    for (const [id, r] of Object.entries(runtimes)) {
      // Over its distinct pod names only, so Runtime.create reports a bad shape or a pod placed twice in its own words.
      // ...and the callers of its call edges, which may be placed elsewhere.
      const froms = Array.isArray(r?.subscriptions) ? r.subscriptions.flatMap(s => (s?.kind === 'call' && pods.value.names().includes(s.from) ? [s.from] : [])) : []
      const scope = pods.value.select(Array.isArray(r?.pods) ? [...new Set([...r.pods.filter(n => typeof n === 'string'), ...froms])] : [])
      if (!scope.ok) return failure('invalid-input', `runtime ${id}: ${scope.fail.reason}`)
      const runtime = Runtime.create(id, r, scope.value)
      if (!runtime.ok) return runtime
      out[id] = runtime.value
    }
    return success(out)
  } catch (e) {
    return failure('invalid-input', `unreadable deployment: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/** A whole deployment checked level by level into its runtimes: `AppDeployment.assemble(d, registry)`. */
export const AppDeployment = { assemble }
