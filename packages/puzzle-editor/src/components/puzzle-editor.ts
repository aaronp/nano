import { Components } from '@composable/sdk'
import { ComponentListOps as L, componentList } from './component-list'
import { ConnectionEditorOps as B, connectionEditor } from './connection-editor'
import { DocumentOps as D, editorDocument } from './document'
import { TypeEditorOps as T, typeEditor } from './type-editor'

/** The editor: four children in a System of its own, talking only through these links. */
export const puzzleEditor = Components.compose({ id: { author: 'composable', id: 'puzzle-editor' } }, c => {
  const types = c.use('types', typeEditor), list = c.use('list', componentList)
  const board = c.use('board', connectionEditor), doc = c.use('document', editorDocument)
  c.route(types(T.typesUpdated), list(L.setTypes))
  c.route(types(T.typesUpdated), board(B.setLooks))
  c.route(list(L.componentsUpdated), board(B.setComponents))
  c.route(list(L.instancesUpdated), board(B.setInstances))
  c.route(list(L.liveTypes), types(T.setLiveTypes))
  c.route(types(T.typesUpdated), doc(D.typesIn))
  c.route(list(L.draftsUpdated), doc(D.draftsIn))
  c.route(board(B.connectionsUpdated), doc(D.connectionsIn))
  c.expose(D.load, D.modelUpdated, L.setInstances, B.intentsUpdated, B.setLive)
  return { types, list, board, document: doc }
})
