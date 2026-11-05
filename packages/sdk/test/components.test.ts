import { test, expect } from 'bun:test'
import Type from 'typebox'
import { Components, Contexts, Emits, Manifests, defineManifest, fail, ok, type Action, type Context, type Created, type Event, type Factory, type Invocation, type SystemError } from '../src'
import { rootRef } from './fixtures'

const flush = () => new Promise(r => setTimeout(r, 0))

const S = Components.declare({ author: 't', id: 'speaker' }, '0')
const said = S.event('said', 'Something was said', Type.String())
const say = S.action('say', 'Say something', Type.String())
const speaker = S.define({
  state: () => ({ count: 0 }),
  actions: [[say, (s, { state, ctx }) => { state.count++; return ctx.emit(said, s) }]],
})

const L = Components.declare({ author: 't', id: 'listener' }, '0')
const hear = L.action('hear', 'Record something heard', Type.String())
const add = L.action('add', 'Add two numbers', Type.Object({ a: Type.Number(), b: Type.Number() }), Type.Number())
const heard: { s: string; from: string }[] = []
const listener = L.define({
  state: () => null,
  actions: [
    [hear, (s, { inv }) => { heard.push({ s, from: inv.from.instance }) }],
    [add, ({ a, b }) => a + b > 100 ? fail('handler', 'too big') : ok(a + b)],
  ],
})

const root = () => {
  const errors: SystemError[] = []
  const b = Contexts.registry({
    self: { ...rootRef, manifest: defineManifest({ id: { author: 't', id: 'root' }, version: '0', emits: [], consumes: [] }) },
    onDeliveryError: e => errors.push(e),
  })
  return Object.assign(b, { errors })
}
const pair = (opts: { expose?: (Event | Action)[]; wrapS?: (c: Context) => Context } = {}) =>
  Components.compose({ id: { author: 't', id: 'pair' }, version: '0' }, c => {
    const s = c.use('s', speaker, opts.wrapS), l = c.use('l', listener)
    c.route(s(said), l(hear))
    if (opts.expose) c.expose(...opts.expose)
    return { s, l }
  })
const meta = (id: string) => ({ id: { author: 't', id }, version: '0' })

test('declare names from the id and derives the manifest; define requires every handler', () => {
  expect(speaker.manifest).toMatchObject({ emits: [{ name: 't/speaker/said', description: 'Something was said' }], consumes: [{ name: 't/speaker/say' }] })
  const X = Components.declare({ author: 't', id: 'x' }, '0')
  X.action('a', 'unhandled', Type.Null())
  expect(() => X.define({ state: () => 0, actions: [] })).toThrow('no handler for t/x/a')
})

test('handlers return a Result (typed call output) or nothing', async () => {
  const b = root()
  const l = await b.register(listener, 'l')
  const r = await b.call(l, add, { a: 1, b: 2 })
  expect(r).toEqual(ok(3))
  if (r.type === 'success') { const n: number = r.data; expect(n).toBe(3) }
  expect((await b.call(l, add, { a: 100, b: 2 })).type).toBe('error')
  expect(await b.call(l, hear, 'x')).toEqual(ok(undefined))
})

test('model notifies on change and emits UI-originated events', async () => {
  const b = root()
  const s = await b.register(speaker, 's')
  const model = b.component(s) as Created<typeof speaker>
  let changes = 0
  const off = model.onChange(() => changes++)
  await b.call(s, say, 'a')
  expect(model.state.count).toBe(1)
  expect((await model.emit(said, 'b')).type).toBe('success')
  off(); await b.call(s, say, 'c')
  expect(changes).toBe(2)
})

test('compose rejects mistakes at build time', () => {
  expect(() => Components.compose(meta('c'), c => ({ a: c.use('a', speaker), b: c.use('b', speaker) }))).toThrow('duplicate names t/speaker/said, t/speaker/say')
  expect(() => Components.compose(meta('c'), c => ({ a: c.use('a', speaker), b: c.use('a', listener) }))).toThrow('duplicate child "a"')
  expect(() => Components.compose(meta('c'), c => { const l = c.use('l', listener); c.route(l(said), l(hear)); return {} })).toThrow('child "l" does not emit')
  expect(() => Components.compose(meta('c'), c => { const s = c.use('s', speaker); c.route(s(said), s(hear)); return {} })).toThrow('child "s" does not consume')
  expect(() => pair({ expose: [{ name: 'zz', input: Type.Null() }] })).toThrow('expose: no child has zz')
  expect(Manifests.compose(meta('m'), speaker.manifest, listener.manifest).consumes.length).toBe(3)
})

test('two copies of one widget compose when their clashing names are not exposed', async () => {
  const twin = Components.compose(meta('twin'), c => {
    const a = c.use('a', speaker), b = c.use('b', speaker), l = c.use('l', listener)
    c.route(a(said), l(hear)); c.route(b(said), l(hear))
    c.expose(hear)
    return { a, b }
  })
  heard.length = 0
  const r = root(), inst = await r.register(twin, 'twin')
  await r.call({ namespace: ['root', 'twin'], instance: 'b' }, say, 'from b')
  await flush()
  expect(heard).toEqual([{ s: 'from b', from: 'b' }])
  expect((r.component(inst) as Created<typeof twin>).children.b.state.count).toBe(1)
})

test('composite delegates, routes internally, bubbles exposed events, reports environment, disposes', async () => {
  heard.length = 0
  const b = root()
  const p = await b.register(pair(), 'pair')
  const outside: Invocation[] = []
  const out: Factory = { manifest: listener.manifest, create: async () => ({ onAction: async (_c, inv) => (outside.push(inv), ok(null)) }) }
  await b.register(out, 'out')
  b.route({ from: { instance: p, event: said.name }, to: { instance: { namespace: ['root'], instance: 'out' }, action: hear.name } })

  expect((await b.call(p, say, 'hi')).type).toBe('success')
  await flush()
  expect(heard).toEqual([{ s: 'hi', from: 's' }])     // internal route
  expect(outside.map(i => [i.input, i.from.instance])).toEqual([['hi', 'pair']])   // bubbled: the composite emits it

  await b.call(p, hear, 'delegated')                    // sender is the composite; the caller is in the stack
  expect(heard.at(-1)).toEqual({ s: 'delegated', from: 'pair' })
  await b.call({ namespace: ['root', 'pair'], instance: 'l' }, hear, 'direct')
  expect(heard.at(-1)).toEqual({ s: 'direct', from: 'root' })

  const env = b.capabilities().environment
  const node = env.type === 'node' ? env.children[0] : undefined
  expect(node?.type === 'node' && node.children.map(c => c.instance.instance)).toEqual(['s', 'l'])

  const c = b.component(p) as Created<ReturnType<typeof pair>>
  expect(c.children.s.state.count).toBe(1)
  await b.unregister(p)
  expect(b.instances().map(i => i.instance)).toEqual(['out'])
  expect((await c.children.s.emit(said, 'late')).type).toBe('error')
  expect(b.errors).toEqual([])
})

test('expose hides internal wiring', async () => {
  const p = pair({ expose: [say] })
  expect(p.manifest.emits).toEqual([])
  expect(p.manifest.consumes.map(a => a.name)).toEqual(['t/speaker/say'])
  const b = root()
  const inst = await b.register(p, 'pair')
  expect((await b.call(inst, hear, 'x')).type).toBe('error')
})

test('a failing child cleans up the ones already created', async () => {
  let disposed = 0
  const D = Components.declare({ author: 't', id: 'd' }, '0')
  const ok1 = D.define({ state: () => 0, actions: [], dispose: () => { disposed++ } })
  const boom: Factory = { manifest: { id: { author: 't', id: 'boom' }, version: '0', emits: [], consumes: [] }, create: async () => { throw new Error('boom') } }
  const c = Components.compose(meta('c'), c => ({ a: c.use('a', ok1), b: c.use('b', boom) }))
  const r = root()
  await expect(r.register(c, 'c')).rejects.toThrow('boom')
  expect(disposed).toBe(1)
  expect(r.instances()).toEqual([])
})

test('a call leaving a composite comes from the inner child', async () => {
  heard.length = 0
  const P = Components.declare({ author: 't', id: 'pinger' }, '0')
  const ping = P.action('ping', 'Call out to the root listener', Type.Null())
  const pinger = P.define({ state: () => null, actions: [[ping, (_i, { ctx }) => ctx.call({ namespace: ['root'], instance: 'l' }, hear, 'from inside')]] })
  const b = root()
  await b.register(listener, 'l')
  const box = await b.register(Components.compose(meta('box'), c => { c.use('p', pinger); return {} }), 'box')
  expect((await b.call(box, ping, null)).type).toBe('success')
  expect(heard.at(-1)).toEqual({ s: 'from inside', from: 'p' })
})

test('use(..., wrap): the parent derives a child context; routing and bubbling both see the result', async () => {
  heard.length = 0
  const b = root()
  const seen: unknown[] = []
  const out: Factory = { manifest: listener.manifest, create: async () => ({ onAction: async (_c, inv) => (seen.push(inv.input), ok(null)) }) }
  const loud = pair({
    wrapS: c => c
      .withEmit(Emits.filter(e => e.payload !== 'SECRET'))
      .withEmit(Emits.map(e => ({ ...e, payload: String(e.payload).toUpperCase() }))),
  })
  const p = await b.register(loud, 'pair')
  await b.register(out, 'out')
  b.route({ from: { instance: p, event: said.name }, to: { instance: { namespace: ['root'], instance: 'out' }, action: hear.name } })
  await b.call(p, say, 'hi')
  expect((await b.call(p, say, 'secret')).type).toBe('not-allowed')   // speaker returns its (filtered) emit result
  await flush()
  expect(heard.map(h => h.s)).toEqual(['HI'])
  expect(seen).toEqual(['HI'])
})
