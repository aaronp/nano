/**
 * Members: instance coords, the member record a runtime keeps per instance, and what a member offers.
 *
 *   instanceCoord('acme/log/mem', 'b')        // 'acme/log/mem#b'
 *   parseInstance('acme/log/mem#b')           // { implementation: 'acme/log/mem', id: 'b' }
 *   portOp(member.pod.implementation, port)   // the op behind a port key, or undefined
 */
import { COORD, portKey } from '../iface.ts'
import type { Implementation } from '../implementation.ts'
import type { Op } from '../op.ts'
import type { Pod } from '../pod.ts'
import type { Target } from '../selector.ts'

/** `config` is what the instance was created with; saving writes it. */
export type Member = { coord: string; pod: Pod; home: string; config?: unknown }

export const instanceCoord = (implementation: string, id: string): string => `${implementation}#${id}`

export function parseInstance(coord: string): { implementation: string; id: string } | undefined {
  const [implementation, id, ...rest] = coord.split('#')
  return id && !rest.length && COORD.test(implementation!) ? { implementation: implementation!, id } : undefined
}

export function portOp(impl: Implementation, port: string): Op | undefined {
  for (const i of impl.provides) for (const o of i.byCoord.values()) if (portKey(i.coord, o.coord) === port) return o
  return undefined
}

export const targetOf = (m: Member, tags: ReadonlySet<string>): Target => ({
  instance: m.coord,
  implementation: m.pod.implementation.coord,
  provider: m.pod.implementation.provider,
  provides: new Set(m.pod.implementation.provides.map(i => i.coord)),
  tags,
})
