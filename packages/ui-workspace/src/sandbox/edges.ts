/**
 * A pod's call edges as data, for its frame: what the frame's `ctx.one`/`ctx.all` match selectors against.
 *
 *   edgesFor(app.deployment(), registry, 's')   // [{ pod: 'h', runtime: 'r', implementation: 'acme/h', … }]
 */
import type { AppDeployment, Registry } from '@pritzlaff/nano-core'

export type Edge = { pod: string; runtime: string; implementation: string; provider: string; provides: string[]; tags: string[] }

/** The call subscriptions from `pod` in every runtime (one in its target's runtime counts too, as nano's `ctx.one`), in deployment order. */
export const edgesFor = (d: AppDeployment, registry: Registry, pod: string): Edge[] =>
  Object.entries(d.runtimes).flatMap(([runtime, r]) => r.subscriptions.flatMap(s => {
    const i = s.kind === 'call' && s.from === pod ? registry.implementation(d.pods[s.to]?.implementation ?? '') : undefined
    return i ? [{ pod: s.to, runtime, implementation: i.coord, provider: i.provider, provides: i.provides.map(f => f.coord), tags: [...(d.tags?.[s.to] ?? [])] }] : []
  }))
