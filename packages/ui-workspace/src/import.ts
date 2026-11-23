/**
 * Import: fetch a `nano.json` (or File › Save's `{ app, outline }` or `{ app, platform }`: its app; the pages are the caller's), load its provider modules, and merge it into what is loaded. The caller applies the
 * deployment. Nothing throws, and on failure `loaded` is unchanged. A provider on another origin than this page is
 * foreign: `confirm` is asked once for all of them, then each is probed (`deps.probe`) and loaded, so its views are
 * defined; one of its pods that runs with this page's access (`host` here, `sandbox` through `isolated`) asks `approve` first.
 *
 *   const r = await importApp('/apps/slice/nano.json', loaded, { load: u => import(u), probe, confirm, approve })
 */
import { failure, Registry, success, type AppDeployment, type NanoResult, type Provider } from '@pritzlaff/nano-core'
import type { ViewMap } from '@pritzlaff/nano-ui'
import { newerCore, type Built } from './built.ts'
import { gated, isProvider } from './import-gate.ts'
import { merge, podsOf } from './import-plan.ts'
import { opened } from './migrate.ts'

export type Loaded = { deployment: AppDeployment; registry: Registry; views: ViewMap }
/** A provider from another origin, as the confirm prompt lists it. `fullAccess`: the pod runs with this page's access. */
export type Foreign = { coord: string; url: string; origin: string; pods: { name: string; isolation: string; fullAccess: boolean }[] }
export type Deps = {
  load(url: string): Promise<unknown>
  probe(url: string): Promise<NanoResult<{ provider: Provider; views: ViewMap; built?: Built }>>
  confirm(list: Foreign[]): Promise<boolean>
  approve(title: string): Promise<boolean>
  /** The nano.json as fetched, edited before anything is decided (the Import dialog's runtime names and Trust). */
  edit?(d: AppDeployment): AppDeployment
  /** Told when a module was built with a newer nano-core than this page's; the import goes on. */
  warn?(text: string): void
}

/** This page's origin on http(s); else none (a file: page, in tests). */
const page = () => { const h = globalThis.location; return h && /^https?:$/.test(h.protocol) ? h.origin : undefined }

/** The origin of a provider URL as stored, when it is not this page's; on a page that is not http(s), none. */
export function foreignOrigin(stored: string | undefined): string | undefined {
  const p = page(), at = p && stored ? URL.parse(stored, globalThis.location.href) : null
  return at && at.origin !== p ? at.origin : undefined
}

const why = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Each of `refs` (coord, resolved URL) loaded: one on `home` imported; from another origin, `confirm` asked once for
 * them all (with their pods in `d`), then each probed and gated, loaded now only when one of its pods runs with this
 * page's access. Each provider with its views. */
async function loadModules(refs: (readonly [string, URL])[], d: AppDeployment, home: string, deps: Deps): Promise<NanoResult<{ coord: string; provider: Provider; views: ViewMap }[]>> {
  const foreign: Foreign[] = refs.filter(([, u]) => u.origin !== home)
    .map(([coord, u]) => ({ coord, url: u.href, origin: u.origin, pods: podsOf(d, coord, p => p.isolation ?? 'host') }))
  if (foreign.length && !await deps.confirm(foreign)) return failure('invalid-input', 'import cancelled')
  const out: { coord: string; provider: Provider; views: ViewMap }[] = []
  for (const [coord, u] of refs) {
    const at = u.href
    if (u.origin !== home) {   // probed in a frame, loaded (confirmed) for its views, and run in this page only once approved
      const probed = await deps.probe(at)
      if (!probed.ok) return probed
      if (!isProvider(probed.value.provider, coord)) return failure('invalid-input', `${at} has no default Provider ${coord}`)
      const [p, load] = gated(probed.value.provider, at, u.origin, deps)
      // a provider whose pods are all isolated-sandbox never runs in this page
      if (foreign.find(f => f.coord === coord)?.pods.some(p => p.fullAccess))
        try { await load() } catch (e) { return failure('invalid-input', `cannot load ${at}: ${why(e)}`) }
      out.push({ coord, provider: p, views: probed.value.views })
      const w = newerCore(coord, probed.value.built); if (w) deps.warn?.(w)
      continue
    }
    let mod: { default?: unknown; views?: ViewMap; built?: Built }
    try { mod = (await deps.load(at)) as typeof mod } catch (e) { return failure('invalid-input', `cannot load ${at}: ${why(e)}`) }
    if (!isProvider(mod?.default, coord)) return failure('invalid-input', `${at} has no default Provider ${coord}`)
    out.push({ coord, provider: mod.default, views: { ...mod.views } })
    const w = newerCore(coord, mod.built); if (w) deps.warn?.(w)
  }
  return success(out)
}

/** The host core's loader (`Host.boot`'s `load`) on `loadModules`: the modules resolved against `base`; each one's views as its export. */
export const gatedLoad = (deps: Deps) => async (modules: Record<string, string>, base: string | URL, d: AppDeployment) => {
  const got = await loadModules(Object.entries(modules).map(([c, ref]) => [c, new URL(ref, base)] as const), d, page() ?? new URL(base).origin, deps)
  if (!got.ok) return got
  const registry = Registry.create()
  for (const { provider } of got.value) { const added = registry.add(provider); if (!added.ok) return added }
  return success({ registry, exports: Object.fromEntries(got.value.map(g => [g.coord, { views: g.views }])) })
}

export async function importApp(url: string, loaded: Loaded, deps: Deps): Promise<NanoResult<Loaded>> {
  try {
    const res = await fetch(url)
    if (!res.ok) return failure('invalid-input', `cannot load ${url}: ${res.status}`)
    const file = opened(await res.json())   // an { app, outline } (or { app, platform }) bundle's app; the old pages out of a nano.json's layout
    if (!file.ok) return file
    const fetched = file.value.app, incoming = deps.edit ? deps.edit(fetched) : fetched
    // a local file (a blob: URL) is no base: its modules resolve against the page, as saved
    const base = new URL(url.startsWith('blob:') ? globalThis.location.href : url, globalThis.location?.href), home = page() ?? base.origin
    // Each provider is resolved against the nano.json. Stored: its path when it is on this page's origin (so the same
    // tree served elsewhere still loads), else whole; also whole when the path would read as protocol-relative
    // (`/.//evil.test/x.js` has the path `//evil.test/x.js`, another origin once resolved again).
    const refs = Object.entries(incoming.modules ?? {}).map(([coord, ref]) => [coord, new URL(ref, base)] as const)
    const away = (u: URL) => u.origin !== home
    incoming.modules = Object.fromEntries(refs.map(([coord, u]) => [coord, !away(u) && /^https?:$/.test(u.protocol) && !u.pathname.startsWith('//') ? u.pathname + u.search : u.href]))
    // a provider's own page (its home-origin pods' frame): always whole, as the origin is the point
    if (incoming.frames) incoming.frames = Object.fromEntries(Object.entries(incoming.frames).map(([c, ref]) => [c, new URL(ref, base).href]))
    const deployment = merge(loaded.deployment, incoming)   // a clash is refused before anyone is asked
    if (!deployment.ok) return deployment
    const got = await loadModules(refs.filter(([coord]) => !loaded.registry.provider(coord)), incoming, home, deps)   // already loaded: merge checked the stored URL matches
    if (!got.ok) return got
    // The registry cannot be copied, so it is added to only here, after everything else succeeded.
    for (const { provider } of got.value) { const added = loaded.registry.add(provider); if (!added.ok) return added }
    return success({ deployment: deployment.value, registry: loaded.registry, views: Object.assign({ ...loaded.views }, ...got.value.map(g => g.views)) })
  } catch (e) {
    return failure('invalid-input', `cannot import ${url}: ${why(e)}`)
  }
}
