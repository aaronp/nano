import { expect, test } from 'bun:test'
import { Type } from 'typebox'
import { addEditor, ComponentList as L, ConnectionBoard as B, TypeEditor as E, TypeList as T, titleOf, type TypeEntry } from '../src'
import { demo, page, tick } from './fixtures'

const setup = () => { const p = page(); return { ...p, ids: addEditor(p.reg) } }
const titles = (es: TypeEntry[]) => es.map(e => titleOf(e.type))

test('the editor is four instances in the registry', () => {
  const { reg, ids } = setup()
  expect(ids).toEqual({ list: 'editor-list', types: 'editor-types', typeEditor: 'editor-type-editor', board: 'editor-board' })
  for (const id of Object.values(ids)) expect(reg.get(id)).toBeDefined()
})

test('selecting a type loads it into the type editor; editing it updates the list', async () => {
  const { call, value, ids } = setup()
  await call(ids.types, T.ops.add, 'Point')
  await call(ids.types, T.ops.select, 'Point'); await tick()
  expect(titleOf((await value(ids.typeEditor, E.ops.entry)).type)).toBe('Point')
  await call(ids.typeEditor, E.ops.addField, { name: 'x', type: Type.Number({ title: 'number' }) }); await tick()
  const point = (await value(ids.types, T.ops.types)).find((e: TypeEntry) => titleOf(e.type) === 'Point')
  expect(Object.keys(point.type.properties)).toEqual(['x'])
})

test('renaming the selected type reloads the editor, so edits go to the new name', async () => {
  const { call, value, ids } = setup()
  await call(ids.types, T.ops.add, 'Point')
  await call(ids.types, T.ops.select, 'Point'); await tick()
  await call(ids.types, T.ops.rename, { from: 'Point', to: 'Pos' }); await tick()
  await call(ids.typeEditor, E.ops.addField, { name: 'x', type: Type.Number({ title: 'number' }) }); await tick()
  const types = await value(ids.types, T.ops.types)
  expect(titles(types).slice(4)).toEqual(['Pos'])
  expect(Object.keys(types[4].type.properties)).toEqual(['x'])
})

test('removing a component from the list takes its pieces off the board', async () => {
  const { call, value, ids } = setup()
  await call(ids.list, L.ops.set, [demo.slider, demo.chart])
  await call(ids.board, B.ops.place, { instance: 'slider', op: demo.slider.ops[0], cell: { c: 0, r: 0 } })
  await call(ids.board, B.ops.place, { instance: 'chart', op: demo.chart.ops[0], cell: { c: 1, r: 0 } })
  await call(ids.list, L.ops.remove, 'slider'); await tick()
  expect((await value(ids.board, B.ops.pieces)).map((p: any) => p.instance)).toEqual(['chart'])
})

test('the type editor lets go of a type the list removes or replaces, and refuses to change built-ins', async () => {
  const { call, value, ids } = setup()
  await call(ids.types, T.ops.add, 'Pt')
  await call(ids.types, T.ops.select, 'Pt'); await tick()
  await call(ids.types, T.ops.remove, 'Pt'); await tick()
  expect(await value(ids.typeEditor, E.ops.entry)).toBeUndefined()
  await call(ids.types, T.ops.add, 'Q'); await call(ids.types, T.ops.select, 'Q'); await tick()
  await call(ids.types, T.ops.set, []); await tick()
  expect(await value(ids.typeEditor, E.ops.entry)).toBeUndefined()
  await call(ids.types, T.ops.select, 'number'); await tick()
  expect('error' in await call(ids.typeEditor, E.ops.resetLook)).toBe(true)
})

test('pieces leave the board when their op is removed, or their component drops out of a new list', async () => {
  const { call, value, ids } = setup()
  await call(ids.list, L.ops.set, [demo.slider, demo.chart, demo.doubler])
  await call(ids.board, B.ops.place, { instance: 'slider', op: demo.slider.ops[0], cell: { c: 0, r: 0 } })
  await call(ids.board, B.ops.place, { instance: 'chart', op: demo.chart.ops[0], cell: { c: 1, r: 0 } })
  await call(ids.board, B.ops.place, { instance: 'doubler', op: demo.doubler.ops[0], cell: { c: 2, r: 0 } })
  await call(ids.list, L.ops.removeOp, { component: 'chart', op: 'demo/chart/push' }); await tick()
  await call(ids.list, L.ops.set, [demo.slider]); await tick()
  expect((await value(ids.board, B.ops.pieces)).map((p: any) => p.instance)).toEqual(['slider'])
})

test("the editor's instances are owned by the editor, named by its prefix", () => {
  const p = page(); addEditor(p.reg, 'ed')
  const owners = p.reg.snapshot().instances.filter(i => i.id.startsWith('ed-')).map(i => i.owner)
  expect(owners).toHaveLength(4)
  for (const o of owners) expect(o).toEqual({ kind: 'editor', name: 'ed' })
})
