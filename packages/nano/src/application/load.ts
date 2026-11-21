/**
 * What `Application.load(url)` reads: a `nano.json` and the providers its `modules` name (each a module whose default
 * export is a `Provider`, imported relative to the nano.json), as a registry. The first failure is the result.
 * The document's shape is checked before anything is imported. `modules` URLs are code that will run: load only
 * trusted documents.
 *
 *   const r = await loaded(new URL('./nano.json', import.meta.url))   // success({ deployment, registry })
 */
import { AppDeployment } from '../deployment.ts'
import { Registry } from '../registry.ts'
import { failure, success, type NanoResult } from '../result.ts'

const why = (e: unknown) => (e instanceof Error ? e.message : String(e))

export async function loaded(url: string | URL): Promise<NanoResult<{ deployment: AppDeployment; registry: Registry }>> {
  let deployment: AppDeployment
  try {
    const res = await fetch(url)
    if (!res.ok) return failure('not-found', `${url}: ${res.status} ${res.statusText}`)
    deployment = await res.json() as AppDeployment
  } catch (e) { return failure('invalid-input', `${url}: ${why(e)}`) }
  // Its shape before any import: pods and runtimes need the providers, so they are checked as objects here, in full later.
  const d = deployment as Partial<AppDeployment> | null
  if (!d || typeof d.pods !== 'object' || !d.pods || typeof d.runtimes !== 'object' || !d.runtimes)
    return failure('invalid-input', `${url}: a deployment has pods and runtimes`)
  const { pods: _p, runtimes: _r, tags: _t, ...host } = d
  const top = AppDeployment.assemble({ ...host, pods: {}, runtimes: {} }, Registry.create())
  if (!top.ok) return failure('invalid-input', `${url}: ${top.fail.reason}`)
  const loadedModules = await Registry.load(deployment.modules ?? {}, url)
  if (!loadedModules.ok) return loadedModules
  const { registry } = loadedModules.value
  return success({ deployment, registry })
}
