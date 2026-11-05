import { test, expect } from 'bun:test'
import Type from 'typebox'
import { defineManifest, ok, type SystemError, type Component, type ComponentFactory, type InstanceRef } from '../src'
import { Contexts } from '../src/contexts'
import { echoFactory, rootRef } from './fixtures'

const flush = () => new Promise(r => setTimeout(r))
const setup = () => {
  const errors: SystemError[] = []
  const bus = Contexts.bus({ self: { ...rootRef, manifest: echoFactory('x', 'root').manifest }, onDeliveryError: e => errors.push(e) })
  return { bus, errors }
}
const ref = (instance: string): InstanceRef => ({ namespace: ['root'], instance })

test('call returns target result', async () => {
  const { bus } = setup()
  const fa = echoFactory('x', 'e'), fb = echoFactory('x', 'e')
  await bus.register(fa, 'a'); await bus.register(fb, 'b')
  expect(await fa.state.ctx!.call(ref('b'), 'log', { x: 1 })).toEqual({ type: 'success', data: { x: 1 } })
})

test('call to unknown target returns unknown-target and never throws', async () => {
  const { bus } = setup()
  const fa = echoFactory('x', 'e'); await bus.register(fa, 'a')
  for (const t of [ref('nope'), { namespace: ['elsewhere'], instance: 'z' }]) {
    const r = await fa.state.ctx!.call(t, 'log', {})
    expect(r.type === 'error' && r.error.code).toBe('unknown-target')
  }
})

test('call with invalid input returns validation; unknown action returns unknown-action', async () => {
  const { bus } = setup()
  const fa = echoFactory('x', 'e')
  const strict: ComponentFactory = {
    manifest: defineManifest({ id: { author: 'x', id: 's' }, version: '0', emits: [], consumes: [{ name: 'go', input: Type.Object({ n: Type.Number() }) }] }),
    create: () => ({ manifest: strict.manifest, onAction: async () => ok(1), dispose: async () => {} }),
  }
  await bus.register(fa, 'a'); await bus.register(strict, 's')
  const r = await fa.state.ctx!.call(ref('s'), 'go', { n: 'x' })
  expect(r.type === 'error' && r.error.code).toBe('validation')
  const r2 = await fa.state.ctx!.call(ref('s'), 'nope', {})
  expect(r2.type === 'error' && r2.error.code).toBe('unknown-action')
})

test('call validates output, and maps throwing handlers to handler error', async () => {
  const { bus } = setup()
  const fa = echoFactory('x', 'e')
  const mk = (h: () => Promise<any>): ComponentFactory => {
    const f: ComponentFactory = {
      manifest: defineManifest({ id: { author: 'x', id: 'o' }, version: '0', emits: [], consumes: [{ name: 'go', input: Type.Unknown(), output: Type.Number() }] }),
      create: () => ({ manifest: f.manifest, onAction: h, dispose: async () => {} }),
    }
    return f
  }
  await bus.register(fa, 'a'); await bus.register(mk(async () => ok('str')), 'bad'); await bus.register(mk(async () => { throw new Error('boom') }), 'thr')
  const r = await fa.state.ctx!.call(ref('bad'), 'go', {})
  expect(r.type === 'error' && r.error.code).toBe('validation')
  const r2 = await fa.state.ctx!.call(ref('thr'), 'go', {})
  expect(r2.type === 'error' && r2.error.code).toBe('handler')
})

test('deeper target is delivered to the host instance with the full target; no parent forwards to parent', async () => {
  const { bus } = setup()
  const fa = echoFactory('x', 'e'), fh = echoFactory('x', 'e')
  await bus.register(fa, 'a'); await bus.register(fh, 'h')
  const deep: InstanceRef = { namespace: ['root', 'h'], instance: 'inner' }
  await fa.state.ctx!.call(deep, 'whatever', { q: 1 })
  expect(fh.received[0].target).toEqual(deep); expect(fh.received[0].action).toBe('whatever')
  const r = await fa.state.ctx!.call({ namespace: ['root', 'missing'], instance: 'i' }, 'log', {})
  expect(r.type === 'error' && r.error.code).toBe('unknown-target')
  // parent forwarding
  const seen: unknown[] = []
  const parent = { capabilities: () => bus.capabilities(), emit: bus.emit, call: async (t: InstanceRef, a: string) => { seen.push([t, a]); return ok('p') } }
  const inner = Contexts.bus({ self: { namespace: ['root'], instance: 'h', manifest: fh.manifest }, parent })
  expect(await inner.call(ref('a'), 'log', {})).toEqual(ok('p')); expect(seen.length).toBe(1)
})

test('route cycle ends in loop error', async () => {
  const { bus, errors } = setup()
  const depths: number[] = []
  const mk = (): ComponentFactory => {
    const f: ComponentFactory = {
      manifest: defineManifest({
        id: { author: 'x', id: 'loop' }, version: '0',
        emits: [{ name: 'fired', schema: Type.Object({ text: Type.String() }) }],
        consumes: [{ name: 'log', input: Type.Unknown() }],
      }),
      create: ctx => ({
        manifest: f.manifest, dispose: async () => {},
        onAction: async (sctx, inv) => { depths.push(inv.stack.length); await sctx.emit('fired', { text: 'x' }); return ok(null) },
      } as Component),
    }
    return f
  }
  const fa = mk(), fb = mk()
  await bus.register(fa, 'a'); await bus.register(fb, 'b')
  bus.route({ from: { instance: ref('a'), event: 'fired' }, to: { instance: ref('b'), action: 'log' } })
  bus.route({ from: { instance: ref('b'), event: 'fired' }, to: { instance: ref('a'), action: 'log' } })
  const t = Date.now()
  await bus.emitFrom(bus.instances()[0], 'fired', { text: 'go' })
  for (let i = 0; i < 50 && !errors.some(e => e.code === 'loop'); i++) await flush()
  expect(errors.some(e => e.code === 'loop')).toBe(true)
  expect(Math.max(...depths)).toBeLessThanOrEqual(16)
  expect(Date.now() - t).toBeLessThan(1000)
})

test('environment lists registered instances as leaves', async () => {
  const { bus } = setup()
  await bus.register(echoFactory('x', 'e'), 'a'); await bus.register(echoFactory('x', 'e'), 'b')
  const env = bus.capabilities().environment
  expect(env.type).toBe('node')
  if (env.type === 'node') {
    expect(env.instance.instance).toBe('root')
    expect(env.children.map(c => [c.type, c.instance.instance])).toEqual([['leaf', 'a'], ['leaf', 'b']])
  }
})
