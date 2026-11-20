/**
 * The Import dialog's choices as pure edits of a fetched nano.json, applied before it is merged: its runtimes renamed
 * (so a file's `main` lands as `acme.template.main`, or merges into a runtime already there), and its pods' isolation
 * by Trust. Opening a file may only tighten isolation without asking: Trusted never loosens a pod the file sandboxes.
 *
 *   trusted(renameRuntimes(d, { main: suggestedName(d, 'main') }), 'sandboxed')
 */
import { failure, success, type AppDeployment, type NanoResult, type Pod, type Subscription } from '@pritzlaff/nano-core'
import type { LayoutData, LayoutSlot, Page } from '@pritzlaff/nano-ui'

export type Trust = 'sandboxed' | 'trusted'

/** A runtime id (the id rule): no `/`, whitespace or `#`, 1 to 64 characters. */
export const validRuntimeId = (s: string) => /^[^/\s#\x00-\x1f\x7f]{1,64}$/.test(s)

/** `d.layout` with each pod slot edited (`[]` drops it), in its legacy `slots` and in its `pages` (view slots kept). */
function podSlots(d: AppDeployment, edit: (s: LayoutSlot) => LayoutSlot[]): AppDeployment['layout'] {
  const { slots, pages } = (d.layout ?? {}) as LayoutData, each = (s: Page['slots']) => s.flatMap((s): Page['slots'] => 'pod' in s ? edit(s) : [s])
  return { ...d.layout, ...(Array.isArray(slots) && { slots: each(slots) }), ...(Array.isArray(pages) && { pages: pages.map(p => Array.isArray(p?.slots) ? { ...p, slots: each(p.slots) } : p) }) }
}

/** `d` with each runtime `k` of `names` renamed `names[k]`: the `runtimes` keys and the layout's slots, its pages' too. Pure. */
export function renameRuntimes(d: AppDeployment, names: Record<string, string>): AppDeployment {
  const to = (id: string) => (Object.hasOwn(names, id) ? names[id]! : id)
  const out: AppDeployment = { ...d, runtimes: Object.fromEntries(Object.entries(d.runtimes).map(([id, r]) => [to(id), r])) }
  if (d.layout) out.layout = podSlots(d, s => [{ ...s, runtime: to(s.runtime) }])
  return out
}

/** Whether the workspace already has provider `coord` loaded: its pods are not new code, so Trust leaves them be. */
type Known = (coord: string) => boolean
const none: Known = () => false
const providerOf = (p: Pod) => p.implementation.slice(0, p.implementation.lastIndexOf('/'))

/** The pods of provider `coord` in `d`, each with its isolation and whether it runs with this page's full access (a
 * home-origin frame is its provider's own origin): what an import gates, and so what the Import dialog warns of. */
export const podsOf = (d: AppDeployment, coord: string, isolationOf: (p: Pod) => NonNullable<Pod['isolation']>) =>
  Object.entries(d.pods).filter(([, p]) => providerOf(p) === coord).map(([name, p]) => {
    const isolation = isolationOf(p)
    return { name, isolation, fullAccess: isolation !== 'isolated-sandbox' && isolation !== 'home-origin' }
  })

/** Whether a provider is the workspace's own (Trust leaves its pods as the file has them): loaded here, from this
 * page's origin. A foreign provider imported before is not: a file naming it again still gets the user's Trust. */
export const ownProvider = (loaded: boolean, stored: string | undefined): boolean => {
  const at = stored && /^https?:\/\//i.test(stored) ? new URL(stored).origin : undefined   // stored whole only when foreign
  return loaded && (at === undefined || at === globalThis.location?.origin)
}

export function suggestedName(d: AppDeployment, runtime: string, known: Known = none): string {
  if (runtime.includes('.')) return runtime
  const providers = new Set((d.runtimes[runtime]?.pods ?? []).flatMap(p => (d.pods[p] ? [providerOf(d.pods[p])] : [])))
  const ns = Object.keys(d.modules ?? {}).find(c => providers.has(c) && !known(c))
  return ns ? `${ns}.${runtime}` : runtime
}

/** The isolation pod `p` gets under `trust`: Sandboxed always isolated-sandbox; Trusted host, unless the file sandboxes
 * it; a pod of a provider the workspace has, the file's; a home-origin pod stays one (it runs as its provider's origin, apart from this page). */
export const isolationUnder = (p: Pod, trust: Trust, known: Known = none): NonNullable<Pod['isolation']> =>
  known(providerOf(p)) || p.isolation === 'home-origin' ? p.isolation ?? 'host' : trust === 'sandboxed' ? 'isolated-sandbox' : p.isolation === 'sandbox' || p.isolation === 'isolated-sandbox' ? p.isolation : 'host'

/** `d` with each pod's isolation under `trust` (host left out, as `Pod` writes it). A pod it runs in a frame is also
 * eager: nothing in this page can call it first, so a lazy one would never start and its panel would stay empty. Pure. */
export const trusted = (d: AppDeployment, trust: Trust, known: Known = none): AppDeployment => ({ ...d, pods: Object.fromEntries(Object.entries(d.pods).map(([n, p]) => {
  const { isolation: _, ...rest } = p, isolation = isolationUnder(p, trust, known)
  if (isolation === 'host') return [n, rest]
  return [n, known(providerOf(p)) ? { ...rest, isolation } : { ...rest, isolation, eager: true }]
})) })

const op = (coord: string) => coord.slice(coord.lastIndexOf('/') + 1)
/** Why subscription `s` is left out, both its ends not kept; nothing when neither is (as text, never HTML). */
/** A warning, with the selected pod it concerns (the end of the subscription that is kept). */
export type Warning = { pod: string; text: string }
function leftOut(s: Subscription, keep: Set<string>): Warning[] {
  const missing = [s.from, s.to].filter(p => !keep.has(p)), pod = keep.has(s.from) ? s.from : s.to
  return missing.length !== 1 ? [] : [{ pod, text: text(s, keep, missing[0]!) }]
}
function text(s: Subscription, keep: Set<string>, missing: string): string {
  if (s.kind === 'pipe') return `pipe ${s.from}.${op(s.source)} → ${s.to}.${op(s.target)} is left out (${missing} not selected)`
  return keep.has(s.from) ? `${s.from} calls ${s.to}, which is not selected: ${s.from} will fail when it runs` : `call ${s.from} → ${s.to} is left out (${s.from} not selected)`
}

/** `d` with only the pods in `keep`: a runtime left empty goes, a subscription stays only with both ends (else a
 * warning when one end is kept), and modules, slots, tags and views follow the kept pods. Policy rules stay as they are. Pure. */
export function selectPods(d: AppDeployment, keep: Set<string>): { deployment: AppDeployment; warnings: Warning[] } {
  const kept = <T>(o: Record<string, T> | undefined, by: (k: string) => boolean) => o && Object.fromEntries(Object.entries(o).filter(([k]) => by(k)))
  const pods = kept(d.pods, p => keep.has(p))!, implementations = new Set(Object.values(pods).map(p => p.implementation))
  const providers = new Set(Object.values(pods).map(providerOf))
  const warnings = Object.values(d.runtimes).flatMap(r => r.subscriptions.flatMap(s => leftOut(s, keep)))
  const runtimes = Object.fromEntries(Object.entries(d.runtimes).flatMap(([id, r]) => {
    const left = r.pods.filter(p => keep.has(p))
    return left.length ? [[id, { ...r, pods: left, subscriptions: r.subscriptions.filter(s => keep.has(s.from) && keep.has(s.to)) }]] : []
  }))
  const out: AppDeployment = { ...d, pods, runtimes }
  if (d.modules) out.modules = kept(d.modules, c => providers.has(c))
  if (d.frames) out.frames = kept(d.frames, c => providers.has(c))
  if (d.tags) out.tags = kept(d.tags, p => keep.has(p))
  if (d.views) out.views = kept(d.views, k => keep.has(k) || implementations.has(k))
  if (d.layout) out.layout = podSlots(d, s => keep.has(s.pod) ? [s] : [])
  return { deployment: out, warnings }
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
