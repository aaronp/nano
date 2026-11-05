import { test, expect } from 'bun:test'
import { Contexts } from '../src/contexts'
import type { PolicyStore } from '../src/contexts'
import type { InstanceRef } from '../src'
import { echoFactory, rootRef } from './fixtures'

const flush = () => new Promise(r => setTimeout(r, 20))
const ref = (instance: string): InstanceRef => ({ namespace: ['root'], instance })
const setup = () => Contexts.bus({ self: { ...rootRef, manifest: echoFactory('x', 'root').manifest } })
const route = (b: ReturnType<typeof setup>, from: string, to: string) =>
  b.route({ from: { instance: ref(from), event: 'fired' }, to: { instance: ref(to), action: 'log' } })

test('denied emit returns not-allowed and is not delivered', async () => {
  const b = setup(), fa = echoFactory('x', 'e'), fr = echoFactory('x', 'e')
  const store: PolicyStore = { events: { type: 'deny', values: [{ instance: ref('a'), event: 'fired' }] }, actions: { type: 'all' } }
  await b.register(fa, 'a', c => Contexts.policy(c, store, ref('a'))); await b.register(fr, 'r')
  route(b, 'a', 'r')
  expect((await fa.state.ctx!.emit('fired', { text: 'x' })).type).toBe('not-allowed')
  await flush()
  expect(fr.received.length).toBe(0)
})

test('setPolicy on shared store affects all wrapped instances', async () => {
  const b = setup(), fa = echoFactory('x', 'e'), fb = echoFactory('x', 'e'), fr = echoFactory('x', 'e')
  const store: PolicyStore = { events: { type: 'all' }, actions: { type: 'all' } }
  const pa = Contexts.policy(undefined as any, store, ref('a'))
  await b.register(fa, 'a', c => Contexts.policy(c, store, ref('a')))
  await b.register(fb, 'b', c => Contexts.policy(c, store, ref('b')))
  await b.register(fr, 'r'); route(b, 'a', 'r'); route(b, 'b', 'r')
  void pa
  const deny = { type: 'deny' as const, values: [{ instance: ref('a'), event: 'fired' }] }
  ;(fb.state.ctx as any).setPolicy({ events: deny })
  expect((await fa.state.ctx!.emit('fired', { text: '1' })).type).toBe('not-allowed')
  expect((await fb.state.ctx!.emit('fired', { text: '2' })).type).toBe('success')
  ;(fa.state.ctx as any).setPolicy({ events: { type: 'all' } })
  expect((await fa.state.ctx!.emit('fired', { text: '3' })).type).toBe('success')
  await flush()
  expect(fr.received.map(i => (i.input as any).text).sort()).toEqual(['2', '3'])
})

test('denied call returns not-allowed', async () => {
  const b = setup(), fa = echoFactory('x', 'e'), fb = echoFactory('x', 'e')
  const store: PolicyStore = { events: { type: 'all' }, actions: { type: 'allow', values: [] } }
  await b.register(fa, 'a', c => Contexts.policy(c, store, ref('a'))); await b.register(fb, 'b')
  expect((await fa.state.ctx!.call(ref('b'), 'log', 1)).type).toBe('not-allowed')
  expect(fb.received.length).toBe(0)
})

test('capabilities reflects store', async () => {
  const b = setup(), fa = echoFactory('x', 'e')
  const store: PolicyStore = { events: { type: 'allow', values: [] }, actions: { type: 'deny', values: [] } }
  await b.register(fa, 'a', c => Contexts.policy(c, store, ref('a')))
  const caps = fa.state.ctx!.capabilities()
  expect(caps.events).toEqual(store.events); expect(caps.actions).toEqual(store.actions)
  expect(caps.environment.type).toBe('node')
})

test('filter predicate add/remove toggles delivery', async () => {
  const b = setup(), fa = echoFactory('x', 'e'), fr = echoFactory('x', 'e')
  let f!: ReturnType<typeof Contexts.filter>
  await b.register(fa, 'a', c => (f = Contexts.filter(c))); await b.register(fr, 'r'); route(b, 'a', 'r')
  const no = () => false
  f.addPredicate(no)
  const r = await fa.state.ctx!.emit('fired', { text: 'x' })
  expect(r).toEqual({ type: 'not-allowed', reason: 'filtered' })
  f.removePredicate(no)
  expect((await fa.state.ctx!.emit('fired', { text: 'y' })).type).toBe('success')
  await flush()
  expect(fr.received.length).toBe(1)
})
