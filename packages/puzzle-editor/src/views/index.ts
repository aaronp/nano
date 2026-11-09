import { defineComponentList } from './component-list'
import { defineConnectionEditor } from './connection-editor'
import { definePuzzleEditor } from './puzzle-editor'
import { defineTypeEditor } from './type-editor'

export { ComponentListView } from './component-list'
export { ConnectionEditorView } from './connection-editor'
export { PuzzleEditorView } from './puzzle-editor'
export { TypeEditorView } from './type-editor'

/** Register `<type-editor>`, `<component-list>`, `<connection-editor>` and `<puzzle-editor>`, each with `prefix` in front. */
export const defineEditor = (prefix = '') => {
  defineTypeEditor(`${prefix}type-editor`); defineComponentList(`${prefix}component-list`)
  defineConnectionEditor(`${prefix}connection-editor`); definePuzzleEditor(`${prefix}puzzle-editor`)
}
