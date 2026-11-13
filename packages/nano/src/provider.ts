/**
 * Providers: a namespace of implementations, plus free-form metadata.
 *
 *   const mem = provider('acme/mem', [memDb, memLog], { author: 'acme' })
 *   mem.implementations.get('acme/mem/db')   // memDb
 */
import type { Implementation } from './implementation.ts'

export type Provider = {
  readonly coord: string
  readonly implementations: ReadonlyMap<string, Implementation>
  readonly meta: Readonly<Record<string, string>>
}

export function provider(coord: string, implementations: Implementation[], meta: Record<string, string> = {}): Provider {
  const byCoord = new Map<string, Implementation>()
  for (const i of implementations) {
    if (i.provider !== coord) throw new Error(`${i.coord} is not under ${coord}`)
    if (byCoord.has(i.coord)) throw new Error(`${i.coord} is listed twice`)
    byCoord.set(i.coord, i)
  }
  return { coord, implementations: byCoord, meta }
}
