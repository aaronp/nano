import { Type, type TSchema } from 'typebox'
import { fail, ok, type ComponentId, type Instance, type Manifest, type Result } from '@composable/sdk'
import { schemaOf, type EditorType, type TypeRef } from './types'

export type DraftOp = { name: string; description?: string; input?: TypeRef; output?: TypeRef }
export type DraftComponent = { id: ComponentId; ops: DraftOp[] }
type Drafts = DraftComponent[]

const same = (a: ComponentId, b: ComponentId) => a.author === b.author && a.id === b.id
const label = (c: ComponentId) => `${c.author}/${c.id}`

const schemaFor = (ref: TypeRef, types: EditorType[]): Result<TSchema> => {
  const r = schemaOf(ref.type, types)
  return r.type === 'success' && ref.array ? ok(Type.Array(r.data)) : r
}

export function draftManifest(d: DraftComponent, types: EditorType[]): Result<Manifest> {
  const ops: Manifest['ops'] = []
  for (const o of d.ops) {
    const op: Manifest['ops'][number] = { name: `${label(d.id)}/${o.name}` }
    if (o.description) op.description = o.description
    for (const k of ['input', 'output'] as const) {
      if (!o[k]) continue
      const r = schemaFor(o[k], types)
      if (r.type !== 'success') return r
      op[k] = r.data
    }
    ops.push(op)
  }
  return ok({ id: d.id, ops })
}

const edit = (drafts: Drafts, id: ComponentId, f: (d: DraftComponent) => Result<DraftComponent>): Result<Drafts> => {
  const d = drafts.find(x => same(x.id, id))
  if (!d) return fail('validation', `unknown component ${label(id)}`)
  const r = f(d)
  return r.type === 'success' ? ok(drafts.map(x => x === d ? r.data : x)) : r
}

export const addDraft = (drafts: Drafts, id: ComponentId): Result<Drafts> =>
  drafts.some(x => same(x.id, id)) ? fail('validation', `component ${label(id)} already exists`) : ok([...drafts, { id, ops: [] }])

export const removeDraft = (drafts: Drafts, id: ComponentId): Result<Drafts> =>
  edit(drafts, id, d => ok(d)).type === 'success' ? ok(drafts.filter(x => !same(x.id, id))) : fail('validation', `unknown component ${label(id)}`)

export const addOp = (drafts: Drafts, id: ComponentId, name: string): Result<Drafts> =>
  edit(drafts, id, d => d.ops.some(o => o.name === name) ? fail('validation', `${label(id)} already has op ${name}`) : ok({ ...d, ops: [...d.ops, { name }] }))

export const removeOp = (drafts: Drafts, id: ComponentId, name: string): Result<Drafts> =>
  edit(drafts, id, d => d.ops.some(o => o.name === name) ? ok({ ...d, ops: d.ops.filter(o => o.name !== name) }) : fail('validation', `${label(id)} has no op ${name}`))

export const setOpTypes = (drafts: Drafts, id: ComponentId, name: string, types: { input?: TypeRef; output?: TypeRef }): Result<Drafts> =>
  edit(drafts, id, d => d.ops.some(o => o.name === name)
    ? ok({ ...d, ops: d.ops.map(o => o.name === name ? { ...o, ...types } : o) })
    : fail('validation', `${label(id)} has no op ${name}`))

export type ComponentEntry = { manifest: Manifest; draft: boolean; implemented: boolean }

/** Live components (one per id) first, then drafts with no live twin. A draft whose types do not resolve is left out. */
export function componentsOf(drafts: Drafts, types: EditorType[], instances: Instance[]): ComponentEntry[] {
  const live = new Map<string, Manifest>()
  for (const i of instances) if (!live.has(label(i.manifest.id))) live.set(label(i.manifest.id), i.manifest)
  const out: ComponentEntry[] = [...live.values()].map(manifest => ({ manifest, draft: drafts.some(d => same(d.id, manifest.id)), implemented: true }))
  for (const d of drafts) {
    if (live.has(label(d.id))) continue
    const m = draftManifest(d, types)
    if (m.type === 'success') out.push({ manifest: m.data, draft: true, implemented: false })
  }
  return out
}
