/**
 * Dependencies: an op may need another component's op to run. A dependency names the op's *shape* (input and
 * output SAIDs) and, optionally, which components may provide it; any instance with such an op does. All pure.
 */
import { typeHash } from './typehash'
import type { Dependency, Instance, Manifest, Op } from './types'

const shape = (o: Op) => `${o.input ? typeHash(o.input) : '-'}>${o.output ? typeHash(o.output) : '-'}`

/** The first instance (other than `self`) providing `dep`, and its matching op; undefined if none. */
export function providerOf(dep: Dependency, instances: readonly Instance[], self?: string): { instance: string; op: Op } | undefined {
  const want = shape(dep.op)
  for (const i of instances) {
    if (i.id === self) continue
    if (dep.components && !dep.components.some(c => c.author === i.manifest.id.author && c.id === i.manifest.id.id)) continue
    const op = i.manifest.ops.find(o => o.input && shape(o) === want)
    if (op) return { instance: i.id, op }
  }
}

/** The dependencies `op` requires that nothing in `instances` provides (empty: the op is available). */
export const missing = (op: Op, manifest: Manifest, instances: readonly Instance[], self?: string): string[] =>
  (op.requires ?? []).filter(name => {
    const dep = manifest.dependencies?.find(d => d.name === name)
    return !dep || !providerOf(dep, instances, self)
  })
