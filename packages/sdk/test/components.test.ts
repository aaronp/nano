import { test, expect } from 'bun:test'
import Type from 'typebox'
import { Calls, Components, Contexts, Emits, Manifests, fail, ok, type Action, type Context, type Event, type Factory } from '../src'

const flush = () => new Promise(r => setTimeout(r, 0))
const meta = (id: string) => ({ id: { author: 't', id }, version: '0' })

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
const listener = () => {
  const heard: { s: string; from: string; origin: string }[] = []
  const f = L.define({
    state: () => heard,
    actions: [
      [hear, (s, { inv }) => { heard.push({ s, from: inv.from, origin: inv.stack[0]?.from ?? inv.from }) }],
      [add, ({ a, b }) => a + b > 100 ? fail('handler', 'too big') : ok(a + b)],
    ],
  })
  return Object.assign(f, { heard })
}

const pair = (l = listener(), opts: { expose?: (Event | Action)[]; wrapS?: (c: Context, outer: Context) => Context } = {}) =>
  Components.compose(meta('pair'), c => {
    const s = c.use('s', speaker, opts.wrapS), li = c.use('l', l)
    c.route(s(said), li(hear))
    if (opts.expose) c.expose(...opts.expose)
    return { s, l: li }
  })

test('declare names from the id and derives the manifest; define requires every handler', () => {
  expect(speaker.manifest).toMatchObject({ emits: [{ name: 't/speaker/said', description: 'Something was said' }], consumes: [{ name: 't/speaker/say' }] })
  const X = Components.declare({ author: 't', id: 'x' }, '0')
  X.action('a', 'unhandled', Type.Null())
  expect(() => X.define({ state: () => 0, actions: [] })).toThrow('no handler for t/x/a')
})

test('handlers return a Result (typed call output) or nothing; the model notifies and emits', async () => {
  const s = Contexts.scope(), page = s.context('page')
  const l = listener(); await s.add('l', l)
  const r = await page.call('l', add, { a: 1, b: 2 })
  expect(r).toEqual(ok(3))
  expect((await page.call('l', add, { a: 100, b: 2 })).type).toBe('error')
  expect(await page.call('l', hear, 'x')).toEqual(ok(undefined))

  const model = await s.add('s', speaker)
  let changes = 0
  const off = model.onChange(() => changes++)
  await page.call('s', say, 'a')
  expect((await model.emit(said, 'b')).type).toBe('success')
  off(); await page.call('s', say, 'c')
  expect([model.state.count, changes]).toEqual([2, 2])
})

test('setup runs on create; what it returns runs on dispose', async () => {
  const log: string[] = []
  const D = Components.declare({ author: 't', id: 'd' }, '0')
  const d = D.define({ state: () => null, setup: () => { log.push('setup'); return () => log.push('cleanup') }, dispose: () => { log.push('dispose') } })
  const s = Contexts.scope()
  await s.add('d', d); await s.remove('d')
  expect(log).toEqual(['setup', 'cleanup', 'dispose'])
})

test('compose rejects mistakes at build time', () => {
  expect(() => Components.compose(meta('c'), c => ({ a: c.use('a', speaker), b: c.use('b', speaker) }))).toThrow('duplicate names t/speaker/said, t/speaker/say')
  expect(() => Components.compose(meta('c'), c => ({ a: c.use('a', speaker), b: c.use('a', listener()) }))).toThrow('duplicate child "a"')
  expect(() => Components.compose(meta('c'), c => { const l = c.use('l', listener()); c.route(l(said), l(hear)); return {} })).toThrow('child "l" does not emit')
  expect(() => Components.compose(meta('c'), c => { const s = c.use('s', speaker); c.route(s(said), s(hear)); return {} })).toThrow('child "s" does not consume')
  expect(() => pair(listener(), { expose: [{ name: 'zz', input: Type.Null() }] })).toThrow('expose: no child has zz')
  expect(Manifests.compose(meta('m'), speaker.manifest, listener().manifest).consumes.length).toBe(3)
})

test('a composite is just an instance: delegates, routes inside, re-emits exposed events, hides its insides', async () => {
  const outer = Contexts.scope(), page = outer.context('page')
  const l = listener()
  const p = await outer.add('pair', pair(l))
  const outside: { s: string; from: string; origin: string }[] = []
  page.on(said, (s, d) => { outside.push({ s, from: d.from, origin: d.stack[0].from }) })

  expect((await page.call('pair', say, 'hi')).type).toBe('success')
  await flush()
  expect(l.heard).toEqual([{ s: 'hi', from: 's', origin: 'page' }])   // inside: routed from the child; origin kept
  expect(outside).toEqual([{ s: 'hi', from: 'pair', origin: 'page' }]) // outside: the composite emitted it

  await page.call('pair', hear, 'delegated')
  expect(l.heard.at(-1)).toEqual({ s: 'delegated', from: 'pair', origin: 'page' })

  expect(page.instances().map(i => i.name)).toEqual(['pair'])           // children are not visible outside
  expect((await page.call('s', say, 'x')).type).toBe('error')
  expect(p.children.s.state.count).toBe(1)
  await outer.remove('pair')
  expect((await p.children.s.emit(said, 'late')).type).toBe('error')
})

test('expose hides internal wiring; two copies of one widget compose when their names are not exposed', async () => {
  const p = pair(listener(), { expose: [say] })
  expect(p.manifest.emits).toEqual([])
  expect(p.manifest.consumes.map(a => a.name)).toEqual(['t/speaker/say'])
  const s = Contexts.scope(), page = s.context('page')
  await s.add('pair', p)
  expect((await page.call('pair', hear, 'x')).type).toBe('error')

  const l = listener()
  const twin = Components.compose(meta('twin'), c => {
    const a = c.use('a', speaker), b = c.use('b', speaker), li = c.use('l', l)
    c.route(a(said), li(hear)); c.route(b(said), li(hear))
    c.expose(hear)
    return { a, b }
  })
  const t = await s.add('twin', twin)
  await t.children.b.emit(said, 'from b'); await flush()
  expect(l.heard).toEqual([{ s: 'from b', from: 'b', origin: 'b' }])
})

test('a failing child cleans up the ones already created', async () => {
  let disposed = 0
  const D = Components.declare({ author: 't', id: 'd' }, '0')
  const ok1 = D.define({ state: () => 0, dispose: () => { disposed++ } })
  const boom: Factory = { manifest: { id: { author: 't', id: 'boom' }, version: '0', emits: [], consumes: [] }, create: async () => { throw new Error('boom') } }
  const s = Contexts.scope()
  await expect(s.add('c', Components.compose(meta('c'), c => ({ a: c.use('a', ok1), b: c.use('b', boom) })))).rejects.toThrow('boom')
  expect(disposed).toBe(1)
  expect(s.component('c')).toBeUndefined()
})

test('use(..., wrap): the parent derives a child context, and can pass calls through to the outside', async () => {
  const outer = Contexts.scope(), page = outer.context('page')
  const l = listener()
  await outer.add('out', l)                                            // a sibling of the composite, outside it
  const seen: string[] = []
  page.on(said, s => { seen.push(s) })
  const P = Components.declare({ author: 't', id: 'pinger' }, '0')
  const ping = P.action('ping', 'Call out', Type.String())
  const pinger = P.define({ state: () => null, actions: [[ping, (s, { ctx }) => ctx.call('out', hear, s)]] })

  const box = Components.compose(meta('box'), c => {
    c.use('s', speaker, ctx => ctx
      .withEmit(Emits.filter(e => e.payload !== 'SECRET'))
      .withEmit(Emits.map(e => ({ ...e, payload: String(e.payload).toUpperCase() }))))
    // pass-through: calls to 'out' go to the composite's own (outer) context
    c.use('p', pinger, (ctx, o) => ctx.withCall((call, next) => call.target === 'out' ? o.call(call.target, call.action, call.input as never) : next(call)))
    return {}
  })
  await outer.add('box', box)
  await page.call('box', say, 'hi')
  expect((await page.call('box', say, 'secret')).type).toBe('not-allowed')   // speaker returns its (filtered) emit
  expect(seen).toEqual(['HI'])
  expect((await page.call('box', ping, 'through')).type).toBe('success')
  expect(l.heard.at(-1)).toMatchObject({ s: 'through', from: 'box' })
})

test('a policy is just a wrapping container: a narrower manifest and a filtered context', async () => {
  const s = Contexts.scope(), page = s.context('page')
  await s.add('target', listener())
  const P = Components.declare({ author: 't', id: 'caller' }, '0')
  const go = P.action('go', 'Call target.add', Type.Number())
  const other = P.action('other', 'Not exposed', Type.Null())
  const caller = P.define({ state: () => null, actions: [[go, (n, { ctx }) => ctx.call('target', add, { a: n, b: n })], [other, () => {}]] })
  const sandboxed = Components.compose(meta('sandboxed'), c => {
    c.use('inner', caller, ctx => ctx.withCall(Calls.filter(() => false)))
    c.expose(go)
    return {}
  })
  await s.add('sb', sandboxed)
  expect(sandboxed.manifest.consumes.map(a => a.name)).toEqual(['t/caller/go'])
  expect((await page.call('sb', go, 1)).type).toBe('not-allowed')
  expect((await page.call('sb', other, null)).type).toBe('error')
})
