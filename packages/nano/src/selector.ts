/**
 * Selectors: which targets a call or dependency may use — an interface, or data narrowing by tags, implementation, provider.
 *
 *   selectorData(DB)                                    // { implements: 'acme/db' }
 *   matches({ implements: 'acme/db', tags: ['primary'] }, target)
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

export const selectorData = (s: Selector): SelectorData => (isInterface(s) ? { implements: s.coord } : s)

/** Every given field holds; all tags must be present on the target. */
export const matches = (s: SelectorData, t: Target): boolean =>
  (s.implements === undefined || t.provides.has(s.implements)) &&
  (s.tags ?? []).every(tag => t.tags.has(tag)) &&
  (s.implementation === undefined || s.implementation === t.implementation) &&
  (s.provider === undefined || s.provider === t.provider)
