import type { Intent } from '@composable/connections'
import { fail, ok, type Result } from '@composable/sdk'
import type { DraftComponent } from './components'
import { builtins, nameOf, type EditorType, type TypeRef } from './types'

export type EditorDoc = {
  types: EditorType[]
  components: DraftComponent[]
  connections: { intents: Intent[]; layout: Record<string, { c: number; r: number }> }
}

export const emptyEditorDoc = (): EditorDoc => ({ types: builtins(), components: [], connections: { intents: [], layout: {} } })

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)

const bad = (m: string) => fail('validation', m)
const isRef = (r: unknown): r is TypeRef => isObj(r) && typeof r.type === 'string' && typeof r.array === 'boolean'

/** Shape check of every element, then every type reference must resolve. Never throws; names the first problem. */
export function checkDoc(d: unknown): Result<EditorDoc> {
  if (!isObj(d)) return bad('document is not an object')
  const { types, components, connections } = d
  if (!Array.isArray(types)) return bad('types must be an array')
  if (!Array.isArray(components)) return bad('components must be an array')
  if (!isObj(connections) || !Array.isArray(connections.intents) || !isObj(connections.layout)) return bad('connections must have intents and layout')
  for (const [i, t] of types.entries()) {
    if (!isObj(t) || typeof t.id !== 'string' || typeof t.kind !== 'string') return bad(`type ${i} is malformed`)
    if (t.kind !== 'live' && typeof t.name !== 'string') return bad(`type ${t.id} has no name`)
    if (t.kind === 'record') {
      if (!Array.isArray(t.fields)) return bad(`${t.name} has no fields array`)
      for (const [j, f] of t.fields.entries())
        if (!isObj(f) || typeof f.name !== 'string' || !isRef(f.ref)) return bad(`${t.name} field ${j} is malformed`)
    } else if (t.kind === 'brand' && typeof t.of !== 'string') return bad(`${t.name} has no base type`)
  }
  for (const [i, c] of components.entries()) {
    if (!isObj(c) || !isObj(c.id) || typeof c.id.author !== 'string' || typeof c.id.id !== 'string' || !Array.isArray(c.ops)) return bad(`component ${i} is malformed`)
    for (const [j, o] of c.ops.entries())
      if (!isObj(o) || typeof o.name !== 'string' || (o.input !== undefined && !isRef(o.input)) || (o.output !== undefined && !isRef(o.output)))
        return bad(`${c.id.author}/${c.id.id} op ${j} is malformed`)
  }
  const doc = d as EditorDoc
  const known = (ref?: TypeRef) => !ref || doc.types.some(t => t.id === ref.type)
  for (const t of doc.types) {
    if (t.kind === 'record') for (const f of t.fields) if (!known(f.ref)) return bad(`${nameOf(t)}.${f.name} refers to unknown type ${f.ref.type}`)
    if (t.kind === 'brand' && !doc.types.some(x => x.id === t.of)) return bad(`${nameOf(t)} is based on unknown type ${t.of}`)
  }
  for (const c of doc.components) for (const o of c.ops) for (const k of ['input', 'output'] as const)
    if (!known(o[k])) return bad(`${c.id.author}/${c.id.id}/${o.name} ${k} refers to unknown type ${o[k]!.type}`)
  return ok(doc)
}
