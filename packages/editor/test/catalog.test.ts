import { expect, test } from 'bun:test'
import { catalog, ComponentList, ConnectionBoard, TypeEditor, TypeList } from '../src'

test('the editor offers its four parts as component types', () => {
  expect(catalog).toEqual({
    'component-list': { component: ComponentList, title: 'Component list' },
    'type-list': { component: TypeList, title: 'Type list' },
    'type-editor': { component: TypeEditor, title: 'Type editor' },
    'connection-board': { component: ConnectionBoard, title: 'Connection board' },
  })
})
