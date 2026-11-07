import { test, expect } from 'bun:test'
import Type from 'typebox'
import { Calls, Components, Manifests, Publications, Scopes, fail, ok, type ComponentFactory, type Context, type Op } from '../src'

const flush = () => new Promise(r => setTimeout(r, 0))
const meta = (id: string) => ({ id: { author: 't', id } })

const S = Components.declare({ author: 't', id: 'speaker' })
const said = S.op('said', 'Something was said', { output: Type.String() })
const say = S.op('say', 'Say something', { input: Type.String() })
const speaker = S.define({
  state: () => ({ count: 0 }),
  handlers: [[say, (s, { state, ctx }) => { state.count++; return ctx.publish(said, s) }]],
})

const L = Components.declare({ author: 't', id: 'listener' })
const hear = L.op('hear', 'Record something heard', { input: Type.String() })
const add = L.op('add', 'Add two numbers', { input: Type.Object({ a: Type.Number(), b: Type.Number() }), output: Type.Number() })
const listener = () => {
  const heard: { s: string; from: string; correlation: string }[] = []
  const f = L.define({
    state: () => heard,
    handlers: [
      [hear, (s, { inv }) => { heard.push({ s, from: inv.from, correlation: inv.correlation }) }],
      [add, ({ a, b }) => a + b > 100 ? fail('handler', 'too big') : ok(a + b)],
    ],
  })
  return Object.assign(f, { heard })
}

const pair = (l = listener(), opts: { expose?: Op[]; wrapS?: (c: Context, outer: Context) => Context } = {}) =>
  Components.compose(meta('pair'), c => {
    const s = c.use('s', speaker, opts.wrapS), li = c.use('l', l)
    c.route(s(said), li(hear))
    if (opts.expose) c.expose(...opts.expose)
    return { s, l: li }
  })

test('declare names from the id and derives the manifest; define requires every handler', () => {
  expect(speaker.manifest).toMatchObject({ ops: [{ name: 't/speaker/said', description: 'Something was said' }, { name: 't/speaker/say' }] })
  const X = Components.declare({ author: 't', id: 'x' })
  X.op('a', 'unhandled', { input: Type.Null() })
  expect(() => X.define({ state: () => 0, handlers: [] })).toThrow('no handler for t/x/a')
})

test('handlers return a Result (typed call output) or nothing; the model notifies and publishes', async () => {
  const s = Scopes.create(), page = s.context('page')
  const l = listener(); await s.add('l', l)
  const r = await page.call('l', add, { a: 1, b: 2 })
  expect(r).toEqual(ok(3))
  expect((await page.call('l', add, { a: 100, b: 2 })).type).toBe('error')
  expect(await page.call('l', hear, 'x')).toEqual(ok(undefined))

  const model = await s.add('s', speaker)
  let changes = 0
  const off = model.onChange(() => changes++)
  await page.call('s', say, 'a')
  expect((await model.publish(said, 'b')).type).toBe('success')
  off(); await page.call('s', say, 'c')
  expect([model.state.count, changes]).toEqual([2, 2])
})

test('setup runs on create; what it returns runs on dispose', async () => {
  const log: string[] = []
  const D = Components.declare({ author: 't', id: 'd' })
  const d = D.define({ state: () => null, setup: () => { log.push('setup'); return () => { log.push('cleanup') } } })
  const s = Scopes.create()
  await s.add('d', d); await s.remove('d')
  expect(log).toEqual(['setup', 'cleanup'])
})

test('compose rejects mistakes at build time', () => {
  expect(() => Components.compose(meta('c'), c => ({ a: c.use('a', speaker), b: c.use('b', speaker) }))).toThrow('duplicate names t/speaker/said, t/speaker/say')
  expect(() => Components.compose(meta('c'), c => ({ a: c.use('a', speaker), b: c.use('a', listener()) }))).toThrow('duplicate child "a"')
  expect(() => Components.compose(meta('c'), c => { const l = c.use('l', listener()); c.route(l(said), l(hear)); return {} })).toThrow('"l" has no op t/speaker/said giving output')
  expect(() => Components.compose(meta('c'), c => { const s = c.use('s', speaker); c.route(s(said), s(hear)); return {} })).toThrow('"s" has no op')
  expect(() => pair(listener(), { expose: [{ name: 'zz', input: Type.Null() }] })).toThrow('expose: no child has zz')
  expect(Manifests.compose(meta('m').id, speaker.manifest, listener().manifest).ops.length).toBe(4)
})

test('a composite is just an instance: delegates, routes inside, re-publishes exposed publications, hides its insides', async () => {
  const outer = Scopes.create(), page = outer.context('page')
  const l = listener()
  const p = await outer.add('pair', pair(l))
  const outside: { s: string; from: string; correlation: string }[] = []
  page.subscribe(said, (s, d) => { outside.push({ s, from: d.from, correlation: d.correlation }) })

  expect((await page.call('pair', say, 'hi')).type).toBe('success')
  await flush()
  expect(l.heard.map(h => [h.s, h.from])).toEqual([['hi', 's']])       // inside: routed from the child
  expect(outside.map(o => [o.s, o.from])).toEqual([['hi', 'pair']])     // outside: the composite published it
  expect(outside[0].correlation).toBe(l.heard[0].correlation)            // one trigger, one correlation, both sides

  await page.call('pair', hear, 'delegated')
  expect(l.heard.at(-1)).toMatchObject({ s: 'delegated', from: 'pair' })

  expect(page.instances().map(i => i.name)).toEqual(['pair'])           // children are not visible outside
  expect((await page.call('s', say, 'x')).type).toBe('error')
  expect(p.children.s.state.count).toBe(1)
  await outer.remove('pair')
  expect((await p.children.s.publish(said, 'late')).type).toBe('error')
})

test('expose hides internal wiring; two copies of one widget compose when their names are not exposed', async () => {
  const p = pair(listener(), { expose: [say] })
  expect(p.manifest.ops.map(o => o.name)).toEqual(['t/speaker/say'])
  const s = Scopes.create(), page = s.context('page')
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
  await t.children.b.publish(said, 'from b'); await flush()
  expect(l.heard.map(h => [h.s, h.from])).toEqual([['from b', 'b']])
})

test('a failing child cleans up the ones already created', async () => {
  let disposed = 0
  const D = Components.declare({ author: 't', id: 'd' })
  const ok1 = D.define({ state: () => 0, setup: () => () => { disposed++ } })
  const boom: ComponentFactory = { manifest: { id: { author: 't', id: 'boom' } , ops: [] }, create: async () => { throw new Error('boom') } }
  const s = Scopes.create()
  await expect(s.add('c', Components.compose(meta('c'), c => ({ a: c.use('a', ok1), b: c.use('b', boom) })))).rejects.toThrow('boom')
  expect(disposed).toBe(1)
  expect(s.component('c')).toBeUndefined()
})

test('use(..., wrap): the parent derives a child context, and can pass calls through to the outside', async () => {
  const outer = Scopes.create(), page = outer.context('page')
  const l = listener()
  await outer.add('out', l)                                            // a sibling of the composite, outside it
  const seen: string[] = []
  page.subscribe(said, s => { seen.push(s) })
  const P = Components.declare({ author: 't', id: 'pinger' })
  const ping = P.op('ping', 'Call out', { input: Type.String() })
  const pinger = P.define({ state: () => null, handlers: [[ping, (s, { ctx }) => ctx.call('out', hear, s)]] })

  const box = Components.compose(meta('box'), c => {
    c.use('s', speaker, ctx => ctx
      .withPublish(Publications.filter(e => e.payload !== 'SECRET'))
      .withPublish(Publications.map(e => ({ ...e, payload: String(e.payload).toUpperCase() }))))
    // pass-through: calls to 'out' go to the composite's own (outer) context
    c.use('p', pinger, (ctx, o) => ctx.withCall((call, next) => call.target === 'out' ? o.within(call.correlation).call(call.target, call.op as Op<never>, call.input as never) : next(call)))
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
  const s = Scopes.create(), page = s.context('page')
  await s.add('target', listener())
  const P = Components.declare({ author: 't', id: 'caller' })
  const go = P.op('go', 'Call target.add', { input: Type.Number() })
  const other = P.op('other', 'Not exposed', { input: Type.Null() })
  const caller = P.define({ state: () => null, handlers: [[go, (n, { ctx }) => ctx.call('target', add, { a: n, b: n })], [other, () => {}]] })
  const sandboxed = Components.compose(meta('sandboxed'), c => {
    c.use('inner', caller, ctx => ctx.withCall(Calls.filter(() => false)))
    c.expose(go)
    return {}
  })
  await s.add('sb', sandboxed)
  expect(sandboxed.manifest.ops.map(o => o.name)).toEqual(['t/caller/go'])
  expect((await page.call('sb', go, 1)).type).toBe('not-allowed')
  expect((await page.call('sb', other, null)).type).toBe('error')
})
