/**
 * The Import dialog's choices as pure edits of a fetched nano.json, applied before it is merged: its runtimes renamed
 * (so a file's `main` lands as `acme.template.main`, or merges into a runtime already there), and its pods' isolation
 * by Trust. Opening a file may only tighten isolation without asking: Trusted never loosens a pod the file sandboxes.
 *
 *   trusted(renameRuntimes(d, { main: suggestedName(d, 'main') }), 'sandboxed')
 */
import type { AppDeployment, Pod } from '@pritzlaff/nano-core'
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
