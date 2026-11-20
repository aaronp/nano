/** What can be picked: every implementation the registry has, with its provider and its default view tag, if any. */
import type { Host } from './boot.ts'

export type Entry = { implementation: string; provider: string; title: string; tag?: string }

export const catalog = (h: Pick<Host, 'registry' | 'views'>): Entry[] =>
  h.registry.manifest().providers.flatMap(p => p.implementations.map(implementation => ({
    implementation, provider: p.coord, title: implementation.slice(implementation.indexOf('/') + 1),
    ...(h.views[implementation] && { tag: h.views[implementation] }),
  })))
