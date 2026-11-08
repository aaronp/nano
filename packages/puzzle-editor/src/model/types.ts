import { Type, type TSchema } from 'typebox'
import { fail, ok, typeHash, type Instance, type Result } from '@composable/sdk'
import type { Look } from './looks'

export type TypeRef = { type: string; array: boolean }
export type EditorType =
  | { id: string; kind: 'primitive'; name: 'string' | 'number' | 'boolean' }
  | { id: string; kind: 'record'; name: string; fields: { name: string; ref: TypeRef }[]; look?: Look }
  | { id: string; kind: 'brand'; name: string; of: string; look?: Look }
  | { id: string; kind: 'live'; schema: TSchema }

type Types = EditorType[]
const PRIMS = { string: Type.String, number: Type.Number, boolean: Type.Boolean }

export const builtins = (): Types => (['string', 'number', 'boolean'] as const).map(name => ({ id: name, kind: 'primitive', name }))

export const nameOf = (t: EditorType): string => t.kind === 'live' ? String((t.schema as { $id?: string }).$id ?? t.id) : t.name

const build = (id: string, types: Types, seen: string[]): Result<TSchema> => {
  if (seen.includes(id)) return fail('validation', 'brands refer to each other in a loop')
  const t = types.find(x => x.id === id)
  if (!t) return fail('validation', `unknown type ${id}`)
  const path = [...seen, id]
  switch (t.kind) {
    case 'primitive': return ok(PRIMS[t.name]())
    case 'live': return ok(t.schema)
    case 'brand': {
      const r = build(t.of, types, path)
      return r.type === 'success' ? ok({ ...r.data, $id: t.name } as TSchema) : r
    }
    case 'record': {
      const fields: Record<string, TSchema> = {}
      for (const f of t.fields) {
        const r = build(f.ref.type, types, path)
        if (r.type !== 'success') return r
        fields[f.name] = f.ref.array ? Type.Array(r.data) : r.data
      }
      return ok(Type.Object(fields, { $id: t.name }))
    }
  }
}

export const schemaOf = (id: string, types: Types): Result<TSchema> => build(id, types, [])
export const saidOf = (id: string, types: Types): Result<string> => {
  const r = schemaOf(id, types)
  return r.type === 'success' ? ok(typeHash(r.data)) : r
}

const taken = (types: Types, id: string): Result<never> | undefined =>
  types.some(t => t.id === id) ? fail('validation', `type ${id} already exists`) : undefined
const withType = <K extends EditorType['kind']>(types: Types, id: string, kind: K, f: (t: Extract<EditorType, { kind: K }>) => EditorType): Result<Types> => {
  const t = types.find(x => x.id === id)
  if (!t || t.kind !== kind) return fail('validation', `unknown ${kind} ${id}`)
  return ok(types.map(x => x === t ? f(t as Extract<EditorType, { kind: K }>) : x))
}

export const addRecord = (types: Types, id: string, name: string): Result<Types> =>
  taken(types, id) ?? ok([...types, { id, kind: 'record', name, fields: [] }])

export const addField = (types: Types, recordId: string, name: string, ref: TypeRef): Result<Types> =>
  !types.some(t => t.id === ref.type) ? fail('validation', `unknown type ${ref.type}`)
    : withType(types, recordId, 'record', t => t.fields.some(f => f.name === name) ? t : { ...t, fields: [...t.fields, { name, ref }] })

export const removeField = (types: Types, recordId: string, name: string): Result<Types> =>
  withType(types, recordId, 'record', t => ({ ...t, fields: t.fields.filter(f => f.name !== name) }))

export const addBrand = (types: Types, id: string, name: string, of: string): Result<Types> =>
  taken(types, id) ?? (types.some(t => t.id === of) ? ok([...types, { id, kind: 'brand', name, of }]) : fail('validation', `unknown type ${of}`))

export const rename = (types: Types, id: string, name: string): Result<Types> => {
  const t = types.find(x => x.id === id)
  return t && (t.kind === 'record' || t.kind === 'brand') ? ok(types.map(x => x === t ? { ...t, name } : x)) : fail('validation', `cannot rename ${id}`)
}

export const remove = (types: Types, id: string): Result<Types> => {
  const t = types.find(x => x.id === id)
  if (!t) return fail('validation', `unknown type ${id}`)
  const users = types.filter(x => (x.kind === 'record' && x.fields.some(f => f.ref.type === id)) || (x.kind === 'brand' && x.of === id))
  return users.length ? fail('validation', `${nameOf(t)} is used by ${users.map(nameOf).join(', ')}`) : ok(types.filter(x => x !== t))
}

export const setLook = (types: Types, id: string, look: Look): Result<Types> => {
  const t = types.find(x => x.id === id)
  return t && (t.kind === 'record' || t.kind === 'brand') ? ok(types.map(x => x === t ? { ...t, look } : x)) : fail('validation', `cannot style ${id}`)
}

/** Every distinct named schema on the ops of the instances, by SAID. */
export const liveTypes = (instances: Instance[]): EditorType[] => {
  const out = new Map<string, EditorType>()
  for (const i of instances) for (const op of i.manifest.ops) for (const schema of [op.input, op.output])
    if (schema && typeof (schema as { $id?: unknown }).$id === 'string') {
      const id = typeHash(schema as TSchema)
      if (!out.has(id)) out.set(id, { id, kind: 'live', schema: schema as TSchema })
    }
  return [...out.values()]
}
