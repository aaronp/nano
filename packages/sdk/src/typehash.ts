/**
 * Type identity: a type's hash is the digest of its canonical form, so the same type gets the same id anywhere,
 * and looking types up is a map access.
 *
 * Canonical form of a (TypeBox / JSON Schema) type:
 *   - annotations are dropped (description, title, examples, default, $comment): rewording never changes a type;
 *   - `required`, `enum` and union members (anyOf / oneOf) are sorted: `A | B` is `B | A`;
 *   - a type with `$id` is *named*: its name is part of its identity (two records with the same fields but
 *     different names differ; a named wrapper is a brand). Inside another type, a named type appears only as
 *     `{ $ref: <its hash> }`, so every type stands alone.
 */
import type { TSchema } from 'typebox'
import { canonical, digestFor } from './data'

const ANNOTATIONS = new Set(['description', 'title', 'examples', 'default', '$comment'])
const SETS = new Set(['required', 'enum', 'anyOf', 'oneOf'])
const hashes = new WeakMap<object, string>()

function form(node: unknown, root: boolean): unknown {
  if (Array.isArray(node)) return node.map(n => form(n, false))
  if (node === null || typeof node !== 'object') return node
  const o = node as Record<string, unknown>
  if (!root && typeof o.$id === 'string') return { $ref: typeHash(o as TSchema) }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) {
    if (ANNOTATIONS.has(k) || v === undefined) continue
    const f = form(v, false)
    out[k] = SETS.has(k) && Array.isArray(f) ? [...f].sort((a, b) => canonical(a) < canonical(b) ? -1 : 1) : f
  }
  return out
}

/** The canonical form of a type (what its hash is computed from). */
export const canonicalType = (schema: TSchema): unknown => form(schema, true)

/** The type's id: the digest of its canonical form. Cached per schema object. */
export function typeHash(schema: TSchema): string {
  let h = hashes.get(schema)
  if (h === undefined) { h = digestFor(canonicalType(schema)); hashes.set(schema, h) }
  return h
}

export type OpRef = { instance: string; op: string }
/**
 * Which ops take (input) or give (output) each type, by type hash: what a designer highlights when a piece is
 * picked up. Built from the instances a context can see; rebuild when they change (`ctx.watch`).
 */
export function typeIndex(instances: readonly { name: string; manifest: { ops: readonly { name: string; input?: TSchema; output?: TSchema }[] } }[]) {
  const takes = new Map<string, OpRef[]>(), gives = new Map<string, OpRef[]>()
  const add = (m: Map<string, OpRef[]>, t: TSchema | undefined, r: OpRef) => { if (t) { const h = typeHash(t); m.set(h, [...(m.get(h) ?? []), r]) } }
  for (const i of instances) for (const o of i.manifest.ops) {
    const r = { instance: i.name, op: o.name }
    add(takes, o.input, r); add(gives, o.output, r)
  }
  return { takes, gives }
}
