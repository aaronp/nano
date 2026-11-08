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

/** Shape check, then every type reference must resolve. Names the first problem. */
export function checkDoc(d: unknown): Result<EditorDoc> {
  if (!isObj(d)) return fail('validation', 'document is not an object')
  const { types, components, connections } = d
  if (!Array.isArray(types)) return fail('validation', 'types must be an array')
  if (!Array.isArray(components)) return fail('validation', 'components must be an array')
  if (!isObj(connections) || !Array.isArray(connections.intents) || !isObj(connections.layout)) return fail('validation', 'connections must have intents and layout')
  const doc = d as EditorDoc
  const known = (ref?: TypeRef) => !ref || doc.types.some(t => t.id === ref.type)
  for (const t of doc.types) {
    if (!isObj(t) || typeof t.id !== 'string' || typeof t.kind !== 'string') return fail('validation', 'a type is malformed')
    if (t.kind === 'record') for (const f of t.fields) if (!known(f.ref)) return fail('validation', `${nameOf(t)}.${f.name} refers to unknown type ${f.ref.type}`)
    if (t.kind === 'brand' && !doc.types.some(x => x.id === t.of)) return fail('validation', `${nameOf(t)} is based on unknown type ${t.of}`)
  }
  for (const c of doc.components) for (const o of c.ops) for (const k of ['input', 'output'] as const)
    if (!known(o[k])) return fail('validation', `${c.id.author}/${c.id.id}/${o.name} ${k} refers to unknown type ${o[k]!.type}`)
  return ok(doc)
}
