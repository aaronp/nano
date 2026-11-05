import { test, expect } from 'bun:test'
import Type from 'typebox'
import { defineManifest, ok, type SystemError, type Component, type ComponentFactory, type Context, type InstanceRef } from '../src'
import { Contexts } from '../src/contexts'
import { act, echoFactory, fired, rootRef } from './fixtures'

const flush = () => new Promise(r => setTimeout(r))
const setup = () => {
  const errors: SystemError[] = []
  const bus = Contexts.registry({ self: { ...rootRef, manifest: echoFactory('x', 'root').manifest }, onDeliveryError: e => errors.push(e) })
  return { bus, errors }
}
const ref = (instance: string): InstanceRef => ({ namespace: ['root'], instance })

test('call returns target result', async () => {
  const { bus } = setup()
  const fa = echoFactory('x', 'e'), fb = echoFactory('x', 'e')
  await bus.register(fa, 'a'); await bus.register(fb, 'b')
  expect(await fa.state.ctx!.call(ref('b'), act('log'), { x: 1 })).toEqual({ type: 'success', data: { x: 1 } })
})

test('call to unknown target returns unknown-target and never throws', async () => {
  const { bus } = setup()
  const fa = echoFactory('x', 'e'); await bus.register(fa, 'a')
  for (const t of [ref('nope'), { namespace: ['elsewhere'], instance: 'z' }]) {
    const r = await fa.state.ctx!.call(t, act('log'), {})
    expect(r.type === 'error' && r.error.code).toBe('unknown-target')
  }
})

test('call with invalid input returns validation; unknown action returns unknown-action', async () => {
  const { bus } = setup()
  const fa = echoFactory('x', 'e')
  const strict: ComponentFactory = {
    manifest: defineManifest({ id: { author: 'x', id: 's' }, version: '0', emits: [], consumes: [{ name: 'go', input: Type.Object({ n: Type.Number() }) }] }),
    create: () => ({ onAction: async () => ok(1), dispose: async () => {} }),
  }
  await bus.register(fa, 'a'); await bus.register(strict, 's')
  const r = await fa.state.ctx!.call(ref('s'), act('go'), { n: 'x' })
  expect(r.type === 'error' && r.error.code).toBe('validation')
  const r2 = await fa.state.ctx!.call(ref('s'), act('nope'), {})
  expect(r2.type === 'error' && r2.error.code).toBe('unknown-action')
})

test('call validates output, and maps throwing handlers to handler error', async () => {
  const { bus } = setup()
  const fa = echoFactory('x', 'e')
  const mk = (h: () => Promise<any>): ComponentFactory => {
    const f: ComponentFactory = {
      manifest: defineManifest({ id: { author: 'x', id: 'o' }, version: '0', emits: [], consumes: [{ name: 'go', input: Type.Unknown(), output: Type.Number() }] }),
      create: () => ({ onAction: h, dispose: async () => {} }),
    }
    return f
  }
  await bus.register(fa, 'a'); await bus.register(mk(async () => ok('str')), 'bad'); await bus.register(mk(async () => { throw new Error('boom') }), 'thr')
  const r = await fa.state.ctx!.call(ref('bad'), act('go'), {})
  expect(r.type === 'error' && r.error.code).toBe('validation')
  const r2 = await fa.state.ctx!.call(ref('thr'), act('go'), {})
  expect(r2.type === 'error' && r2.error.code).toBe('handler')
})

test('a deep target is looked up directly; a missing one is unknown-target', async () => {
  const { bus } = setup()
  const fa = echoFactory('x', 'e'), fh = echoFactory('x', 'e')
  await bus.register(fa, 'a')
  const deep: InstanceRef = { namespace: ['root', 'h'], instance: 'inner' }
  const host: ComponentFactory = { manifest: fh.manifest, create: async (_c, _s, h) => { await h.register(fh, 'inner'); return { onAction: async () => ok(null) } } }
  await bus.register(host, 'h')
  expect(await fa.state.ctx!.call(deep, act('log'), { q: 1 })).toEqual(ok({ q: 1 }))
  expect(fh.received[0].target).toEqual(deep)
  const r = await fa.state.ctx!.call({ namespace: ['root', 'missing'], instance: 'i' }, act('log'), {})
  expect(r.type === 'error' && r.error.code).toBe('unknown-target')
})

test('route cycle ends in loop error', async () => {
  const { bus, errors } = setup()
  const depths: number[] = []
  const ctxs: Context[] = []
  const mk = (): ComponentFactory => {
    const f: ComponentFactory = {
      manifest: defineManifest({
        id: { author: 'x', id: 'loop' }, version: '0',
        emits: [{ name: 'fired', schema: Type.Object({ text: Type.String() }) }],
        consumes: [{ name: 'log', input: Type.Unknown() }],
      }),
      create: ctx => (ctxs.push(ctx), {
        dispose: async () => {},
        onAction: async (sctx, inv) => { depths.push(inv.stack.length); await sctx.emit(fired, { text: 'x' }); return ok(null) },
      } as Component),
    }
    return f
  }
  const fa = mk(), fb = mk()
  await bus.register(fa, 'a'); await bus.register(fb, 'b')
  bus.route({ from: { instance: ref('a'), event: 'fired' }, to: { instance: ref('b'), action: 'log' } })
  bus.route({ from: { instance: ref('b'), event: 'fired' }, to: { instance: ref('a'), action: 'log' } })
  const t = Date.now()
  await ctxs[0].emit(fired, { text: 'go' })
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
