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

/** `<namespace>.<runtime>`: the provider of the runtime's pods, the first in `modules` order; the runtime alone if none. */
export function suggestedName(d: AppDeployment, runtime: string): string {
  const providers = new Set((d.runtimes[runtime]?.pods ?? []).map(p => d.pods[p]?.implementation.split('/')[0]))
  const ns = Object.keys(d.modules ?? {}).find(c => providers.has(c))
  return ns ? `${ns}.${runtime}` : runtime
}

/** The isolation pod `p` gets under `trust`: Sandboxed always isolated-sandbox; Trusted host, unless the file sandboxes it. */
export const isolationUnder = (p: Pod, trust: Trust): NonNullable<Pod['isolation']> =>
  trust === 'sandboxed' ? 'isolated-sandbox' : p.isolation === 'sandbox' || p.isolation === 'isolated-sandbox' ? p.isolation : 'host'

/** `d` with each pod's isolation under `trust` (host left out, as `Pod` writes it). Pure. */
export const trusted = (d: AppDeployment, trust: Trust): AppDeployment => ({ ...d, pods: Object.fromEntries(Object.entries(d.pods).map(([n, p]) => {
  const { isolation: _, ...rest } = p, isolation = isolationUnder(p, trust)
  return [n, isolation === 'host' ? rest : { ...rest, isolation }]
})) })
