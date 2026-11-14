/**
 * Runtimes composed into the application's deployment: the pods they place, described by their one `Pods` and in its
 * order, and the runtimes' placing and wiring in the order given. A pod in no runtime is not in it.
 *
 *   compose({ chat, support })   // success({ deployment: { pods, runtimes }, registry }), or invalid-input naming the offender
 */
import { RuntimeIds, type AppDeployment } from '../deployment.ts'
import type { Pod } from '../pod.ts'
import { originOf, shapeError, type Pods } from '../pods.ts'
import type { Registry } from '../registry.ts'
import { failure, success, type NanoResult } from '../result.ts'
import { Runtime } from '../runtime.ts'

/** Never throws; `registry` is that of the runtimes' `Pods`, absent when there are no runtimes. */
export function compose(runtimes: unknown): NanoResult<{ deployment: AppDeployment; registry?: Registry }> {
  try {
    const why = shapeError(RuntimeIds, runtimes, 'runtimes')
    if (why) return failure('invalid-input', why)
    const out: AppDeployment['runtimes'] = Object.create(null), placed = new Map<string, Pod>()
    let root: Pods | undefined, registry: Registry | undefined
    for (const [id, r] of Object.entries(runtimes as Record<string, Runtime>)) {
      // Checked again under its id here, so a value merely shaped like a Runtime holds what Runtime.create promises.
      const again = Runtime.create(id, r.deployment(), r.pods)
      if (!again.ok) return again
      const origin = originOf(r.pods)!
      if ((root ??= origin.root) !== origin.root) return failure('invalid-input', `runtime ${id}: its pods come from another Pods`)
      registry = origin.registry
      out[id] = again.value.deployment()
      for (const name of out[id].pods) placed.set(name, r.pods.get(name)!)
    }
    const pods: AppDeployment['pods'] = Object.create(null)
    for (const name of root?.names() ?? []) if (placed.has(name)) pods[name] = placed.get(name)!
    return success({ deployment: { pods, runtimes: out }, registry })
  } catch (e) {
    return failure('invalid-input', `unreadable runtimes: ${e instanceof Error ? e.message : String(e)}`)
  }
}
