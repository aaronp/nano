// The List component: messages, the folder shown; publishes `opened`.
import { Type } from 'typebox'
import { expect, test } from 'bun:test'
import { Components, Ops, Registries, Runtimes, type Op } from '@pritzlaff/nano-core'
import { component } from '@pritzlaff/nano-runes'
import { List } from '../src/list'

const Spy = component('test/spy', () => { const got: unknown[] = []; return { get got() { return got }, take: (x: unknown) => { got.push(x) } } }, { got: Type.Array(Type.Unknown(), { description: 'Everything taken' }), take: { in: Type.Unknown({ description: 'Anything' }), description: 'Takes a value' } })

function page() {
  const rt = Runtimes.create(Registries.create('page')), reg = rt.registry
  reg.add('l', Components.instantiate(List))
  reg.add('spy', Components.instantiate(Spy))
  reg.subscribe({ source: 'l', op: Ops.key(List.ops.opened), listener: 'spy', target: Ops.key(Spy.ops.take) })
  const call = (op: Op, arg: unknown = null) => rt.call({ registry: 'page', instance: 'test' }, 'l', Ops.key(op), arg) as Promise<any>
  return { call, value: async (op: Op) => (await call(op)).value, got: (reg.get('spy')!.value as { got: unknown[] }).got }
}
const msg = (id: string, folder = 'inbox') => ({ id, folder, from: 'a', subject: 's', date: 'd', body: 'b' })

test("it shows the inbox folder's messages, newest first", async () => {
  const { value } = page()
  expect(await value(List.ops.folder)).toBe('inbox')
  expect((await value(List.ops.shown)).map((m: { id: string }) => m.id)).toEqual(['m1', 'm2', 'm3'])
})

test('show(folder) switches', async () => {
  const { call, value } = page()
  await call(List.ops.show, 'sent')
  expect(await value(List.ops.folder)).toBe('sent')
  expect((await value(List.ops.shown)).map((m: { id: string }) => m.id)).toEqual(['m5'])
  expect((await call(List.ops.show, 5)).error).toBeTruthy()
})

test('open(id) publishes the whole message; an unknown id is refused', async () => {
  const { call, got } = page()
  await call(List.ops.open, 'm2')
  expect(got.length).toBe(1); expect((got[0] as { subject: string }).subject).toBe('Weekly report is ready')
  expect((await call(List.ops.open, 'nope')).error).toContain('nope')
  expect((await call(List.ops.open, 'toString')).error).toBeTruthy()
  expect(got.length).toBe(1)
})

test('setMessages replaces them; inputs are bounded', async () => {
  const { call, value } = page()
  await call(List.ops.setMessages, [msg('a'), msg('b', 'sent')])
  expect((await value(List.ops.messages)).length).toBe(2)
  expect((await value(List.ops.shown)).map((m: { id: string }) => m.id)).toEqual(['a'])
  expect((await call(List.ops.setMessages, [{ ...msg('c'), body: 'x'.repeat(20001) }])).error).toBeTruthy()
  expect((await call(List.ops.setMessages, [{ ...msg('c'), id: 'x'.repeat(41) }])).error).toBeTruthy()
  expect((await call(List.ops.setMessages, [{ id: 'c' }])).error).toBeTruthy()
  expect((await call(List.ops.show, 'x'.repeat(41))).error).toBeTruthy()
  expect((await value(List.ops.messages)).length).toBe(2)
})
