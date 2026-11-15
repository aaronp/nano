/**
 * Import: fetch a `nano.json`, load its provider modules, and merge it into what is loaded. The caller applies the
 * deployment. Nothing throws, and on failure `loaded` is unchanged.
 *
 *   const r = await importApp('/apps/slice/nano.json', loaded)   // NanoResult<Loaded>
 */
import { failure, success, type AppDeployment, type NanoResult, type Provider, type Registry } from '@pritzlaff/nano'
import type { ViewMap } from './views/view.ts'

export type Loaded = { deployment: AppDeployment; registry: Registry; views: ViewMap }

const clash = (what: string, name: string) => failure('invalid-input', `clash: ${what} ${name} is already loaded`)

/** `current` and `incoming` unioned; a name already present is a clash. Pure. */
export function merge(current: AppDeployment, incoming: AppDeployment): NanoResult<AppDeployment> {
  for (const k of Object.keys(incoming.pods)) if (k in current.pods) return clash('pod', k)
  for (const k of Object.keys(incoming.runtimes)) if (k in current.runtimes) return clash('runtime', k)
  const providers = { ...current.providers }
  for (const [k, url] of Object.entries(incoming.providers ?? {})) {
    if (providers[k] !== undefined && providers[k] !== url) return clash('provider', k)
    providers[k] = url
  }
  return success({
    pods: { ...current.pods, ...incoming.pods },
    runtimes: { ...current.runtimes, ...incoming.runtimes },
    tags: { ...current.tags, ...incoming.tags },
    providers,
    views: { ...current.views, ...incoming.views },
  })
}

const isProvider = (p: unknown, coord: string): p is Provider =>
  typeof p === 'object' && p !== null && (p as Provider).coord === coord && (p as Provider).implementations instanceof Map

export async function importApp(url: string, loaded: Loaded): Promise<NanoResult<Loaded>> {
  try {
    const res = await fetch(url)
    if (!res.ok) return failure('invalid-input', `cannot load ${url}: ${res.status}`)
    const incoming = (await res.json()) as AppDeployment
    const fresh: Provider[] = []
    const views: ViewMap = { ...loaded.views }
    for (const [coord, ref] of Object.entries(incoming.providers ?? {})) {
      const at = new URL(ref, new URL(url, globalThis.location?.href)).href
      let mod: { default?: unknown; views?: ViewMap }
      try { mod = await import(at) } catch (e) { return failure('invalid-input', `cannot load ${at}: ${e instanceof Error ? e.message : String(e)}`) }
      if (!isProvider(mod.default, coord)) return failure('invalid-input', `${at} has no default Provider ${coord}`)
      if (!loaded.registry.provider(coord)) fresh.push(mod.default)
      Object.assign(views, mod.views)
    }
    const deployment = merge(loaded.deployment, incoming)
    if (!deployment.ok) return deployment
    // The registry cannot be copied, so it is added to only here, after everything else succeeded.
    for (const p of fresh) { const added = loaded.registry.add(p); if (!added.ok) return added }
    return success({ deployment: deployment.value, registry: loaded.registry, views })
  } catch (e) {
    return failure('invalid-input', `cannot import ${url}: ${e instanceof Error ? e.message : String(e)}`)
  }
}
