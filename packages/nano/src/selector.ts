/**
 * Selectors: which targets a call or dependency may use — an interface, or data narrowing by tags, implementation, provider.
 *
 *   selectorData(DB)                                    // { implements: 'acme/db' }
 *   matches({ implements: 'acme/db', tags: ['primary'] }, target)
 *   sel(DB, { tags: ['cache'] })                        // still DB (typed clients survive), plus implements and tags
 */
import type { Interface } from './iface.ts'

export type SelectorData = { implements?: string; tags?: string[]; implementation?: string; provider?: string }
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
  const { tags, implementation, provider } = s as SelectorData
  return { implements: s.coord, ...(tags && { tags }), ...(implementation !== undefined && { implementation }), ...(provider !== undefined && { provider }) }
}

/** An interface narrowed by tags, implementation or provider; still the interface, so a call's client stays typed. */
export const sel = <I extends Interface>(i: I, s: Omit<SelectorData, 'implements'> = {}): I & SelectorData => ({ ...i, ...s, implements: i.coord })

/** Every given field holds; all tags must be present on the target. */
export const matches = (s: SelectorData, t: Target): boolean =>
  (s.implements === undefined || t.provides.has(s.implements)) &&
  (s.tags ?? []).every(tag => t.tags.has(tag)) &&
  (s.implementation === undefined || s.implementation === t.implementation) &&
  (s.provider === undefined || s.provider === t.provider)

/** One end of a connection: which pod (by id, interface or implementation), then which of its instances. */
export type EndSelector = {
  target: { pod: string } | { implements: string } | { implementation: string }
  instance: { by: 'first' } | { by: 'index'; index: number } | { by: 'tags'; tags: string[] }
}
