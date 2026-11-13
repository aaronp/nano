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
  for (const i of implementations) if (i.provider !== coord) throw new Error(`${i.coord} is not under ${coord}`)
  return { coord, implementations: new Map(implementations.map(i => [i.coord, i])), meta }
}
