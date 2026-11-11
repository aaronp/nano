// The Reader component: the message shown.
import { expect, test } from 'bun:test'
import { Components, Ops, Registries, Runtimes, type Op } from '@pritzlaff/nano-core'
import { Reader } from '../src/reader'

function page() {
  const rt = Runtimes.create(Registries.create('page'))
  rt.registry.add('r', Components.instantiate(Reader))
  const call = (op: Op, arg: unknown = null) => rt.call({ registry: 'page', instance: 'test' }, 'r', Ops.key(op), arg) as Promise<any>
  return { call, value: async (op: Op) => (await call(op)).value }
}

test('starts empty; read shows a message', async () => {
  const { call, value } = page()
  expect(await value(Reader.ops.message)).toBeNull()
  const m = { id: 'm1', folder: 'inbox', from: 'a', subject: 's', date: 'd', body: 'b' }
  await call(Reader.ops.read, m)
  expect(await value(Reader.ops.message)).toEqual(m)
  expect((await call(Reader.ops.read, { id: 'x' })).error).toBeTruthy()
  expect((await call(Reader.ops.read, { ...m, body: 'x'.repeat(20001) })).error).toBeTruthy()
  expect(await value(Reader.ops.message)).toEqual(m)
})
