/**
 * The Import dialog's choices as pure edits of a fetched nano.json, applied before it is merged: its runtimes renamed
 * (so a file's `main` lands as `acme.template.main`, or merges into a runtime already there), and its pods' isolation
 * by Trust. Opening a file may only tighten isolation without asking: Trusted never loosens a pod the file sandboxes.
 *
 *   trusted(renameRuntimes(d, { main: suggestedName(d, 'main') }), 'sandboxed')
 */
import type { AppDeployment, Pod, Subscription } from '@pritzlaff/nano-core'
import type { LayoutData } from '@pritzlaff/nano-ui'

export type Trust = 'sandboxed' | 'trusted'

/** A runtime id (the id rule): no `/`, whitespace or `#`, 1 to 64 characters. */
export const validRuntimeId = (s: string) => /^[^/\s#\x00-\x1f\x7f]{1,64}$/.test(s)

/** `d` with each runtime `k` of `names` renamed `names[k]`: the `runtimes` keys and the layout's slots. Pure. */
export function renameRuntimes(d: AppDeployment, names: Record<string, string>): AppDeployment {
  const to = (id: string) => (Object.hasOwn(names, id) ? names[id]! : id)
  const out: AppDeployment = { ...d, runtimes: Object.fromEntries(Object.entries(d.runtimes).map(([id, r]) => [to(id), r])) }
  const slots = (d.layout as LayoutData | undefined)?.slots
  if (Array.isArray(slots)) out.layout = { ...d.layout, slots: slots.map(s => ({ ...s, runtime: to(s.runtime) })) }
  return out
}

/** Whether the workspace already has provider `coord` loaded: its pods are not new code, so Trust leaves them be. */
type Known = (coord: string) => boolean
const none: Known = () => false
const providerOf = (p: Pod) => p.implementation.slice(0, p.implementation.lastIndexOf('/'))

/** `<namespace>.<runtime>`: the provider of the runtime's pods new to the workspace, the first in `modules` order; the
 * runtime alone if none, or if its id is already dotted (namespaced). */
export function suggestedName(d: AppDeployment, runtime: string, known: Known = none): string {
  if (runtime.includes('.')) return runtime
  const providers = new Set((d.runtimes[runtime]?.pods ?? []).flatMap(p => (d.pods[p] ? [providerOf(d.pods[p])] : [])))
  const ns = Object.keys(d.modules ?? {}).find(c => providers.has(c) && !known(c))
  return ns ? `${ns}.${runtime}` : runtime
}

/** The isolation pod `p` gets under `trust`: Sandboxed always isolated-sandbox; Trusted host, unless the file sandboxes
 * it; a pod of a provider the workspace has, the file's. */
export const isolationUnder = (p: Pod, trust: Trust, known: Known = none): NonNullable<Pod['isolation']> =>
  known(providerOf(p)) ? p.isolation ?? 'host' : trust === 'sandboxed' ? 'isolated-sandbox' : p.isolation === 'sandbox' || p.isolation === 'isolated-sandbox' ? p.isolation : 'host'

/** `d` with each pod's isolation under `trust` (host left out, as `Pod` writes it). Pure. */
export const trusted = (d: AppDeployment, trust: Trust, known: Known = none): AppDeployment => ({ ...d, pods: Object.fromEntries(Object.entries(d.pods).map(([n, p]) => {
  const { isolation: _, ...rest } = p, isolation = isolationUnder(p, trust, known)
  return [n, isolation === 'host' ? rest : { ...rest, isolation }]
})) })

const op = (coord: string) => coord.slice(coord.lastIndexOf('/') + 1)
/** Why subscription `s` is left out, both its ends not kept; nothing when neither is (as text, never HTML). */
function leftOut(s: Subscription, keep: Set<string>): string[] {
  const missing = [s.from, s.to].filter(p => !keep.has(p))
  if (missing.length !== 1) return []
  if (s.kind === 'pipe') return [`pipe ${s.from}.${op(s.source)} → ${s.to}.${op(s.target)} is left out (${missing[0]} not selected)`]
  return keep.has(s.from) ? [`${s.from} calls ${s.to}, which is not selected: ${s.from} will fail when it runs`] : [`call ${s.from} → ${s.to} is left out (${s.from} not selected)`]
}

/** `d` with only the pods in `keep`: a runtime left empty goes, a subscription stays only with both ends (else a
 * warning when one end is kept), and modules, slots, tags and views follow the kept pods. Policy rules stay as they are. Pure. */
export function selectPods(d: AppDeployment, keep: Set<string>): { deployment: AppDeployment; warnings: string[] } {
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
  if (d.tags) out.tags = kept(d.tags, p => keep.has(p))
  if (d.views) out.views = kept(d.views, k => keep.has(k) || implementations.has(k))
  const slots = (d.layout as LayoutData | undefined)?.slots
  if (Array.isArray(slots)) out.layout = { ...d.layout, slots: slots.filter(s => keep.has(s.pod)) }
  return { deployment: out, warnings }
}
