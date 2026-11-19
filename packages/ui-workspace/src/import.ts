/**
 * Import: fetch a `nano.json`, load its provider modules, and merge it into what is loaded. The caller applies the
 * deployment. Nothing throws, and on failure `loaded` is unchanged. A provider on another origin than this page is
 * foreign: `confirm` is asked once for all of them, then each is probed (`deps.probe`) and loaded, so its views are
 * defined; one of its pods that runs with this page's access (`host` here, `sandbox` through `isolated`) asks `approve` first.
 *
 *   const r = await importApp('/apps/slice/nano.json', loaded, { load: u => import(u), probe, confirm, approve })
 */
import {
  failure,
  Provider,
  success,
  type AppDeployment,
  type Implementation,
  type NanoResult,
  type Pod,
  type Registry,
} from '@pritzlaff/nano-core'
import type { ViewMap } from '@pritzlaff/nano-ui'
import { newerCore, type Built } from './built.ts'
import { podsOf } from './import-plan.ts'

export type Loaded = { deployment: AppDeployment; registry: Registry; views: ViewMap }
/** A provider from another origin, as the confirm prompt lists it. `fullAccess`: the pod runs with this page's access. */
export type Foreign = { coord: string; url: string; origin: string; pods: { name: string; isolation: string; fullAccess: boolean }[] }
type Deps = {
  load(url: string): Promise<unknown>
  probe(url: string): Promise<NanoResult<{ provider: Provider; views: ViewMap; built?: Built }>>
  confirm(list: Foreign[]): Promise<boolean>
  approve(title: string): Promise<boolean>
  /** The nano.json as fetched, edited before anything is decided (the Import dialog's runtime names and Trust). */
  edit?(d: AppDeployment): AppDeployment
  /** Told when a module was built with a newer nano-core than this page's; the import goes on. */
  warn?(text: string): void
}

const clash = (what: string, name: string) => failure('invalid-input', `clash: ${what} ${name} is already loaded`)

/** `current` and `incoming` unioned; a pod or provider name already present is a clash, a runtime already present gains
 * the incoming pods and subscriptions (its own policy kept). Pure. */
export function merge(current: AppDeployment, incoming: AppDeployment): NanoResult<AppDeployment> {
  for (const k of Object.keys(incoming.pods)) if (Object.hasOwn(current.pods, k)) return clash('pod', k)
  const modules: Record<string, string> = { ...current.modules }
  for (const [k, url] of Object.entries(incoming.modules ?? {})) {
    if (Object.hasOwn(modules, k) && modules[k] !== url) return clash('provider', k)
    modules[k] = url
  }
  const frames: Record<string, string> = { ...current.frames }
  for (const [k, url] of Object.entries(incoming.frames ?? {})) {
    if (Object.hasOwn(frames, k) && frames[k] !== url) return clash('frame', k)
    frames[k] = url
  }
  // Merging into a runtime that is already there: two policies would silently lose one's rules, so that is refused.
  for (const [k, r] of Object.entries(incoming.runtimes))
    if (r.policy && Object.hasOwn(current.runtimes, k) && current.runtimes[k]!.policy)
      return failure('invalid-input', `runtime ${k} already has a policy; import into another runtime`)
  return success({
    pods: { ...current.pods, ...incoming.pods },
    runtimes: { ...current.runtimes, ...Object.fromEntries(Object.entries(incoming.runtimes).map(([k, r]) => {
      const was = Object.hasOwn(current.runtimes, k) ? current.runtimes[k] : undefined
      return [k, was ? { ...was, pods: [...was.pods, ...r.pods], subscriptions: [...was.subscriptions, ...r.subscriptions], ...((was.policy ?? r.policy) && { policy: was.policy ?? r.policy }) } : r]
    })) },
    tags: { ...current.tags, ...incoming.tags },
    modules,
    ...(Object.keys(frames).length && { frames }),
    views: { ...current.views, ...incoming.views },
    ...((incoming.layout ?? current.layout) && { layout: incoming.layout ?? current.layout }),   // the newest arrangement
  })
}


/** This page's origin on http(s); else none (a file: page, in tests). */
const page = () => { const h = globalThis.location; return h && /^https?:$/.test(h.protocol) ? h.origin : undefined }

/** The origin of a provider URL as stored, when it is not this page's; on a page that is not http(s), none. */
export function foreignOrigin(stored: string | undefined): string | undefined {
  const p = page(), at = p && stored ? URL.parse(stored, globalThis.location.href) : null
  return at && at.origin !== p ? at.origin : undefined
}

const runHere = (coord: string, origin: string) => `Run ${coord} from ${origin} in this page?`

/** `impl` whose `make` first asks `approve` to run `impl`'s provider from `origin` in this page; a no throws. */
function asking(impl: Implementation, origin: string, approve: Deps['approve']): Implementation {
  return { ...impl, async make(ctx, config) {
    if (!await approve(runHere(impl.provider, origin))) throw new Error('not approved')
    return impl.make(ctx, config)
  } }
}

/** `approve` asked at most once at a time per title: a yes is kept for good (the code is in the page by then), a no
 * forgotten, so the next make asks again. A make that waits shares the open dialog. */
export function remembered(approve: Deps['approve']): Deps['approve'] {
  const asked = new Map<string, Promise<boolean>>()
  return title => {
    let p = asked.get(title)
    if (!p) asked.set(title, p = approve(title).then(yes => { if (!yes) asked.delete(title); return yes }, e => { asked.delete(title); throw e }))
    return p
  }
}

/** What the host's `isolate` gives for a pod: `standIn`, asking first when its frame shares the page's origin
 * (`sandbox`) and its provider is foreign (`origin`). An `isolated-sandbox` frame never asks. */
export const isolated = (standIn: Implementation, isolation: Pod['isolation'], origin: string | undefined, approve: Deps['approve']) =>
  isolation === 'sandbox' && origin ? asking(standIn, origin, approve) : standIn

/** The interfaces with their op hashes, to tell a module that changed since it was probed. */
const shape = (i: Implementation) => i.provides.map(f => `${f.coord}:${Object.values(f.ops).map(o => o.coord).join()}`).join(';')

/** `probed` whose implementations, run in this page, ask first, then run the real one from `url`; and `load`, which
 * loads `url` once (again only after a failure). */
function gated(probed: Provider, url: string, origin: string, deps: Deps): [Provider, () => Promise<Provider>] {
  let real: Promise<Provider> | undefined
  const load = () => real ??= deps.load(url).then(m => {
    const p = (m as { default?: unknown } | undefined)?.default
    if (!isProvider(p, probed.coord)) throw new Error(`${url} has no default Provider ${probed.coord}`)
    return p
  }).catch(e => { real = undefined; throw e })
  return [Provider.define(probed.coord, [...probed.implementations.values()].map(i => asking({ ...i, async make(ctx, config) {
    const r = (await load()).implementations.get(i.coord)
    if (!r || shape(r) !== shape(i)) throw new Error(`${i.coord} is not what ${url} described`)
    return r.make(ctx, config)
  } }, origin, deps.approve)), { ...probed.meta }), load]
}

const isProvider = (p: unknown, coord: string): p is Provider =>
  typeof p === 'object' && p !== null && (p as Provider).coord === coord && (p as Provider).implementations instanceof Map

const why = (e: unknown) => (e instanceof Error ? e.message : String(e))

export async function importApp(url: string, loaded: Loaded, deps: Deps): Promise<NanoResult<Loaded>> {
  try {
    const res = await fetch(url)
    if (!res.ok) return failure('invalid-input', `cannot load ${url}: ${res.status}`)
    const fetched = (await res.json()) as AppDeployment, incoming = deps.edit ? deps.edit(fetched) : fetched
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
    const todo = refs.filter(([coord]) => !loaded.registry.provider(coord))   // already loaded; merge still checks the stored URL matches
    const foreign: Foreign[] = todo.filter(([, u]) => away(u))
      .map(([coord, u]) => ({ coord, url: u.href, origin: u.origin, pods: podsOf(incoming, coord, p => p.isolation ?? 'host') }))
    const deployment = merge(loaded.deployment, incoming)   // a clash is refused before anyone is asked
    if (!deployment.ok) return deployment
    if (foreign.length && !await deps.confirm(foreign)) return failure('invalid-input', 'import cancelled')
    const fresh: Provider[] = []
    const views: ViewMap = { ...loaded.views }
    for (const [coord, u] of todo) {
      const at = u.href
      if (away(u)) {   // probed in a frame, loaded (confirmed) for its views, and run in this page only once approved
        const probed = await deps.probe(at)
        if (!probed.ok) return probed
        if (!isProvider(probed.value.provider, coord)) return failure('invalid-input', `${at} has no default Provider ${coord}`)
        const [p, load] = gated(probed.value.provider, at, u.origin, deps)
        // Loaded now (for its views) only when a pod of it would run with this page's access, as the confirm said;
        // a provider whose pods are all isolated-sandbox never runs in this page.
        if (foreign.find(f => f.coord === coord)?.pods.some(p => p.fullAccess))
          try { await load() } catch (e) { return failure('invalid-input', `cannot load ${at}: ${why(e)}`) }
        fresh.push(p)
        Object.assign(views, probed.value.views)
        const w = newerCore(coord, probed.value.built); if (w) deps.warn?.(w)
        continue
      }
      let mod: { default?: unknown; views?: ViewMap; built?: Built }
      try { mod = (await deps.load(at)) as typeof mod } catch (e) { return failure('invalid-input', `cannot load ${at}: ${why(e)}`) }
      if (!isProvider(mod?.default, coord)) return failure('invalid-input', `${at} has no default Provider ${coord}`)
      fresh.push(mod.default)
      Object.assign(views, mod.views)
      const w = newerCore(coord, mod.built); if (w) deps.warn?.(w)
    }
    // The registry cannot be copied, so it is added to only here, after everything else succeeded.
    for (const p of fresh) { const added = loaded.registry.add(p); if (!added.ok) return added }
    return success({ deployment: deployment.value, registry: loaded.registry, views })
  } catch (e) {
    return failure('invalid-input', `cannot import ${url}: ${why(e)}`)
  }
}
