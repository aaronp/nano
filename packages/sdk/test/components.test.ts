import { test, expect } from 'bun:test'
import Type from 'typebox'
import { Components, Contexts, Manifests, defineManifest, fail, ok, type Created, type Factory, type Invocation, type SystemError } from '../src'
import { act, echoFactory, rootRef } from './fixtures'

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
  const b = Contexts.bus({
    self: { ...rootRef, manifest: defineManifest({ id: { author: 't', id: 'root' }, version: '0', emits: [], consumes: [] }) },
    onDeliveryError: e => errors.push(e),
  })
  return Object.assign(b, { errors })
}
const pair = (more: Pick<Parameters<typeof Components.compose>[0], 'routes' | 'expose'> = {}) => Components.compose({
  id: { author: 't', id: 'pair' }, version: '0',
  children: { s: speaker, l: listener },
  routes: [{ from: ['s', said], to: ['l', hear] }],
  ...more,
})

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

test('compose rejects duplicates, bad routes and unknown exposes at build time', () => {
  const twice = { id: { author: 't', id: 'c' }, version: '0', children: { a: speaker, b: speaker } }
  expect(() => Components.compose(twice)).toThrow('duplicate names t/speaker/said, t/speaker/say')
  expect(() => pair({ routes: [{ from: ['l', said], to: ['l', hear] }] })).toThrow('child "l" does not emit')
  expect(() => pair({ routes: [{ from: ['s', said], to: ['nope', hear] }] })).toThrow('child "nope" does not consume')
  expect(() => pair({ expose: [{ name: 'zz', input: Type.Null() }] })).toThrow('expose: no child has zz')
  expect(Manifests.compose({ id: { author: 't', id: 'm' }, version: '0' }, speaker.manifest, listener.manifest).consumes.length).toBe(3)
})

test('composite delegates with the original sender, routes, bubbles, hops, reports environment, disposes', async () => {
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
  expect(outside.map(i => i.input)).toEqual(['hi'])    // bubbled out

  await b.call(p, hear, 'direct')                       // delegated by action name
  expect(heard.at(-1)).toEqual({ s: 'direct', from: 'root' })
  await b.call({ namespace: ['root', 'pair'], instance: 'l' }, hear, 'hop')
  expect(heard.at(-1)).toEqual({ s: 'hop', from: 'root' })

  const env = b.capabilities().environment
  const node = env.type === 'node' ? env.children[0] : undefined
  expect(node?.type === 'node' && node.children.map(c => c.instance.instance)).toEqual(['s', 'l'])

  const c = b.component(p) as Created<ReturnType<typeof pair>>
  expect(c.children.s.state.count).toBe(1)
  await b.unregister(p)
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
  const c = Components.compose({ id: { author: 't', id: 'c' }, version: '0', children: { a: ok1, b: boom } })
  await expect(root().register(c, 'c')).rejects.toThrow('boom')
  expect(disposed).toBe(1)
})

test('a call leaving a composite keeps the inner sender; a forged sender is ignored', async () => {
  heard.length = 0
  const P = Components.declare({ author: 't', id: 'pinger' }, '0')
  const ping = P.action('ping', 'Call out to the root listener', Type.Null())
  const outsider = { namespace: ['root'], instance: 'l' }
  const pinger = P.define({ state: () => null, actions: [[ping, (_i, { ctx }) => ctx.call(outsider, hear, 'from inside')]] })
  const b = root()
  await b.register(listener, 'l')
  const box = await b.register(Components.compose({ id: { author: 't', id: 'box' }, version: '0', children: { p: pinger } }), 'box')
  expect((await b.call(box, ping, null)).type).toBe('success')
  expect(heard.at(-1)).toEqual({ s: 'from inside', from: 'p' })

  // Forgery: a leaf claims a sibling as sender; the bus ignores it.
  const fa = echoFactory('t', 'a'), fb = echoFactory('t', 'b')
  await b.register(fa, 'a'); const sib = await b.register(fb, 'b')
  await fa.state.ctx!.call(sib, act('log'), {}, { stack: [], from: sib })
  expect(fb.received.at(-1)!.from.instance).toBe('a')
})
