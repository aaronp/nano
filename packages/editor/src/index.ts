export * from './model'
export * from './components/component-list'
export * from './components/type-list'
export * from './components/type-editor'
export * from './components/connection-board'
export * from './editor'

import type { Catalog } from '@composable/elements'
import { ComponentList } from './components/component-list'
import { ConnectionBoard } from './components/connection-board'
import { TypeEditor } from './components/type-editor'
import { TypeList } from './components/type-list'

/** The editor's parts as kinds of component, for a host to list. Their elements need the editor page around them. */
export const catalog = {
  'component-list': { component: ComponentList, title: 'Component list' },
  'type-list': { component: TypeList, title: 'Type list' },
  'type-editor': { component: TypeEditor, title: 'Type editor' },
  'connection-board': { component: ConnectionBoard, title: 'Connection board' },
} satisfies Catalog
