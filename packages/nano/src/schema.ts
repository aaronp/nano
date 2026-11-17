/**
 * Schema definitions: a TypeBox schema paired with its canonical hash, an optional label and a JSON codec. A definition
 * is itself the schema, so it nests in another directly.
 *
 *   const Rec = Schema.define(Type.Object({ id: Type.String() }), 'Record')
 *   Type.Array(Rec)                // nests as it is; Static<typeof Rec> is its type
 *   Rec.hash                       // 64-char blake3 hex of the canonical schema (the label does not count)
 *   Rec.decode(Rec.encode(value))  // the value, or undefined if it doesn't fit
 */
import { blake3 } from '@noble/hashes/blake3'
import { utf8ToBytes, bytesToHex } from '@noble/hashes/utils'
import { canonicalize } from 'json-canonicalize'
import { Compile } from 'typebox/compile'
import type { Static, TSchema } from 'typebox'

export type SchemaDef<S extends TSchema = TSchema> = S & {
  readonly label?: string
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
// Data values: copied as-is, so two schemas with different constants never hash equal.
const DATA = new Set(['const', 'enum', 'default'])
const MAPS = new Set(['properties', 'patternProperties', '$defs'])

// Strip annotations at every depth; keys of a name map are property names, so they stay.
function strip(node: unknown, isMap = false): unknown {
  if (Array.isArray(node)) return node.map(n => strip(n))
  if (node === null || typeof node !== 'object') return node
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(node)) {
    if (!isMap && NOTES.has(k)) continue
    // `required` is a set: its order follows property order, which must not matter.
    out[k] = isMap ? strip(v) : DATA.has(k) ? v : k === 'required' && Array.isArray(v) ? [...v].sort() : strip(v, MAPS.has(k))
  }
  return out
}

/** Plain JSON data: null, booleans, finite numbers, strings, arrays and plain objects of them, without cycles. */
export function isJson(v: unknown, seen = new Set<unknown>()): boolean {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return true
  if (typeof v === 'number') return Number.isFinite(v)
  if (typeof v !== 'object' || seen.has(v)) return false
  const proto = Object.getPrototypeOf(v)
  if (!Array.isArray(v) && proto !== Object.prototype && proto !== null) return false
  seen.add(v)
  const ok = Object.values(v).every(x => isJson(x, seen))
  seen.delete(v)
  return ok
}

export const canonicalSchema = (schema: TSchema): string => canonical(strip(schema))

// A function anywhere (own keys, enumerable or not) means the schema can't be JSON: a Refine keeps its check in a hidden `~refine`.
// A definition nested in another was checked when it was defined; its own methods don't count.
const defs = new WeakSet<object>()
function hasFunction(node: unknown, seen = new Set<unknown>()): boolean {
  if (typeof node === 'function') return true
  if (node === null || typeof node !== 'object' || seen.has(node) || defs.has(node)) return false
  seen.add(node)
  return Reflect.ownKeys(node).some(k => hasFunction((node as Record<PropertyKey, unknown>)[k], seen))
}

/** A copy of `schema` (non-enumerable keys kept), with the definition's members added out of sight of hashing. */
function define<S extends TSchema>(schema: S, label?: string): SchemaDef<S> {
  if (hasFunction(schema)) throw new Error(`${label ?? 'schema'}: schema is not JSON`)
  // Compiled on first use (JIT where the page allows `eval`, else TypeBox interprets): the same answer as Value.Check.
  let compiled: ReturnType<typeof Compile<S>> | undefined
  const check = (v: unknown): v is Static<S> => (compiled ??= Compile(schema)).Check(v)
  const members = {
    ...(label !== undefined && { label }),
    schema,
    hash: hashOf(canonicalSchema(schema)),
    check,
    encode: (v: Static<S>) => JSON.stringify(v),
    decode(json: string) {
      try {
        const v: unknown = JSON.parse(json)
        return check(v) ? v : undefined
      } catch {
        return undefined
      }
    },
  }
  const def = Object.defineProperties({}, Object.getOwnPropertyDescriptors(schema))
  for (const [k, value] of Object.entries(members)) Object.defineProperty(def, k, { value })
  defs.add(def)
  return def as SchemaDef<S>
}

/** `Schema.define(typeboxSchema, label?)`. */
export const Schema = { define }
