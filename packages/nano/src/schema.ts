/**
 * Schema definitions: a TypeBox schema paired with its canonical hash and JSON codec.
 *
 *   const Rec = defineSchema('Record', Type.Object({ id: Type.String() }))
 *   Rec.hash                       // 64-char blake3 hex of the canonical schema
 *   Rec.decode(Rec.encode(value))  // the value, or undefined if it doesn't fit
 */
import { blake3 } from '@noble/hashes/blake3'
import { utf8ToBytes, bytesToHex } from '@noble/hashes/utils'
import { canonicalize } from 'json-canonicalize'
import { Value } from 'typebox/value'
import type { Static, TSchema } from 'typebox'

export type SchemaDef<S extends TSchema = TSchema> = {
  readonly type: string
  readonly schema: S
  readonly hash: string
  check(v: unknown): v is Static<S>
  encode(v: Static<S>): string
  decode(json: string): Static<S> | undefined
}

/** RFC 8785 canonical JSON. */
export const canonical = (value: unknown): string => canonicalize(value)

/** blake3 of the UTF-8 text, lower-case hex. */
export const hashOf = (text: string): string => bytesToHex(blake3(utf8ToBytes(text)))

const NOTES = new Set(['description', 'title', 'examples', '$comment'])
const MAPS = new Set(['properties', 'patternProperties', '$defs'])

// Strip annotations at every depth; keys of a name map are property names, so they stay.
function strip(node: unknown, isMap = false): unknown {
  if (Array.isArray(node)) return node.map(n => strip(n))
  if (node === null || typeof node !== 'object') return node
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(node)) {
    if (!isMap && NOTES.has(k)) continue
    // `required` is a set: its order follows property order, which must not matter.
    out[k] = !isMap && k === 'required' && Array.isArray(v) ? [...v].sort() : strip(v, !isMap && MAPS.has(k))
  }
  return out
}

export const canonicalSchema = (schema: TSchema): string => canonical(strip(schema))

// A function anywhere (own keys, enumerable or not) means the schema can't be JSON: a Refine keeps its check in a hidden `~refine`.
function hasFunction(node: unknown, seen = new Set<unknown>()): boolean {
  if (typeof node === 'function') return true
  if (node === null || typeof node !== 'object' || seen.has(node)) return false
  seen.add(node)
  return Reflect.ownKeys(node).some(k => hasFunction((node as Record<PropertyKey, unknown>)[k], seen))
}

export function defineSchema<S extends TSchema>(type: string, schema: S): SchemaDef<S> {
  if (hasFunction(schema)) throw new Error(`${type}: schema is not JSON`)
  const check = (v: unknown): v is Static<S> => Value.Check(schema, v)
  return {
    type,
    schema,
    hash: hashOf(canonicalSchema(schema)),
    check,
    encode: v => JSON.stringify(v),
    decode(json) {
      try {
        const v: unknown = JSON.parse(json)
        return check(v) ? v : undefined
      } catch {
        return undefined
      }
    },
  }
}
