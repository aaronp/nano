/**
 * The gate on a foreign provider's code: its implementations, run in this page, ask `approve` first (once per title, a
 * yes kept), and only then load and run the real module, which must still be what was probed.
 *
 *   const [provider, load] = gated(probed, url, origin, { load: u => import(u), approve: remembered(approve) })
 */
import { Provider, type Implementation, type Pod } from '@pritzlaff/nano-core'

type Approve = (title: string) => Promise<boolean>

const runHere = (coord: string, origin: string) => `Run ${coord} from ${origin} in this page?`

/** `impl` whose `make` first asks `approve` to run `impl`'s provider from `origin` in this page; a no throws. */
function asking(impl: Implementation, origin: string, approve: Approve): Implementation {
  return { ...impl, async make(ctx, config) {
    if (!await approve(runHere(impl.provider, origin))) throw new Error('not approved')
    return impl.make(ctx, config)
  } }
}

/** `approve` asked at most once at a time per title: a yes is kept for good (the code is in the page by then), a no
 * forgotten, so the next make asks again. A make that waits shares the open dialog. */
export function remembered(approve: Approve): Approve {
  const asked = new Map<string, Promise<boolean>>()
  return title => {
    let p = asked.get(title)
    if (!p) asked.set(title, p = approve(title).then(yes => { if (!yes) asked.delete(title); return yes }, e => { asked.delete(title); throw e }))
    return p
  }
}

/** What the host's `isolate` gives for a pod: `standIn`, asking first when its frame shares the page's origin
 * (`sandbox`) and its provider is foreign (`origin`). An `isolated-sandbox` frame never asks. */
export const isolated = (standIn: Implementation, isolation: Pod['isolation'], origin: string | undefined, approve: Approve) =>
  isolation === 'sandbox' && origin ? asking(standIn, origin, approve) : standIn

/** The interfaces with their op hashes, to tell a module that changed since it was probed. */
const shape = (i: Implementation) => i.provides.map(f => `${f.coord}:${Object.values(f.ops).map(o => o.coord).join()}`).join(';')

/** `probed` whose implementations, run in this page, ask first, then run the real one from `url`; and `load`, which
 * loads `url` once (again only after a failure). */
export function gated(probed: Provider, url: string, origin: string, deps: { load(url: string): Promise<unknown>; approve: Approve }): [Provider, () => Promise<Provider>] {
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

export const isProvider = (p: unknown, coord: string): p is Provider =>
  typeof p === 'object' && p !== null && (p as Provider).coord === coord && (p as Provider).implementations instanceof Map
