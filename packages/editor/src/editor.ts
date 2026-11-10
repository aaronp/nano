// The editor is the four components in one registry, wired by subscriptions. Nothing else.
import { Components, Ops, type Component, type Op, type Registry } from '@pritzlaff/nano-core'
import { ComponentList } from './components/component-list'
import { ConnectionBoard } from './components/connection-board'
import { TypeEditor } from './components/type-editor'
import { TypeList } from './components/type-list'

/** The instance ids of one editor's components. */
export type Ids = { list: string; types: string; typeEditor: string; board: string }

/** The instance ids an editor with this prefix uses. */
export const editorIds = (prefix = 'editor'): Ids =>
  ({ list: `${prefix}-list`, types: `${prefix}-types`, typeEditor: `${prefix}-type-editor`, board: `${prefix}-board` })

/** Adds an editor's components to `registry` and wires them. Returns their ids. */
export function addEditor(registry: Registry, prefix = 'editor'): Ids {
  const ids = editorIds(prefix)
  const add = (id: string, c: Component) => {
    const r = registry.add(id, Components.instantiate(c), { kind: 'editor', name: prefix })
    if ('error' in r) throw new Error(r.error)
  }
  add(ids.list, ComponentList); add(ids.types, TypeList); add(ids.typeEditor, TypeEditor); add(ids.board, ConnectionBoard)
  const wire = (source: string, op: Op, listener: string, target: Op) =>
    registry.subscribe({ source, op: Ops.key(op), listener, target: Ops.key(target) })
  wire(ids.types, TypeList.ops.typeSelected, ids.typeEditor, TypeEditor.ops.edit)
  wire(ids.typeEditor, TypeEditor.ops.typeChanged, ids.types, TypeList.ops.update)
  wire(ids.list, ComponentList.ops.removed, ids.board, ConnectionBoard.ops.removeInstance)
  wire(ids.list, ComponentList.ops.opRemoved, ids.board, ConnectionBoard.ops.removeOp)
  return ids
}
