import Type, { type TSchema } from 'typebox'
import { ComponentId, Components, Instance, type Result, type SystemInstance } from '@composable/sdk'
import {
  addDraft, addOp, componentsOf, liveTypes, removeDraft, removeOp, setOpTypes,
  type ComponentEntry, type DraftComponent, type EditorType,
} from '../model'
import type { TypesUpdated } from './type-editor'
import { any, Ref } from './schemas'

const Drafts = any<DraftComponent[]>()
const OpOf = { component: ComponentId, name: Type.String() }

const C = Components.declare({ author: 'composable', id: 'component-list' })
export const ComponentListOps = {
  setInstances: C.op('set-instances', 'The live instances (link a System\'s changed here)', { input: Type.Array(Instance) }),
  setDrafts: C.op('set-drafts', 'Replace the draft components', { input: Drafts }),
  setTypes: C.op('set-types', 'The types (a type-editor\'s types-updated)', { input: any<TypesUpdated>() }),
  addDraft: C.op('add-draft', 'Add an empty draft component', { input: Type.Object({ id: ComponentId }), output: Drafts }),
  addOp: C.op('add-op', 'Add an op to a draft', { input: Type.Object(OpOf), output: Drafts }),
  removeOp: C.op('remove-op', 'Remove an op from a draft', { input: Type.Object(OpOf), output: Drafts }),
  setOpTypes: C.op('set-op-types', 'Set a draft op\'s input and output types (null clears one, absent leaves it)', {
    input: Type.Object({ ...OpOf, input: Type.Optional(Type.Union([Ref, Type.Null()])), output: Type.Optional(Type.Union([Ref, Type.Null()])) }), output: Drafts,
  }),
  removeDraft: C.op('remove-draft', 'Delete a draft component', { input: Type.Object({ component: ComponentId }), output: Drafts }),
  componentsUpdated: C.op('components-updated', 'Live and draft components, with their manifests', { output: any<ComponentEntry[]>() }),
  instancesUpdated: C.op('instances-updated', 'The live instances, forwarded', { output: Type.Array(Instance) }),
  liveTypes: C.op('live-types', 'Every distinct named schema in the live manifests', { output: any<TSchema[]>() }),
  draftsUpdated: C.op('drafts-updated', 'The draft components, as saved', { output: Drafts }),
}
const o = ComponentListOps

/**
 * The instances to list: never an editor itself (it would show its own ops as pieces; by exact id, as widgets share
 * the author), nor one with no ops (a party, say: nothing to place).
 */
export const listed = (instances: Instance[]) =>
  instances.filter(i => i.manifest.ops.length && !(i.manifest.id.author === 'composable' && i.manifest.id.id === 'puzzle-editor'))

type State = { types: EditorType[]; drafts: DraftComponent[]; instances: Instance[] }

const components = (s: State, system: SystemInstance) => system.notify(o.componentsUpdated, componentsOf(s.drafts, s.types, s.instances))
const setDrafts = async (s: State, system: SystemInstance, drafts: DraftComponent[]) => {
  s.drafts = drafts
  await system.notify(o.draftsUpdated, drafts)
  await components(s, system)
}
const edit = async (r: Result<DraftComponent[]>, s: State, system: SystemInstance) => {
  if (r.type === 'success') await setDrafts(s, system, r.data)
  return r
}

export const componentList = C.define({
  state: (): State => ({ types: [], drafts: [], instances: [] }),
  handlers: [
    [o.setInstances, async (all, { state, system }) => {
      const instances = state.instances = listed(all)
      await system.notify(o.instancesUpdated, instances)
      await system.notify(o.liveTypes, liveTypes(instances).flatMap(t => t.kind === 'live' ? [t.schema] : []))
      await components(state, system)
    }],
    [o.setDrafts, (drafts, { state, system }) => setDrafts(state, system, drafts)],
    [o.setTypes, async ({ types }, { state, system }) => { state.types = types; await components(state, system) }],
    [o.addDraft, ({ id }, { state, system }) => edit(addDraft(state.drafts, id), state, system)],
    [o.addOp, ({ component, name }, { state, system }) => edit(addOp(state.drafts, component, name), state, system)],
    [o.removeOp, ({ component, name }, { state, system }) => edit(removeOp(state.drafts, component, name), state, system)],
    [o.setOpTypes, ({ component, name, input, output }, { state, system }) =>
      edit(setOpTypes(state.drafts, component, name, {
      ...(input !== undefined ? { input: input ?? undefined } : {}), ...(output !== undefined ? { output: output ?? undefined } : {}),
    }), state, system)],
    [o.removeDraft, ({ component }, { state, system }) => edit(removeDraft(state.drafts, component), state, system)],
  ],
})
