import Type from 'typebox'
import { Components, ok, type SystemInstance } from '@composable/sdk'
import { checkDoc, emptyEditorDoc, type DraftComponent, type EditorDoc, type board } from '../model'
import { ComponentListOps } from './component-list'
import { ConnectionEditorOps } from './connection-editor'
import { TypeEditorOps, type TypesUpdated } from './type-editor'

const any = <T>() => Type.Unsafe<T>(Type.Unknown())
const Doc = any<EditorDoc>()

const C = Components.declare({ author: 'composable', id: 'document' })
export const DocumentOps = {
  load: C.op('load', 'Check a document and hand its parts to the editors', { input: Doc, output: Doc }),
  typesIn: C.op('types-in', 'The types (a type-editor\'s types-updated)', { input: any<TypesUpdated>() }),
  draftsIn: C.op('drafts-in', 'The draft components', { input: any<DraftComponent[]>() }),
  connectionsIn: C.op('connections-in', 'The connections', { input: any<board.Connections>() }),
  modelUpdated: C.op('model-updated', 'The whole document, on every change', { output: Doc }),
}
const o = DocumentOps

const changed = (doc: EditorDoc, system: SystemInstance) => system.notify(o.modelUpdated, doc)

/** Holds the latest of each part. `load` reaches the editors by their names in the puzzle-editor's System. */
export const editorDocument = C.define({
  state: (): { doc: EditorDoc } => ({ doc: emptyEditorDoc() }),
  handlers: [
    [o.load, async (input, { system }) => {
      const r = checkDoc(input)
      if (r.type !== 'success') return r
      for (const c of [
        () => system.call('types', TypeEditorOps.setTypes, r.data.types),
        () => system.call('list', ComponentListOps.setDrafts, r.data.components),
        () => system.call('board', ConnectionEditorOps.setConnections, r.data.connections),
      ]) { const x = await c(); if (x.type !== 'success') return x }
      return ok(r.data)
    }],
    // live types come from the System, so they are not saved
    [o.typesIn, async ({ types }, { state, system }) => {
      state.doc = { ...state.doc, types: types.filter(t => t.kind !== 'live') }; await changed(state.doc, system)
    }],
    [o.draftsIn, async (components, { state, system }) => { state.doc = { ...state.doc, components }; await changed(state.doc, system) }],
    [o.connectionsIn, async (connections, { state, system }) => { state.doc = { ...state.doc, connections }; await changed(state.doc, system) }],
  ],
})
