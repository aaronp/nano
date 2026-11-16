/**
 * Import: fetch a `nano.json`, load its provider modules, and merge it into what is loaded. The caller applies the
 * deployment. Nothing throws, and on failure `loaded` is unchanged.
 *
 *   const r = await importApp('/apps/slice/nano.json', loaded)   // NanoResult<Loaded>
 */
import { failure, success, type AppDeployment, type NanoResult, type Provider, type Registry } from '@pritzlaff/nano-core'
import type { ViewMap } from '@pritzlaff/nano-ui'

export type Loaded = { deployment: AppDeployment; registry: Registry; views: ViewMap }

const clash = (what: string, name: string) => failure('invalid-input', `clash: ${what} ${name} is already loaded`)

/** `current` and `incoming` unioned; a name already present is a clash. Pure. */
export function merge(current: AppDeployment, incoming: AppDeployment): NanoResult<AppDeployment> {
  for (const k of Object.keys(incoming.pods)) if (Object.hasOwn(current.pods, k)) return clash('pod', k)
  for (const k of Object.keys(incoming.runtimes)) if (Object.hasOwn(current.runtimes, k)) return clash('runtime', k)
  const providers: Record<string, string> = { ...current.providers }
  for (const [k, url] of Object.entries(incoming.providers ?? {})) {
    if (Object.hasOwn(providers, k) && providers[k] !== url) return clash('provider', k)
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

/** A resolved provider URL as stored: its path for http(s), so the same tree served elsewhere still loads; else whole. */
const stored = (u: URL) => (u.protocol === 'http:' || u.protocol === 'https:' ? u.pathname + u.search : u.href)

const isProvider = (p: unknown, coord: string): p is Provider =>
  typeof p === 'object' && p !== null && (p as Provider).coord === coord && (p as Provider).implementations instanceof Map

export async function importApp(url: string, loaded: Loaded): Promise<NanoResult<Loaded>> {
  try {
    const res = await fetch(url)
    if (!res.ok) return failure('invalid-input', `cannot load ${url}: ${res.status}`)
    const incoming = (await res.json()) as AppDeployment
    const base = new URL(url, globalThis.location?.href)
    // Providers load from the host's own origin (cross-origin comes later); with no http(s) page, from the nano.json's.
    const here = globalThis.location, page = here && /^https?:$/.test(here.protocol) ? here.origin : undefined
    if (page && base.origin !== page) return failure('invalid-input', `${base.href} is not on the origin of this page (${page})`)
    // Each provider is resolved against the nano.json and must share its origin; it is stored resolved (see stored).
    const refs = Object.entries(incoming.providers ?? {}).map(([coord, ref]) => [coord, new URL(ref, base)] as const)
    const away = refs.find(([, at]) => at.origin !== (page ?? base.origin))
    if (away) return failure('invalid-input', `${away[1].href} is not on the origin of ${base.href}`)
    incoming.providers = Object.fromEntries(refs.map(([coord, at]) => [coord, stored(at)]))
    const fresh: Provider[] = []
    const views: ViewMap = { ...loaded.views }
    for (const [coord, u] of refs) {
      const at = u.href
      if (loaded.registry.provider(coord)) continue   // already loaded; merge still checks the stored URL matches
      let mod: { default?: unknown; views?: ViewMap }
      try { mod = await import(at) } catch (e) { return failure('invalid-input', `cannot load ${at}: ${e instanceof Error ? e.message : String(e)}`) }
      if (!isProvider(mod.default, coord)) return failure('invalid-input', `${at} has no default Provider ${coord}`)
      fresh.push(mod.default)
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
