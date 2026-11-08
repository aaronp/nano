import { test, expect } from 'bun:test'
import Type from 'typebox'
import type { TSchema } from 'typebox'
import { unwrap, Calls, Components, Manifests, Notifications, Systems, fail, ok, type ComponentFactory, type Op, type SystemInstance, type SystemRuntime } from '../src'

const flush = () => new Promise(r => setTimeout(r, 0))
const meta = (id: string) => ({ id: { author: 't', id } })
/** Create an instance and register it: the owner's two steps. */
const add = async <F extends ComponentFactory<any>>(s: SystemRuntime, id: string, f: F) => { const c = await f.create(); s.register(id, c); return c as Awaited<ReturnType<F['create']>> }

const S = Components.declare({ author: 't', id: 'speaker' })
const said = S.op('said', 'Something was said', { output: Type.String() })
const say = S.op('say', 'Say something', { input: Type.String() })
const speaker = S.define({
  state: () => ({ count: 0 }),
  handlers: [[say, (s, { state, system }) => { state.count++; return system.notify(said, s) }]],
})

const L = Components.declare({ author: 't', id: 'listener' })
const hear = L.op('hear', 'Record something heard', { input: Type.String() })
const add2 = L.op('add', 'Add two numbers', { input: Type.Object({ a: Type.Number(), b: Type.Number() }), output: Type.Number() })
const listener = () => {
  const heard: { s: string; from: string; correlation: string }[] = []
  const f = L.define({
    state: () => heard,
    handlers: [
      [hear, (s, { inv }) => { heard.push({ s, from: inv.from, correlation: inv.correlation }) }],
      [add2, ({ a, b }) => a + b > 100 ? fail('handler', 'too big') : ok(a + b)],
    ],
  })
  return Object.assign(f, { heard })
}

const pair = (l = listener(), opts: { expose?: Op[]; wrapS?: (h: SystemInstance, outer: () => SystemInstance | undefined) => SystemInstance } = {}) =>
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
  const D = Components.declare({ author: 't', id: 'late' })
  const f = D.define({ state: () => null })
  D.op('late', 'too late', { output: Type.Null() })
  expect(f.manifest.ops).toEqual([])   // ops declared after define do not change the manifest
})

test('a defined component: handlers return a Result or nothing; the model notifies (all its Systems) and reports changes', async () => {
  const s = Systems.create(), page = unwrap(s.register('page', Components.party()))
  await add(s, 'l', listener())
  expect(await page.call('l', add2, { a: 1, b: 2 })).toEqual(ok(3))
  expect((await page.call('l', add2, { a: 100, b: 2 })).type).toBe('error')
  expect(await page.call('l', hear, 'x')).toEqual(ok(undefined))
  const model = await add(s, 's', speaker)
  let changes = 0
  const off = model.onChange(() => changes++)
  await page.call('s', say, 'a')
  expect((await model.notify(said, 'b')).type).toBe('success')
  off(); await page.call('s', say, 'c')
  expect([model.state.count, changes]).toEqual([2, 2])
})

test('added runs per System joined (what it returns runs on leaving); updated gets that System\'s deltas', async () => {
  const log: string[] = []
  const D = Components.declare({ author: 't', id: 'd' })
  const d = D.define({ state: () => null,
    added: s => { log.push(`join:${s.system.id}`); return () => { log.push(`leave:${s.system.id}`) } },
    updated: (delta, { system }) => { log.push(`${system.system.id}:${delta.type}`) } })
  const s1 = Systems.create({ id: 's1' }), s2 = Systems.create({ id: 's2' })
  const c = d.create()
  s1.register('d', c); s2.register('d', c)
  s1.register('other', Components.party())
  s1.unregister('d'); await c.dispose?.()
  expect(log).toEqual(['join:s1', 's1:manifest', 'join:s2', 's2:manifest', 's1:added', 's1:manifest', 'leave:s1', 'leave:s2'])
})

test('compose rejects mistakes at build time', () => {
  expect(() => Components.compose(meta('c'), c => ({ a: c.use('a', speaker), b: c.use('b', speaker) }))).toThrow('duplicate names t/speaker/said, t/speaker/say')
  expect(() => Components.compose(meta('c'), c => ({ a: c.use('a', speaker), b: c.use('a', listener()) }))).toThrow('duplicate child "a"')
  expect(() => Components.compose(meta('c'), c => { const l = c.use('l', listener()); c.route(l(said), l(hear)); return {} })).toThrow('"l" has no op t/speaker/said giving output')
  expect(() => Components.compose(meta('c'), c => { const s = c.use('s', speaker); c.route(s(said), s(hear)); return {} })).toThrow('"s" has no op')
  expect(() => pair(listener(), { expose: [{ name: 'zz', input: Type.Null() }] })).toThrow('expose: no child has zz')
  expect(Manifests.compose(meta('m').id, speaker.manifest, listener().manifest).ops.length).toBe(4)
})

test('a composite owns a System: delegates, routes inside, re-notifies exposed sources outside, hides its insides', async () => {
  const outer = Systems.create(), page = unwrap(outer.register('page', Components.party()))
  const l = listener()
  const p = await add(outer, 'pair', pair(l))
  const outside: { s: string; from: string; correlation: string }[] = []
  page.subscribe(said, (s, d) => { outside.push({ s, from: d.from, correlation: d.correlation }) })
  expect((await page.call('pair', say, 'hi')).type).toBe('success')
  await flush()
  expect(l.heard.map(h => [h.s, h.from])).toEqual([['hi', 's']])
  expect(outside.map(o => [o.s, o.from])).toEqual([['hi', 'pair']])
  expect(outside[0].correlation).toBe(l.heard[0].correlation)
  await page.call('pair', hear, 'delegated')
  expect(l.heard.at(-1)).toMatchObject({ s: 'delegated', from: '..' })   // the composite, inside its own System
  expect(page.system.instances.map(i => i.id)).toEqual(['page', 'pair'])
  expect(p.children.s.state.count).toBe(1)
})

test('expose hides internal wiring; two copies of one widget compose when their names are not exposed', async () => {
  const p = pair(listener(), { expose: [say] })
  expect(p.manifest.ops.map(o => o.name)).toEqual(['t/speaker/say'])
  const s = Systems.create(), page = unwrap(s.register('page', Components.party()))
  await add(s, 'pair', p)
  expect((await page.call('pair', hear, 'x')).type).toBe('error')
  const l = listener()
  const twin = Components.compose(meta('twin'), c => {
    const a = c.use('a', speaker), b = c.use('b', speaker), li = c.use('l', l)
    c.route(a(said), li(hear)); c.route(b(said), li(hear))
    c.expose(hear)
    return { a, b }
  })
  const t = await add(s, 'twin', twin)
  await t.children.b.notify(said, 'from b'); await flush()
  expect(l.heard.map(h => [h.s, h.from])).toEqual([['from b', 'b']])
})

test('a failing child disposes the ones already created', async () => {
  let disposed = 0
  const D = Components.declare({ author: 't', id: 'd' })
  const ok1 = D.define({ state: () => 0, dispose: () => { disposed++ } })
  const boom: ComponentFactory = { manifest: { id: { author: 't', id: 'boom' }, ops: [] }, create: async () => { throw new Error('boom') } }
  await expect(Components.compose(meta('c'), c => ({ a: c.use('a', ok1), b: c.use('b', boom) })).create()).rejects.toThrow('boom')
  expect(disposed).toBe(1)
})

test('a route the inner System refuses at create time rejects create and disposes the children', async () => {
  let disposed = 0
  const S = Components.declare({ author: 't', id: 'src' }), T = Components.declare({ author: 't', id: 'dst' })
  const out = S.op('out', 'out', { output: Type.String() }), inn = T.op('in', 'in', { input: Type.String() })
  const src = S.define({ state: () => 0, dispose: () => { disposed++ } })
  const dst = T.define({ state: () => 0, handlers: [[inn, () => {}]] })
  // dst's factory promises `in`, but the component it creates lacks it: only the live System can notice
  const liar: ComponentFactory = { manifest: dst.manifest, create: () => ({ ...dst.create(), manifest: { id: { author: 't', id: 'dst' }, ops: [] } }) }
  const bad = Components.compose(meta('bad'), c => { const a = c.use('a', src), b = c.use('b', liar); c.route(a(out), b(inn)); return { a, b } })
  await expect(bad.create()).rejects.toThrow('route: ')
  expect(disposed).toBe(1)
})

test('use(..., wrap): the parent derives a child handle, and can pass calls through to its own System', async () => {
  const outer = Systems.create(), page = unwrap(outer.register('page', Components.party()))
  const l = listener()
  await add(outer, 'out', l)
  const seen: string[] = []
  page.subscribe(said, s => { seen.push(s) })
  const P = Components.declare({ author: 't', id: 'pinger' })
  const ping = P.op('ping', 'Call out', { input: Type.String() })
  const pinger = P.define({ state: () => null, handlers: [[ping, (s, { system }) => system.call('out', hear, s)]] })
  const box = Components.compose(meta('box'), c => {
    c.use('s', speaker, h => h
      .withNotify(Notifications.filter(e => e.payload !== 'SECRET'))
      .withNotify(Notifications.map(e => ({ ...e, payload: String(e.payload).toUpperCase() }))))
    c.use('p', pinger, (h, o) => h.withCall((call, next) => call.target === 'out'
      ? o()!.within(call.correlation).call(call.target, call.op as Op<never>, call.input as never) : next(call)))
    return {}
  })
  await add(outer, 'box', box)
  await page.call('box', say, 'hi')
  expect((await page.call('box', say, 'secret')).type).toBe('not-allowed')
  expect(seen).toEqual(['HI'])
  expect((await page.call('box', ping, 'through')).type).toBe('success')
  expect(l.heard.at(-1)).toMatchObject({ s: 'through', from: 'box' })
})

test('a policy is just a wrapping container: a narrower manifest and a filtered handle', async () => {
  const s = Systems.create(), page = unwrap(s.register('page', Components.party()))
  await add(s, 'target', listener())
  const P = Components.declare({ author: 't', id: 'caller' })
  const go = P.op('go', 'Call target.add', { input: Type.Number() })
  const other = P.op('other', 'Not exposed', { input: Type.Null() })
  const caller = P.define({ state: () => null, handlers: [[go, (n, { system }) => system.call('target', add2, { a: n, b: n })], [other, () => {}]] })
  const sandboxed = Components.compose(meta('sandboxed'), c => {
    c.use('inner', caller, h => h.withCall(Calls.filter(() => false)))
    c.expose(go)
    return {}
  })
  await add(s, 'sb', sandboxed)
  expect(sandboxed.manifest.ops.map(o => o.name)).toEqual(['t/caller/go'])
  expect((await page.call('sb', go, 1)).type).toBe('not-allowed')
  expect((await page.call('sb', other, null)).type).toBe('error')
})

test('pipe exposes a chain as one action: A → B → C, failing fast, same correlation', async () => {
  const s = Systems.create(), page = unwrap(s.register('page', Components.party()))
  const D = Components.declare({ author: 't', id: 'double' })
  const dbl = D.op('double', 'n * 2', { input: Type.Number(), output: Type.Number() })
  const double = D.define({ state: () => null, handlers: [[dbl, n => n > 100 ? fail('handler', 'too big') : ok(n * 2)]] })
  const P = Components.declare({ author: 't', id: 'print' })
  const show = P.op('show', 'n → text', { input: Type.Number(), output: Type.String() })
  const print = P.define({ state: () => null, handlers: [[show, n => ok(`= ${n}`)]] })
  let quad!: Op
  const box = Components.compose(meta('box'), c => {
    const a = c.use('a', double), b = c.use('b', double), p = c.use('p', print)
    quad = c.pipe('quad', 'n * 4, as text', [a(dbl), b(dbl), p(show)])
    return {}
  })
  expect(box.manifest.ops.find(o => o.name === 't/box/quad')).toMatchObject({ input: Type.Number(), output: Type.String() })
  await add(s, 'box', box)
  expect(await page.call('box', quad as Op<TSchema>, 5)).toEqual(ok('= 20'))
  const r = await page.call('box', quad as Op<TSchema>, 60)          // second step fails: 120 > 100
  expect(r.type === 'error' && r.error.code).toBe('handler')
})

test('pipe is checked at build time', () => {
  expect(() => Components.compose(meta('c'), c => { const s = c.use('s', speaker); const l = c.use('l', listener()); c.pipe('p', 'p', [l(hear), s(say)]); return {} }))
    .toThrow('pipe p: step 0 (l t/listener/hear) gives no output')
  expect(() => Components.compose(meta('c'), c => { const l = c.use('l', listener()); c.pipe('p', 'p', [l(add2), l(hear)]); return {} }))
    .toThrow('pipe p: step 0 output does not fit step 1 input')
})

const pipeKit = () => {
  const calls = { last: 0 }, seen: string[] = []
  const T = Components.declare({ author: 't', id: 'step' })
  const inc = T.op('inc', 'n + 1', { input: Type.Number(), output: Type.Number() })
  const boom = T.op('boom', 'always fails', { input: Type.Number(), output: Type.Number() })
  const end = T.op('end', 'sink', { input: Type.Number() })
  const src = T.op('src', 'a source', { output: Type.Number() })
  const step = T.define({
    state: () => null,
    handlers: [
      [inc, (n, { inv }) => { seen.push(inv.correlation); return ok(n + 1) }],
      [boom, (_n, { inv }) => { seen.push(inv.correlation); return fail('handler', 'boom') }],
      [end, (_n, { inv }) => { calls.last++; seen.push(inv.correlation) }],
    ],
  })
  return { calls, seen, inc, boom, end, src, step }
}

test('pipe: a failing step stops the chain and its result comes back unchanged', async () => {
  const k = pipeKit(), s = Systems.create(), page = unwrap(s.register('page', Components.party()))
  let p!: Op
  await add(s, 'box', Components.compose(meta('box'), c => {
    const a = c.use('a', k.step), b = c.use('b', k.step), z = c.use('z', k.step)
    p = c.pipe('p', 'p', [a(k.inc), b(k.boom), z(k.end)]); return {}
  }))
  const r = await page.call('box', p as Op<TSchema>, 1)
  expect(r).toEqual(fail('handler', 'boom'))
  expect(k.calls.last).toBe(0)
})

test('pipe: a sink at the end gives success, and every step shares the call correlation', async () => {
  const k = pipeKit(), s = Systems.create(), page = unwrap(s.register('page', Components.party()))
  let p!: Op
  await add(s, 'box', Components.compose(meta('box'), c => {
    const a = c.use('a', k.step), b = c.use('b', k.step), z = c.use('z', k.step)
    p = c.pipe('p', 'p', [a(k.inc), b(k.inc), z(k.end)]); return {}
  }))
  expect(await page.call('box', p as Op<TSchema>, 1)).toEqual(ok(undefined))
  expect(k.calls.last).toBe(1)
  expect(k.seen.length).toBe(3)
  expect(new Set(k.seen).size).toBe(1)
})

test('pipe: more build errors', () => {
  const k = pipeKit()
  const build = (f: (c: Parameters<Parameters<typeof Components.compose>[1]>[0], a: ReturnType<typeof c0>) => void) =>
    () => Components.compose(meta('c'), c => { f(c, c.use('a', k.step) as never); return {} })
  const c0 = (_: never) => null as never
  expect(build((c, a: any) => c.pipe('p', 'p', [a(k.src), a(k.end)]))).toThrow('pipe p: step 0 (a t/step/src) takes no input')
  expect(build((c, a: any) => c.pipe('p', 'p', [a(k.src)]))).toThrow('takes no input')
  expect(build((c, a: any) => { c.pipe('p', 'p', [a(k.inc)]); c.pipe('p', 'p', [a(k.inc)]) })).toThrow('pipe p: duplicate pipe')
  expect(build((c) => c.pipe('p', 'p', []))).toThrow('pipe p: no steps')
  expect(build((c) => c.pipe('p', 'p', [{ child: 'nope', op: k.inc }]))).toThrow('pipe p: step 0 (nope t/step/inc) does not exist')
})
