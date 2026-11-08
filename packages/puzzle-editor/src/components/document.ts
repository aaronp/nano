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

type State = { doc: EditorDoc; saved: string; loading: boolean }

/** Publish the doc, unless a load is under way or nothing saved has changed (so an autosave saves only real edits). */
const changed = async (state: State, system: SystemInstance, force = false) => {
  const now = JSON.stringify(state.doc)
  if (state.loading || (!force && now === state.saved)) return
  state.saved = now
  await system.notify(o.modelUpdated, state.doc)
}

/**
 * Holds the latest of each part. `load` reaches the editors by their names in the puzzle-editor's System; while it
 * runs the parts arrive silently, and it publishes the whole doc once at the end.
 */
export const editorDocument = C.define({
  state: (): State => ({ doc: emptyEditorDoc(), saved: JSON.stringify(emptyEditorDoc()), loading: false }),
  handlers: [
    [o.load, async (input, { state, system }) => {
      const r = checkDoc(input)
      if (r.type !== 'success') return r
      const { types, components, connections } = r.data
      state.loading = true
      try {
        for (const c of [
          () => system.call('types', TypeEditorOps.setTypes, types),
          () => system.call('list', ComponentListOps.setDrafts, components),
          () => system.call('board', ConnectionEditorOps.setConnections, connections),
        ]) {
          const x = await c()
          if (x.type !== 'success') { state.loading = false; await changed(state, system); return x }
        }
      } finally { state.loading = false }  // never left silent, even if a call throws
      state.doc = { types, components, connections }
      await changed(state, system, true)
      return ok(state.doc)
    }],
    // live types come from the System, so they are not saved
    [o.typesIn, async ({ types }, { state, system }) => {
      state.doc = { ...state.doc, types: types.filter(t => t.kind !== 'live') }; await changed(state, system)
    }],
    [o.draftsIn, async (components, { state, system }) => { state.doc = { ...state.doc, components }; await changed(state, system) }],
    [o.connectionsIn, async (connections, { state, system }) => { state.doc = { ...state.doc, connections }; await changed(state, system) }],
  ],
})
