import { test, expect } from 'bun:test'
import { Contexts, Emits, type PolicyStore } from '../src/contexts'
import type { InstanceRef } from '../src'
import { act, echoFactory, fired, rootRef } from './fixtures'

const flush = () => new Promise(r => setTimeout(r, 20))
const ref = (instance: string): InstanceRef => ({ namespace: ['root'], instance })
const setup = () => Contexts.registry({ self: { ...rootRef, manifest: echoFactory('x', 'root').manifest } })
const route = (b: ReturnType<typeof setup>, from: string, to: string) =>
  b.route({ from: { instance: ref(from), event: 'fired' }, to: { instance: ref(to), action: 'log' } })

test('denied emit returns not-allowed and is not delivered', async () => {
  const b = setup(), fa = echoFactory('x', 'e'), fr = echoFactory('x', 'e')
  const store: PolicyStore = { events: { type: 'deny', values: [{ instance: ref('a'), event: 'fired' }] }, actions: { type: 'all' } }
  await b.register(fa, 'a', Contexts.policy(store)); await b.register(fr, 'r')
  route(b, 'a', 'r')
  expect((await fa.state.ctx!.emit(fired, { text: 'x' })).type).toBe('not-allowed')
  await flush()
  expect(fr.received.length).toBe(0)
})

test('mutating a shared store affects all wrapped instances', async () => {
  const b = setup(), fa = echoFactory('x', 'e'), fb = echoFactory('x', 'e'), fr = echoFactory('x', 'e')
  const store: PolicyStore = { events: { type: 'all' }, actions: { type: 'all' } }
  await b.register(fa, 'a', Contexts.policy(store))
  await b.register(fb, 'b', Contexts.policy(store))
  await b.register(fr, 'r'); route(b, 'a', 'r'); route(b, 'b', 'r')
  const deny = { type: 'deny' as const, values: [{ instance: ref('a'), event: 'fired' }] }
  store.events = deny
  expect((await fa.state.ctx!.emit(fired, { text: '1' })).type).toBe('not-allowed')
  expect((await fb.state.ctx!.emit(fired, { text: '2' })).type).toBe('success')
  store.events = { type: 'all' }
  expect((await fa.state.ctx!.emit(fired, { text: '3' })).type).toBe('success')
  await flush()
  expect(fr.received.map(i => (i.input as any).text).sort()).toEqual(['2', '3'])
})

test('denied call returns not-allowed', async () => {
  const b = setup(), fa = echoFactory('x', 'e'), fb = echoFactory('x', 'e')
  const store: PolicyStore = { events: { type: 'all' }, actions: { type: 'allow', values: [] } }
  await b.register(fa, 'a', Contexts.policy(store)); await b.register(fb, 'b')
  expect((await fa.state.ctx!.call(ref('b'), act('log'), 1)).type).toBe('not-allowed')
  expect(fb.received.length).toBe(0)
})

test('capabilities reflects store', async () => {
  const b = setup(), fa = echoFactory('x', 'e')
  const store: PolicyStore = { events: { type: 'allow', values: [] }, actions: { type: 'deny', values: [] } }
  await b.register(fa, 'a', Contexts.policy(store))
  const caps = fa.state.ctx!.capabilities()
  expect(caps.events).toEqual(store.events); expect(caps.actions).toEqual(store.actions)
  expect(caps.environment.type).toBe('node')
})

test('Emits.filter / map / trace compose through withEmit; the last added runs first', async () => {
  const b = setup(), fa = echoFactory('x', 'e'), fr = echoFactory('x', 'e')
  let open = false
  const traced: string[] = []
  await b.register(fa, 'a', c => c
    .withEmit(Emits.trace((e, r) => traced.push(`${(e.payload as any).text}:${r.type}`)))
    .withEmit(Emits.filter(() => open))
    .withEmit(Emits.map(e => ({ ...e, payload: { text: (e.payload as any).text.toUpperCase() } }))))
  await b.register(fr, 'r'); route(b, 'a', 'r')
  expect(await fa.state.ctx!.emit(fired, { text: 'x' })).toEqual({ type: 'not-allowed', reason: 'filtered' })
  open = true
  expect((await fa.state.ctx!.emit(fired, { text: 'y' })).type).toBe('success')
  await flush()
  expect(fr.received.map(i => i.input)).toEqual([{ text: 'Y' }])
  expect(traced).toEqual(['Y:success'])   // trace is innermost: it only sees what got past filter
})

test('a throwing wrapper becomes a handler error, never a throw', async () => {
  const b = setup(), fa = echoFactory('x', 'e')
  await b.register(fa, 'a', c => c.withEmit(() => { throw new Error('nope') }))
  const r = await fa.state.ctx!.emit(fired, { text: 'x' })
  expect(r.type === 'error' && r.error.code).toBe('handler')
})

test('Emits.debounce sends only the last emit in the window', async () => {
  const b = setup(), fa = echoFactory('x', 'e'), fr = echoFactory('x', 'e')
  await b.register(fa, 'a', c => c.withEmit(Emits.debounce(5))); await b.register(fr, 'r'); route(b, 'a', 'r')
  for (const t of ['1', '2', '3']) await fa.state.ctx!.emit(fired, { text: t })
  await flush()
  expect(fr.received.map(i => (i.input as any).text)).toEqual(['3'])
})

test('elide hides an instance from the environment and refuses calls into it', async () => {
  const b = setup(), fa = echoFactory('x', 'e'), fs = echoFactory('x', 'e')
  await b.register(fa, 'a', Contexts.elide(i => i.instance === 'secret')); await b.register(fs, 'secret')
  const env = fa.state.ctx!.capabilities().environment
  expect(env.type === 'node' && env.children.map(c => c.instance.instance)).toEqual(['a'])
  expect((await fa.state.ctx!.call(ref('secret'), act('log'), 1)).type).toBe('not-allowed')
  expect(fs.received.length).toBe(0)
})
