/**
 * Selectors: which targets a call or dependency may use — an interface, or data narrowing by tags, implementation,
 * provider, or the runtime the call travels through (one of the pod's runtimes, by name).
 *
 *   selectorData(DB)                                    // { implements: 'acme/db' }
 *   matches({ implements: 'acme/db', tags: ['primary'] }, target)
 *   sel(DB, { tags: ['cache'] })                        // still DB (typed clients survive), plus implements and tags
 */
import type { Interface } from './iface.ts'

export type SelectorData = { implements?: string; tags?: string[]; implementation?: string; provider?: string; runtime?: string }
export type Selector = Interface | SelectorData

export type Target = {
  instance: string
  implementation: string
  provider: string
  provides: ReadonlySet<string>
  tags: ReadonlySet<string>
}

const isInterface = (s: Selector): s is Interface => 'byCoord' in s

/** An interface (possibly narrowed by `sel`) or plain selector data, as plain data. */
export function selectorData(s: Selector): SelectorData {
  if (!isInterface(s)) return s
  const { tags, implementation, provider, runtime } = s as SelectorData
  return {
    implements: s.coord, ...(tags && { tags }), ...(implementation !== undefined && { implementation }),
    ...(provider !== undefined && { provider }), ...(runtime !== undefined && { runtime }),
  }
}

/** An interface narrowed by tags, implementation, provider or runtime; still the interface, so a call's client stays typed. */
export const sel = <I extends Interface>(i: I, s: Omit<SelectorData, 'implements'> = {}): I & SelectorData => ({ ...i, ...s, implements: i.coord })

/** Every given field holds; all tags must be present on the target. `runtime` is not the target's: the verbs apply it. */
export const matches = (s: SelectorData, t: Target): boolean =>
  (s.implements === undefined || t.provides.has(s.implements)) &&
  (s.tags ?? []).every(tag => t.tags.has(tag)) &&
  (s.implementation === undefined || s.implementation === t.implementation) &&
  (s.provider === undefined || s.provider === t.provider)

/** One end of a connection: a registered pod by coord, or the one pod implementing an interface or of an implementation, with these tags. */
export type EndSelector = { coord: string } | { implements: string; tags?: string[] } | { implementation: string; tags?: string[] }
