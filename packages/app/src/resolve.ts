import type { Coord } from '@pritzlaff/nano-core'

export type Selector = { implements: string; tags?: string[]; layer?: string; at?: string }
export type Candidate = { coord: Coord; ops: string[]; tags: string[] }
export type Provider = { kind: string; implements: string[] }
export type ResolveContext = { requester: Coord; interfaceOps: string[]; systems: string[]; candidates: Candidate[]; providers: Provider[] }
export type Resolution = { bound: Coord } | { make: string } | { choose: { candidates: Coord[]; kinds: string[] }; reason: string }

// Pure: picks an instance, names a kind to make, or asks for a choice. Never throws, never binds the requester to itself.
export const resolve = (selector: Selector, ctx: ResolveContext): Resolution => {
  const layer = selector.layer ?? ctx.requester.registry
  const choose = (candidates: Coord[], kinds: string[], reason: string): Resolution => ({ choose: { candidates, kinds }, reason })
  if (!ctx.systems.includes(layer)) return choose([], [], `no system ${layer}`)
  const fits = ctx.candidates.filter(c =>
    c.coord.registry === layer &&
    !(c.coord.registry === ctx.requester.registry && c.coord.instance === ctx.requester.instance) &&
    ctx.interfaceOps.every(o => c.ops.includes(o)) &&
    (selector.tags ?? []).every(t => c.tags.includes(t)))
  if (selector.at !== undefined) {
    const pinned = fits.find(c => c.coord.instance === selector.at)
    return pinned ? { bound: pinned.coord } : choose([], [], `${layer}/${selector.at} doesn't fit`)
  }
  if (fits.length === 1) return { bound: fits[0]!.coord }
  const kinds = ctx.providers.filter(p => p.implements.includes(selector.implements)).map(p => p.kind)
  if (fits.length === 0 && kinds.length === 1) return { make: kinds[0]! }
  return choose(fits.map(c => c.coord), kinds, fits.length ? `${fits.length} match` : 'nothing matches')
}
