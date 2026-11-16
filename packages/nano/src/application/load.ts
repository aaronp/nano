/**
 * What `Application.load(url)` reads: a `nano.json` and the providers its `modules` name (each a module whose default
 * export is a `Provider`, imported relative to the nano.json), as a registry. The first failure is the result.
 *
 *   const r = await loaded(new URL('./nano.json', import.meta.url))   // success({ deployment, registry })
 */
import type { AppDeployment } from '../deployment.ts'
import { Registry } from '../registry.ts'
import { failure, success, type NanoResult } from '../result.ts'

const why = (e: unknown) => (e instanceof Error ? e.message : String(e))

export async function loaded(url: string | URL): Promise<NanoResult<{ deployment: AppDeployment; registry: Registry }>> {
  let deployment: AppDeployment
  try { deployment = await (await fetch(url)).json() as AppDeployment }
  catch (e) { return failure('invalid-input', `${url}: ${why(e)}`) }
  const registry = Registry.create()
  for (const [ns, path] of Object.entries(deployment?.modules ?? {})) {
    let provider: unknown
    try { provider = (await import(new URL(path, url).href)).default }
    catch (e) { return failure('not-found', `${ns} (${path}): ${why(e)}`) }
    const added = provider && typeof provider === 'object' ? registry.add(provider as never) : failure('invalid-input', `${path} has no default Provider`)
    if (!added.ok) return added
  }
  return success({ deployment, registry })
}
