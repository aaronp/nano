import { test, expect } from 'bun:test'
import Type from 'typebox'
import { defineManifest, ok, type SystemError, type Component, type ComponentFactory, type InstanceRef } from '../src'
import { Contexts } from '../src/contexts'
import { echoFactory, fired, rootRef } from './fixtures'

const flush = () => new Promise(r => setTimeout(r))
const setup = () => {
  const errors: SystemError[] = []
  const bus = Contexts.bus({ self: { ...rootRef, manifest: echoFactory('x', 'root').manifest }, onDeliveryError: e => errors.push(e) })
  return { bus, errors }
}
const ref = (instance: string): InstanceRef => ({ namespace: ['root'], instance })
const route = (bus: ReturnType<typeof setup>['bus'], from: string, to: string, action = 'log') =>
  bus.route({ from: { instance: ref(from), event: 'fired' }, to: { instance: ref(to), action } })

test('emit delivers to every routed target', async () => {
  const { bus } = setup()
  const fa = echoFactory('x', 'e'), fb = echoFactory('x', 'e')
  await bus.register(fa, 'a'); await bus.register(fb, 'b')
  route(bus, 'a', 'b')
  expect((await fa.state.ctx!.emit(fired, { text: 'hi' })).type).toBe('success')
  await flush()
  expect(fb.received[0].input).toEqual({ text: 'hi' })
  expect(fb.received[0].from.instance).toBe('a')
  expect(fb.received[0].target).toEqual(ref('b'))
})

test('emit with no route returns success and delivers nothing', async () => {
  const { bus, errors } = setup()
  const fa = echoFactory('x', 'e'), fb = echoFactory('x', 'e')
  await bus.register(fa, 'a'); await bus.register(fb, 'b')
  expect((await fa.state.ctx!.emit(fired, { text: 'hi' })).type).toBe('success')
  await flush()
  expect(fb.received.length).toBe(0); expect(errors.length).toBe(0)
})

test('emit of unknown event or bad payload returns error code validation', async () => {
  const { bus } = setup()
  const fa = echoFactory('x', 'e')
  await bus.register(fa, 'a')
  // @ts-expect-error runtime validation is what's under test
  const r = await fa.state.ctx!.emit(fired, { text: 1 })
  expect(r.type === 'error' && r.error.code).toBe('validation')
  const r2 = await fa.state.ctx!.emit({ name: 'nope', schema: Type.Unknown() }, {})
  expect(r2.type === 'error' && r2.error.code).toBe('validation')
})

const consumer = (onAction: Component['onAction'] = async () => ok(null)): ComponentFactory => {
  const manifest = defineManifest({ id: { author: 'x', id: 'n' }, version: '0.1.0', emits: [],
    consumes: [{ name: 'log', input: Type.Object({ n: Type.Number() }) }] })
  return { manifest, create: () => ({ manifest, onAction, dispose: async () => {} }) }
}

test('delivery payload invalid for target input is not delivered', async () => {
  const { bus, errors } = setup()
  let called = 0
  const fa = echoFactory('x', 'e')
  await bus.register(fa, 'a'); await bus.register(consumer(async () => { called++; return ok(null) }), 'n')
  route(bus, 'a', 'n')
  await fa.state.ctx!.emit(fired, { text: 'hi' })
  await flush()
  expect(called).toBe(0)
  expect(errors.map(e => e.code)).toEqual(['validation'])
})

test('throwing receiver does not block other receivers', async () => {
  const { bus, errors } = setup()
  const fa = echoFactory('x', 'e'), good = echoFactory('x', 'e')
  const bad: ComponentFactory = { manifest: fa.manifest, create: () => ({ manifest: fa.manifest, onAction: async () => { throw new Error('boom') }, dispose: async () => {} }) }
  await bus.register(fa, 'a'); await bus.register(bad, 'bad'); await bus.register(good, 'good')
  route(bus, 'a', 'bad'); route(bus, 'a', 'good')
  await fa.state.ctx!.emit(fired, { text: 'hi' })
  await flush()
  expect(good.received.length).toBe(1)
  expect(errors.map(e => e.code)).toEqual(['handler'])
})

test('synchronously throwing receiver does not block other receivers', async () => {
  const { bus, errors } = setup()
  const fa = echoFactory('x', 'e'), good = echoFactory('x', 'e')
  const bad: ComponentFactory = { manifest: fa.manifest, create: () => ({ manifest: fa.manifest, dispose: async () => {},
    onAction: (() => { throw new Error('sync boom') }) as Component['onAction'] }) }
  await bus.register(fa, 'a'); await bus.register(bad, 'bad'); await bus.register(good, 'good')
  route(bus, 'a', 'bad'); route(bus, 'a', 'good')
  await fa.state.ctx!.emit(fired, { text: 'hi' }); await flush()
  expect(good.received.length).toBe(1)
  expect(errors.map(e => e.code)).toEqual(['handler'])
})

test('unregister stops delivery and calls dispose', async () => {
  const { bus } = setup()
  const fa = echoFactory('x', 'e'), fb = echoFactory('x', 'e')
  await bus.register(fa, 'a'); await bus.register(fb, 'b')
  route(bus, 'a', 'b')
  await bus.unregister(ref('b'))
  expect(fb.state.disposed).toBe(1)
  expect(bus.instances().map(i => i.instance)).toEqual(['a'])
  await fa.state.ctx!.emit(fired, { text: 'hi' }); await flush()
  expect(fb.received.length).toBe(0)
})

test('re-register after unregister delivers exactly once', async () => {
  const { bus } = setup()
  const fa = echoFactory('x', 'e'), fb = echoFactory('x', 'e')
  await bus.register(fa, 'a'); await bus.register(fb, 'b')
  route(bus, 'a', 'b')
  await bus.unregister(ref('b'))
  await bus.register(fb, 'b'); route(bus, 'a', 'b')
  await fa.state.ctx!.emit(fired, { text: 'hi' }); await flush()
  expect(fb.received.length).toBe(1)
})

test('unregister drops routes: re-register without re-routing delivers nothing', async () => {
  const { bus } = setup()
  const fa = echoFactory('x', 'e'), fb = echoFactory('x', 'e')
  await bus.register(fa, 'a'); await bus.register(fb, 'b')
  route(bus, 'a', 'b')
  await bus.unregister(ref('b')); await bus.register(fb, 'b')
  await fa.state.ctx!.emit(fired, { text: 'hi' }); await flush()
  expect(fb.received.length).toBe(0)
})

test('unregister between emit and delivery does not reach the disposed component', async () => {
  const { bus, errors } = setup()
  const fa = echoFactory('x', 'e'), fb = echoFactory('x', 'e')
  await bus.register(fa, 'a'); await bus.register(fb, 'b')
  route(bus, 'a', 'b')
  const emitted = fa.state.ctx!.emit(fired, { text: 'hi' }) // delivery is scheduled synchronously
  void bus.unregister(ref('b'))
  await emitted; await flush()
  expect(fb.received.length).toBe(0)
  expect(errors.map(e => e.code)).toEqual(['unknown-target'])
})

test('zombie ctx of an unregistered instance cannot emit, even after the name is reused', async () => {
  const { bus } = setup()
  const fa = echoFactory('x', 'e'), fa2 = echoFactory('x', 'e'), fb = echoFactory('x', 'e')
  await bus.register(fa, 'a'); await bus.register(fb, 'b')
  const zombie = fa.state.ctx!
  await bus.unregister(ref('a'))
  const r = await zombie.emit(fired, { text: 'hi' })
  expect(r.type === 'error' && r.error.code).toBe('unknown-target')
  await bus.register(fa2, 'a'); route(bus, 'a', 'b')
  const r2 = await zombie.emit(fired, { text: 'hi' }); await flush()
  expect(r2.type).toBe('error'); expect(fb.received.length).toBe(0)
  await fa2.state.ctx!.emit(fired, { text: 'ok' }); await flush()
  expect(fb.received.length).toBe(1)
})

test('throwing onDeliveryError does not escape emit', async () => {
  const bus = Contexts.bus({ self: { ...rootRef, manifest: echoFactory('x', 'root').manifest }, onDeliveryError: () => { throw new Error('observer') } })
  const fa = echoFactory('x', 'e')
  await bus.register(fa, 'a')
  bus.route({ from: { instance: ref('a'), event: 'fired' }, to: { instance: ref('ghost'), action: 'log' } })
  expect((await fa.state.ctx!.emit(fired, { text: 'hi' })).type).toBe('success')
  await flush()
})

test('concurrent duplicate register is rejected', async () => {
  const { bus } = setup()
  const results = await Promise.allSettled([bus.register(echoFactory('x', 'e'), 'a'), bus.register(echoFactory('x', 'e'), 'a')])
  expect(results.map(r => r.status).sort()).toEqual(['fulfilled', 'rejected'])
  expect(bus.instances().length).toBe(1)
})

test('invocation scoped ctx extends stack', async () => {
  const { bus } = setup()
  const fa = echoFactory('x', 'e'), fc = echoFactory('x', 'e'), fb = echoFactory('x', 'e')
  const b: ComponentFactory = { manifest: fb.manifest, create: () => {
    return { manifest: fb.manifest, dispose: async () => {}, onAction: async (sctx) => { await flush(); await sctx.emit(fired, { text: 'again' }); return ok(null) } }
  } }
  await bus.register(fa, 'a'); await bus.register(b, 'b'); await bus.register(fc, 'c')
  route(bus, 'a', 'b'); route(bus, 'b', 'c')
  await fa.state.ctx!.emit(fired, { text: 'hi' })
  await flush(); await flush()
  expect(fc.received.length).toBe(1)
  expect(fc.received[0].stack.length).toBe(1)
  expect(fc.received[0].stack[0].from.instance).toBe('a')
})
