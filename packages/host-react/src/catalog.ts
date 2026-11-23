/** What can be picked: every implementation the registry has, with its provider and its default view tag, if any. */
import type { Registry } from '@pritzlaff/nano-core'
import type { ViewMap } from '@pritzlaff/nano-ui'

export type Entry = { implementation: string; provider: string; title: string; tag?: string }

export const catalog = (registry: Registry, views: ViewMap): Entry[] =>
  registry.manifest().providers.flatMap(p => p.implementations.map(implementation => ({
    implementation, provider: p.coord, title: implementation.slice(implementation.indexOf('/') + 1),
    ...(views[implementation] && { tag: views[implementation] }),
  })))
