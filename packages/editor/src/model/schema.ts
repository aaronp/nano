// Types are TypeBox schemas named by `title`. These helpers compare, hash and name them; nothing maps them.
import { canonical } from '@composable/core'
import { Type, type TSchema } from 'typebox'
import type { Look } from './looks'

/** A type as the editor passes it around: the schema, and a hand-picked look if there is one. */
export type TypeEntry = { type: TSchema; look?: Look }

/** A type's name. */
export const titleOf = (s: TSchema): string => ((s as { title?: string }).title ?? 'unknown')

/** The schema as JSON with sorted keys (core's): equal types give equal strings. */
export { canonical }

/** Same type, name included: a brand is not its base. */
export const sameType = (a: TSchema, b: TSchema) => canonical(a) === canonical(b)

/** An input that accepts any value: no constraints besides its name. */
export const takesAnything = (s: TSchema) => { const { title: _, ...rest } = s as Record<string, unknown>; return Object.keys(rest).length === 0 }

/** 32 bytes from the canonical JSON, to derive a look from. Not cryptographic. */
export function hashBytes(s: TSchema): number[] {
  const text = canonical(s), out: number[] = []
  for (let seed = 0; seed < 8; seed++) {
    let h = 0x811c9dc5 ^ (seed * 0x9e3779b9)
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h ^= h >>> 12
    out.push(h & 255, (h >>> 8) & 255, (h >>> 16) & 255, (h >>> 24) & 255)
  }
  return out
}

/** The types every editor has, which can't be renamed or removed. */
export const builtins = (): TypeEntry[] => [
  { type: Type.String({ title: 'string' }) }, { type: Type.Number({ title: 'number' }) },
  { type: Type.Boolean({ title: 'boolean' }) }, { type: Type.Unknown({ title: 'unknown' }) },
]
/** Whether a title names a built-in type. */
export const isBuiltin = (title: string) => ['string', 'number', 'boolean', 'unknown'].includes(title)

/** A brand: a copy of `base` under a new name. */
export const brandOf = (base: TSchema, title: string): TSchema => ({ ...structuredClone(base), title })
