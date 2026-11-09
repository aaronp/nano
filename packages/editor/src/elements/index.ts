// The editor's web components, over its rune components.
import { ComponentListEl } from './component-list-el'
import { ConnectionBoardEl } from './connection-board-el'
import { EditorPage } from './editor-page'
import { TypeEditorEl } from './type-editor-el'
import { TypeListEl } from './type-list-el'

export { ComponentListEl, ConnectionBoardEl, EditorPage, TypeEditorEl, TypeListEl }
export { ModelElement } from '@composable/elements'

/** Defines every editor element under its tag, once. */
export function defineElements() {
  for (const [tag, el] of [['component-list-el', ComponentListEl], ['type-list-el', TypeListEl], ['type-editor-el', TypeEditorEl],
    ['connection-board-el', ConnectionBoardEl], ['editor-page', EditorPage]] as const)
    if (!customElements.get(tag)) customElements.define(tag, el)
}
