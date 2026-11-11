// The Store: key/value pairs kept in the storage of the origin it runs in (localStorage), or in memory where it has none.
import { beforeEach, expect, test } from 'bun:test'
import { Type } from 'typebox'
import { Components, Ops, Registries, Runtimes, type Op } from '@pritzlaff/nano-core'
import { component } from '@pritzlaff/nano-runes'
import { Store } from '../src'

const Spy = component('test/spy', () => { const got: unknown[] = []; return { get got() { return got }, take: (x: unknown) => { got.push(x) } } }, { got: Type.Array(Type.Unknown(), { description: 'Everything taken' }), take: { in: Type.Unknown({ description: 'Anything' }), description: 'Takes a value' } })

function page(id = 's') {
  const rt = Runtimes.create(Registries.create('page')), reg = rt.registry
  reg.add(id, Components.instantiate(Store))
  reg.add('spy', Components.instantiate(Spy))
  reg.subscribe({ source: id, op: Ops.key(Store.ops.changed), listener: 'spy', target: Ops.key(Spy.ops.take) })
  const call = (op: Op, arg: unknown = null) => rt.call({ registry: 'page', instance: 'test' }, id, Ops.key(op), arg) as Promise<any>
  return { call, value: async (op: Op, arg: unknown = null) => (await call(op, arg)).value, changes: (reg.get('spy')!.value as { got: unknown[] }).got }
}
const tick = () => new Promise(r => setTimeout(r, 0))

beforeEach(() => localStorage.clear())

test('set stores a value under a key, get reads it back, and each change is published', async () => {
  const { call, value, changes } = page()
  await call(Store.ops.set, { key: 'colour', value: 'teal' }); await tick()
  expect(await value(Store.ops.get, 'colour')).toBe('teal')
  expect(await value(Store.ops.entries)).toEqual({ colour: 'teal' })
  expect(changes).toEqual([{ key: 'colour', value: 'teal' }])
})

test('get of a key never set is null', async () => {
  expect(await page().value(Store.ops.get, 'nope')).toBeNull()
})

test('remove deletes a key and publishes it with a null value', async () => {
  const { call, value, changes } = page()
  await call(Store.ops.set, { key: 'a', value: '1' }); await call(Store.ops.remove, 'a'); await tick()
  expect(await value(Store.ops.get, 'a')).toBeNull()
  expect(await value(Store.ops.entries)).toEqual({})
  expect(changes).toEqual([{ key: 'a', value: '1' }, { key: 'a', value: null }])
})

test("values live in the origin's storage: a store made later in the same origin sees them", async () => {
  await page('first').call(Store.ops.set, { key: 'k', value: 'v' })
  const later = page('later')
  expect(await later.value(Store.ops.backing)).toBe('localStorage')
  expect(await later.value(Store.ops.get, 'k')).toBe('v')
})

test('with no usable localStorage (an opaque-origin sandbox) it keeps values in memory, and says so', async () => {
  const real = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')!
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new DOMException('denied', 'SecurityError') } })
  try {
    const { call, value } = page()
    expect(await value(Store.ops.backing)).toBe('memory')
    await call(Store.ops.set, { key: 'k', value: 'v' })
    expect(await value(Store.ops.get, 'k')).toBe('v')
  } finally { Object.defineProperty(globalThis, 'localStorage', real) }
})

test('keys and values are checked: an empty key or a non-string value is refused', async () => {
  const { call } = page()
  expect((await call(Store.ops.set, { key: '', value: 'x' })).error).toBeTruthy()
  expect((await call(Store.ops.set, { key: 'k', value: 1 })).error).toBeTruthy()
  expect((await call(Store.ops.get, 42)).error).toBeTruthy()
})

test('a key like __proto__ is an ordinary entry', async () => {
  const { call, value } = page()
  await call(Store.ops.set, { key: '__proto__', value: 'x' })
  expect(await value(Store.ops.get, '__proto__')).toBe('x')
  expect(await value(Store.ops.get, 'toString')).toBeNull()
})
