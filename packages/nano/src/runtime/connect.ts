/**
 * Connecting: an end selector (which pod, then which instance of it) resolved once to one concrete instance coord.
 * Pure over the runtime's pods (own and placed) and their tags; never throws — a malformed selector is `invalid-input`.
 *
 *   resolveEnd({ pods, tagsOf }, { target: { pod: 'vault' }, instance: { by: 'first' } })   // success('vault#0')
 *   resolveEnd({ pods, tagsOf }, { target: { implements: 'acme/vault' }, instance: { by: 'index', index: 0 } })   // fail ambiguous: 2 match
 */
import { failure, success, type NanoResult } from '../result.ts'
import type { EndSelector } from '../selector.ts'
import { parseInstance, type PodRecord } from './pods.ts'

const isObj = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null

export function resolveEnd(rt: { pods: ReadonlyMap<string, PodRecord>; tagsOf: (coord: string) => ReadonlySet<string> }, end: EndSelector): NanoResult<string> {
  const t: unknown = end?.target, sel: unknown = end?.instance
  if (!isObj(t) || !isObj(sel)) return failure('invalid-input', 'an end needs a target and an instance selector')
  const all = [...rt.pods.values()]
  const pods = 'pod' in t ? all.filter(p => p.id === t.pod)
    : 'implements' in t ? all.filter(p => p.implementation.provides.some(i => i.coord === t.implements))
    : 'implementation' in t ? all.filter(p => p.implementation.coord === t.implementation) : undefined
  if (!pods) return failure('invalid-input', 'a target is a pod, an interface it implements, or an implementation')
  const hits: string[] = []
  for (const p of pods) {
    const list = [...p.instances.values()]
    switch (sel.by) {
      case 'first': { const i = list.filter(i => i.state === 'running').sort((a, b) => parseInstance(a.coord)!.index - parseInstance(b.coord)!.index)[0]; if (i) hits.push(i.coord); break }
      case 'index': hits.push(...list.filter(i => parseInstance(i.coord)!.index === sel.index).map(i => i.coord)); break
      case 'tags':
        if (!Array.isArray(sel.tags) || !sel.tags.every(x => typeof x === 'string')) return failure('invalid-input', 'tags must be strings')
        hits.push(...list.filter(i => sel.tags.every((x: string) => rt.tagsOf(i.coord).has(x))).map(i => i.coord)); break
      default: return failure('invalid-input', `unknown instance selector ${JSON.stringify(sel.by)}`)
    }
  }
  if (hits.length === 0) return failure('not-found', `nothing matches ${JSON.stringify(end)}`)
  if (hits.length > 1) return failure('ambiguous', `${hits.length} match ${JSON.stringify(end)}: ${hits.join(', ')}`)
  return success(hits[0]!)
}
