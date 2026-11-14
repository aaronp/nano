/**
 * Connecting: an end given as a coord is used as is; an `EndSelector` is resolved once to the one registered pod it
 * matches. Pure over the runtime's pods and their targets; never throws — a malformed selector is `invalid-input`.
 *
 *   resolveEnd(rt, { implements: 'acme/vault' })                 // success('acme/keys/vault#0'), or ambiguous: 2 match
 *   resolveEnd(rt, { implementation: 'acme/db/mem', tags: ['cache'] })
 */
import { failure, success, type NanoResult } from '../result.ts'
import { matches, type EndSelector, type Target } from '../selector.ts'

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

export function resolveEnd(rt: { coords: Iterable<string>; target(coord: string): Target | undefined }, sel: string | EndSelector): NanoResult<string> {
  if (typeof sel === 'string') return success(sel)
  const end: unknown = sel
  if (!isObj(end)) return failure('invalid-input', 'an end is a coord or a selector')
  const kind = (['coord', 'implements', 'implementation'] as const).find(k => k in end)
  if (!kind) return failure('invalid-input', 'an end selector names a coord, an interface it implements, or an implementation')
  const named = end[kind], tags = end.tags ?? []
  if (typeof named !== 'string') return failure('invalid-input', `${kind} must be a string`)
  if (!Array.isArray(tags) || !tags.every(t => typeof t === 'string')) return failure('invalid-input', 'tags must be strings')
  const hits = [...rt.coords].filter(c => {
    const t = rt.target(c)
    return !!t && (kind === 'coord' ? c === named : matches({ [kind]: named, tags }, t))
  })
  if (hits.length === 0) return failure('not-found', `nothing matches ${kind} ${named}`)
  if (hits.length > 1) return failure('ambiguous', `${hits.length} match ${kind} ${named}: ${hits.join(', ')}`)
  return success(hits[0]!)
}
