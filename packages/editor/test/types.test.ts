import { expect, test } from 'bun:test'
import { Type } from 'typebox'
import { TypeEditor as E, TypeList as T, lookOf, hashBytes, titleOf, type TypeEntry } from '../src'
import { page, tick } from './fixtures'

const titles = (es: TypeEntry[]) => es.map(e => titleOf(e.type))

test('the list starts with the built-ins, which cannot be removed or renamed', async () => {
  const { add, call, value } = page(); add('types', T)
  expect(titles(await value('types', T.ops.types))).toEqual(['string', 'number', 'boolean', 'unknown'])
  expect('error' in await call('types', T.ops.remove, 'number')).toBe(true)
  expect('error' in await call('types', T.ops.rename, { from: 'number', to: 'n' })).toBe(true)
})

test('add, rename, copy as brand, remove, and set keeps the built-ins', async () => {
  const { add, call, value } = page(); add('types', T)
  await call('types', T.ops.add, 'Point')
  expect('error' in await call('types', T.ops.add, 'Point')).toBe(true)
  await call('types', T.ops.rename, { from: 'Point', to: 'Pos' })
  expect('error' in await call('types', T.ops.rename, { from: 'Pos', to: 'string' })).toBe(true)
  await call('types', T.ops.copyAsBrand, { from: 'number', to: 'Meters' })
  expect(titles(await value('types', T.ops.types))).toEqual(['string', 'number', 'boolean', 'unknown', 'Pos', 'Meters'])
  await call('types', T.ops.remove, 'Pos')
  expect(titles(await value('types', T.ops.types)).slice(4)).toEqual(['Meters'])
  await call('types', T.ops.set, [{ type: Type.Object({}, { title: 'Only' }) }])
  expect(titles(await value('types', T.ops.types))).toEqual(['string', 'number', 'boolean', 'unknown', 'Only'])
})

test('select publishes the entry; renaming the selected type publishes it again', async () => {
  const { add, call, spy } = page(); add('types', T)
  const sel = spy('types', T.ops.typeSelected)
  await call('types', T.ops.add, 'Point')
  await call('types', T.ops.select, 'Point')
  await call('types', T.ops.rename, { from: 'Point', to: 'Pos' }); await tick()
  expect(sel.map((e: any) => e.type.title)).toEqual(['Point', 'Pos'])
  expect('error' in await call('types', T.ops.select, 'ghost')).toBe(true)
})

test('update replaces the entry with the same title, and refuses an unknown one', async () => {
  const { add, call, value } = page(); add('types', T)
  await call('types', T.ops.add, 'Point')
  const look = lookOf(hashBytes(Type.String()))
  await call('types', T.ops.update, { type: Type.Object({ x: Type.Number() }, { title: 'Point' }), look })
  const point = (await value('types', T.ops.types)).find((e: TypeEntry) => titleOf(e.type) === 'Point')
  expect(Object.keys(point.type.properties)).toEqual(['x'])
  expect(point.look).toEqual(look)
  expect('error' in await call('types', T.ops.update, { type: Type.Object({}, { title: 'Ghost' }) })).toBe(true)
})

test('the type editor edits fields and the look, and publishes each change', async () => {
  const { add, call, value, spy } = page(); add('ed', E)
  const changed = spy('ed', E.ops.typeChanged)
  await call('ed', E.ops.edit, { type: Type.Object({}, { title: 'Point' }) })
  await call('ed', E.ops.addField, { name: 'x', type: Type.Number({ title: 'number' }) })
  expect('error' in await call('ed', E.ops.addField, { name: 'x', type: Type.Number() })).toBe(true)
  await call('ed', E.ops.setField, { name: 'x', type: Type.String({ title: 'string' }) })
  await call('ed', E.ops.addField, { name: 'y', type: Type.Number({ title: 'number' }) })
  await call('ed', E.ops.removeField, 'y')
  const look = lookOf(hashBytes(Type.String()))
  await call('ed', E.ops.setLook, look)
  await call('ed', E.ops.resetLook); await tick()
  expect(changed).toHaveLength(6)
  expect((changed[2] as TypeEntry).type).toMatchObject({ title: 'Point', properties: { x: { title: 'string' }, y: { title: 'number' } } })
  expect((changed[4] as TypeEntry).look).toEqual(look)
  expect('look' in (changed[5] as TypeEntry)).toBe(false)
  expect(Object.keys((await value('ed', E.ops.entry)).type.properties)).toEqual(['x'])
})

test('fields go only on records', async () => {
  const { add, call } = page(); add('ed', E)
  expect('error' in await call('ed', E.ops.addField, { name: 'x', type: Type.Number() })).toBe(true)   // nothing loaded
  await call('ed', E.ops.edit, { type: Type.Number({ title: 'number' }) })
  expect('error' in await call('ed', E.ops.addField, { name: 'x', type: Type.Number() })).toBe(true)
})
