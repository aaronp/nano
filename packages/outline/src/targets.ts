/**
 * A placed pod as a selector sees it (`Target`), read from a deployment and the registry, for `matches`.
 *
 *   const target = targets(d, registry)
 *   target('store', 'main')   // { name, runtime, implementation, provider, provides, tags }, or undefined (unknown pod or implementation)
 */
import type { AppDeployment, Registry, Target } from '@pritzlaff/nano-core'

/** Reads `d` at each call, so it follows edits made to `d` after. */
export const targets = (d: AppDeployment, registry: Registry) => (name: string, runtime: string): Target | undefined => {
  const impl = registry.implementation(d.pods[name]?.implementation ?? '')
  return impl && { name, runtime, implementation: impl.coord, provider: impl.provider, provides: new Set(impl.provides.map(i => i.coord)), tags: new Set(d.tags?.[name] ?? []) }
}
