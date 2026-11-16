/**
 * Runtimes composed into the application's deployment: the pods they place, described by their one `Pods` and in its
 * order, the runtimes' placing and wiring in the order given, and the tags their scopes carry. A pod in no runtime
 * is not in it, nor are its tags. Each runtime was checked by `Runtime.create`; this checks only what the application owns,
 * and that no runtime has both a code policy (in `policies`) and a `policy` in its deployment.
 *
 *   compose({ chat, support })   // success({ deployment: { pods, runtimes, tags? }, registry }), or invalid-input naming the offender
 */
import { RuntimeIds, type AppDeployment } from '../deployment.ts'
import type { Pod } from '../pod.ts'
import type { Policy } from '../policy.ts'
import { originOf, shapeError, type Pods } from '../pods.ts'
import type { Registry } from '../registry.ts'
import { failure, success, type NanoResult } from '../result.ts'
import { isRuntime } from '../runtime.ts'

/** Never throws; `registry` is that of the runtimes' `Pods`, absent when there are no runtimes. */
export function compose(runtimes: unknown, policies: Record<string, Policy> = {}): NanoResult<{ deployment: AppDeployment; registry?: Registry }> {
  try {
    const why = shapeError(RuntimeIds, runtimes, 'runtimes')
    if (why) return failure('invalid-input', why)
    const out: AppDeployment['runtimes'] = Object.create(null), placed = new Map<string, Pod>()
    const tags: Record<string, string[]> = Object.create(null)
    let root: Pods | undefined
    for (const [id, r] of Object.entries(runtimes as Record<string, unknown>)) {
      if (!isRuntime(r)) return failure('invalid-input', `runtime ${id}: not made by Runtime.create`)
      if (r.id !== id) return failure('invalid-input', `runtime ${id}: its id is ${r.id}`)
      const origin = originOf(r.pods)!
      if ((root ??= origin.root) !== origin.root) return failure('invalid-input', `runtime ${id}: its pods come from another Pods`)
      out[id] = r.deployment()
      if (out[id].policy && Object.hasOwn(policies, id)) return failure('invalid-input', `runtime ${id}: has a policy in code and in its deployment`)
      for (const n of out[id].pods) if (origin.tags && Object.hasOwn(origin.tags, n)) tags[n] = structuredClone(origin.tags[n]!)
      for (const name of out[id].pods) placed.set(name, origin.pods.get(name)!)
    }
    for (const [id, r] of Object.entries(out))
      for (const s of r.subscriptions) if (!placed.has(s.from)) return failure('invalid-input', `runtime ${id}: ${s.from}->${s.to}: ${s.from} is placed in no runtime`)
    const pods: AppDeployment['pods'] = Object.create(null)
    for (const name of root?.names() ?? []) if (placed.has(name)) pods[name] = structuredClone(placed.get(name)!)
    const from = root && originOf(root)!
    return success({ deployment: { pods, runtimes: out, ...(from?.tags && { tags }) }, registry: from?.registry })
  } catch (e) {
    return failure('invalid-input', `unreadable runtimes: ${e instanceof Error ? e.message : String(e)}`)
  }
}
