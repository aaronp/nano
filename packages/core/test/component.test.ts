import { expect, test } from 'bun:test'
import { Type } from 'typebox'
import { Components, err, Ops, type Component, type Handle, type Op } from '../src'

class AtomicInteger { n = 0; get() { return this.n }; incrementAndGet() { return ++this.n } }
const Updated = Ops.source('com.acme', 'counter-updated', Type.Number())
const Inc = Ops.action('com.acme', 'inc', Type.Null(), Type.Number())
const Extra = Ops.source('com.acme', 'extra', Type.String())

const counter = () => {
  const c = Components.create({ ns: 'com.acme', name: 'counter' }, () => new AtomicInteger())
  c.action(Updated, a => a.get())
  c.action(Inc, a => a.incrementAndGet(), { emits: [Updated] })
  return c
}
/** A handle that records what it is asked to publish. */
const recorder = (instance = 'c') => {
  const sent: [Op, unknown][] = [], announced: [string, Op][] = []
  const h: Handle = { coord: { registry: 'r', instance }, notify: async (op, data) => { sent.push([op, data]); return { value: [] } }, call: async () => err('no') }
  return { h, sent, announced, announce: (t: 'op-added' | 'op-removed', op: Op) => { announced.push([t, op]) } }
}

test('action reports whether it added or replaced', () => {
  const c = Components.create({ ns: 'a', name: 'b' }, () => new AtomicInteger())
  expect(c.action(Inc, a => a.incrementAndGet())).toBe('added')
  expect(c.action(Inc, a => a.incrementAndGet())).toBe('replaced')
})

test('invoking an action runs it on the plain instance', async () => {
  const inst = Components.instantiate(counter())
  expect(await Components.invoke(inst, 'com.acme/inc', null)).toEqual({ value: 1 })
  expect(inst.value.n).toBe(1)
})

test('emits publishes what the emitted op reads, through every handle', async () => {
  const inst = Components.instantiate(counter()), r = recorder()
  inst.env.added(r.h, r.announce)
  await Components.invoke(inst, 'com.acme/inc', null)
  expect(r.sent).toEqual([[Updated, 1]])
})

test('a failed emit is reported but the action stands', async () => {
  const c = Components.create({ ns: 'a', name: 'b' }, () => new AtomicInteger())
  c.action(Updated)   // declared, no reader
  c.action(Inc, a => a.incrementAndGet(), { emits: [Updated] })
  const inst = Components.instantiate(c)
  const r = await Components.invoke(inst, 'com.acme/inc', null) as { value: number; detail: { emits: { error: string }[] } }
  expect(r.value).toBe(1)
  expect(r.detail.emits[0]!.error).toBeString()
  expect(inst.value.n).toBe(1)
})

test('a throwing action and an unknown op are errors', async () => {
  const c = Components.create({ ns: 'a', name: 'b' }, () => 0)
  c.action(Inc, () => { throw new Error('boom') })
  const inst = Components.instantiate(c)
  expect(await Components.invoke(inst, 'com.acme/inc', null)).toEqual({ error: 'boom' })
  expect(await Components.invoke(inst, 'com.acme/nope', null)).toEqual(err('unknown op com.acme/nope'))
})

test('notify in no registry reaches nobody', async () => {
  expect(await Components.instantiate(counter()).env.notify(Updated, 1)).toEqual([])
})

test('register adds an op to one instance and announces it', () => {
  const c = counter(), inst = Components.instantiate(c), r = recorder()
  inst.env.added(r.h, r.announce)
  expect(inst.env.register(Extra)).toBe('added')
  expect(inst.actions.has('com.acme/extra')).toBe(true)
  expect(c.actions.has('com.acme/extra')).toBe(false)
  expect(r.announced).toEqual([['op-added', Extra]])
  expect(inst.env.unregister(Extra)).toBe(true)
  expect(r.announced[1]).toEqual(['op-removed', Extra])
})

test('handles are kept once per coordinate and dropped on removal', () => {
  const inst = Components.instantiate(counter()), a = recorder(), b = recorder()
  inst.env.added(a.h, a.announce); inst.env.added(b.h, b.announce)
  expect(inst.env.handles()).toHaveLength(1)
  inst.env.removed({ registry: 'r', instance: 'c' })
  expect(inst.env.handles()).toEqual([])
})

test('a bare Component accepts any component', () => {
  const mixed: Component[] = [Components.create({ ns: 'a', name: 'n' }, () => 1), Components.create({ ns: 'a', name: 's' }, () => 'x')]
  expect(mixed).toHaveLength(2)
})

test('a component keeps its description', () => {
  expect(Components.create({ ns: 't', name: 'c' }, () => ({}), { description: 'A thing' }).description).toBe('A thing')
  expect('description' in Components.create({ ns: 't', name: 'c' }, () => ({}))).toBe(false)
})
