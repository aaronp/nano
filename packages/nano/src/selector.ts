/**
 * Selectors: which call subscriptions a call may use — an interface, or data narrowing by tags, implementation,
 * provider, or the runtime the subscription is in.
 *
 *   selectorData(DB)                                    // { implements: 'acme/db' }
 *   matches({ implements: 'acme/db', tags: ['primary'] }, target)
 *   Selector.of(DB, { runtime: 'v2' })                          // still DB (typed clients survive), plus implements and runtime
 */
import type { Interface } from './iface.ts'

export type SelectorData = { implements?: string; tags?: string[]; implementation?: string; provider?: string; runtime?: string }
export type Selector = Interface | SelectorData

/** A pod as reached over one call subscription: its name, the runtime of that subscription, and what it is. */
export type Target = {
  name: string
  runtime: string
  implementation: string
  provider: string
  provides: ReadonlySet<string>
  tags: ReadonlySet<string>
}

const isInterface = (s: Selector): s is Interface => 'byCoord' in s

/** An interface (possibly narrowed by `Selector.of`) or plain selector data, as plain data. */
export function selectorData(s: Selector): SelectorData {
  if (!isInterface(s)) return s
  const { tags, implementation, provider, runtime } = s as SelectorData
  return {
    implements: s.coord, ...(tags && { tags }), ...(implementation !== undefined && { implementation }),
    ...(provider !== undefined && { provider }), ...(runtime !== undefined && { runtime }),
  }
}

/** An interface narrowed by tags, implementation, provider or runtime; still the interface, so a call's client stays typed. */
const of = <I extends Interface>(i: I, s: Omit<SelectorData, 'implements'> = {}): I & SelectorData => ({ ...i, ...s, implements: i.coord })

/** Every given field holds; all tags must be present on the target. */
export const matches = (s: SelectorData, t: Target): boolean =>
  (s.implements === undefined || t.provides.has(s.implements)) &&
  (s.tags ?? []).every(tag => t.tags.has(tag)) &&
  (s.implementation === undefined || s.implementation === t.implementation) &&
  (s.provider === undefined || s.provider === t.provider) &&
  (s.runtime === undefined || s.runtime === t.runtime)

/** `Selector.of(interface, narrowing?)`. */
export const Selector = { of }
