import { test, expect } from 'bun:test'
import Type from 'typebox'
import { Calls, Components, Notifications, Subscriptions, Systems, fail, ok, type SystemDelta, type SystemError, type SystemInstance, type Trace } from '../src'

const flush = (ms = 0) => new Promise(r => setTimeout(r, ms))
const setup = (opts: { budget?: number; burst?: number; id?: string } = {}) => {
  const errors: SystemError[] = []
  const s = Systems.create({ ...opts, onError: e => errors.push(e) })
  return { s, errors, page: s.register('page', Components.party()) }
}

// A test component: notifies `fired`, echoes `log`, checks `typed`; records what reached it and its deltas.
const X = Components.declare({ author: 't', id: 'x' })
const fired = X.op('fired', 'fired', { output: Type.Object({ text: Type.String() }) })
const log = X.op('log', 'echo the input', { input: Type.Unknown(), output: Type.Unknown() })
const typed = X.op('typed', 'n → n', { input: Type.Object({ n: Type.Number() }), output: Type.Number() })
const x = () => {
  const got: { input: unknown; from: string; correlation: string; system: string }[] = []
  const deltas: string[] = []
  const f = X.define({
    state: () => null,
    updated: d => { deltas.push(describe(d)) },
    handlers: [
      [log, (input, { inv }) => { got.push({ input, from: inv.from, correlation: inv.correlation, system: inv.system }); return ok(input) }],
      [typed, ({ n }) => n < 0 ? fail('handler', 'negative') : n === 13 ? ok('bad' as unknown as number) : ok(n)],
    ],
  })
  const c = f.create()
  return Object.assign(c, { got, deltas, h: (sys: string) => c.systems.find(s => s.system.id === sys)! })
}
const describe = (d: SystemDelta) => d.type === 'manifest' ? `manifest:${d.manifest.map(m => m.id.id).join(',')}`
  : d.type === 'subscription-opened' || d.type === 'subscription-closed' ? `${d.type}:${d.subscriptions.map(s => s.listener).join(',')}`
  : `${d.type}:${d.instances.map(i => i.id).join(',')}`

test('register: the newcomer gets its handle first, the others get "added", and "manifest" when a type appears', () => {
  const { s } = setup({ id: 's1' })
  const a = x(), b = x()
  // call out our method under test
  s.register('a', a)
  s.register('b', b)                    // same component type: no manifest change
  expect(a.systems.map(h => [h.system.id, h.instanceId])).toEqual([['s1', 'a']])
  expect(a.deltas).toEqual(['manifest:party,x', 'added:b'])   // a's own arrival brought type x
  expect(s.snapshot().manifest.map(m => m.id.id)).toEqual(['party', 'x'])
  s.unregister('a')
  expect(b.deltas).toEqual(['removed:a'])  // b is still there: type x remains
  s.unregister('b')
  expect(a.systems).toEqual([])            // unregistering never disposes; the owner does
  expect(() => s.register('page', x())).toThrow('already has an instance page')
})

test('one instance in two Systems is a bridge: it chooses where to notify, and is callable from both', async () => {
  const s1 = setup({ id: 's1' }), s2 = setup({ id: 's2' })
  const c = x()
  s1.s.register('c', c); s2.s.register('c', c)
  const heard: string[] = []
  s1.page.subscribe(fired, (p, d) => { heard.push(`s1:${p.text}:${d.system}`) })
  s2.page.subscribe(fired, (p, d) => { heard.push(`s2:${p.text}:${d.system}`) })
  // call out our methods under test: notify through each handle separately, then through all (define's choice)
  await c.h('s1').notify(fired, { text: 'only-1' })
  await c.h('s2').notify(fired, { text: 'only-2' })
  await c.notify(fired, { text: 'both' })
  expect(heard).toEqual(['s1:only-1:s1', 's2:only-2:s2', 's1:both:s1', 's2:both:s2'])
  await s1.page.call('c', log, 'from 1'); await s2.page.call('c', log, 'from 2')
  expect(c.got.map(g => `${g.system}:${g.input}`)).toEqual(['s1:from 1', 's2:from 2'])
})

test('notify delivers synchronously in subscription order; nested notifications are queued FIFO', async () => {
  const { s, page } = setup()
  const a = x(), b = x()
  s.register('a', a); s.register('b', b)
  const order: string[] = []
  page.subscribe(fired, p => { order.push(`1:${p.text}`); if (p.text === 'first') void b.notify(fired, { text: 'nested' }) })
  page.subscribe(fired, p => { order.push(`2:${p.text}`) })
  expect((await a.notify(fired, { text: 'first' })).type).toBe('success')
  expect(order).toEqual(['1:first', '2:first', '1:nested', '2:nested'])
})

test('correlation: a kept handle starts one per operation; handler and delivery handles carry theirs', async () => {
  const { s } = setup()
  const a = x(), b = x()
  const ha = s.register('a', a), hb = s.register('b', b)
  const seen: string[] = []
  hb.subscribe(fired, (_p, d) => { seen.push(d.correlation); void d.handle.call('a', log, 'reply') }, { from: 'a' })
  await ha.notify(fired, { text: '1' }); await ha.notify(fired, { text: '2' }); await flush()
  expect(seen[0]).not.toBe(seen[1])
  expect(a.got.map(g => g.correlation)).toEqual(seen)
  expect(ha.correlation).toBeUndefined()
})

test('validation: undeclared op, bad payload, a party without ops; call input and output', async () => {
  const { s, page } = setup()
  const a = x(); s.register('a', a)
  // @ts-expect-error runtime validation is what's under test
  const bad = await a.notify(fired, { text: 1 })
  expect(bad.type === 'error' && bad.error.code).toBe('validation')
  expect((await page.notify(fired, { text: 'x' })).type).toBe('error')
  const code = async (p: Promise<{ type: string; error?: { code: string } }>) => { const v = await p; return v.type === 'error' ? v.error!.code : v.type }
  expect(await code(page.call('a', typed, { n: 2 }))).toBe('success')
  expect(await code(page.call('a', typed, { n: 'x' as never }))).toBe('validation')
  expect(await code(page.call('a', typed, { n: 13 }))).toBe('validation')
  expect(await code(page.call('a', typed, { n: -1 }))).toBe('handler')
  expect(await code(page.call('nope', log, 1))).toBe('unknown-target')
  expect(await code(page.call('a', { name: 'zz', input: Type.Unknown() }, 1))).toBe('unknown-action')
  // a party given a source op can notify it
  const host = s.register('host', Components.party({ author: 't', id: 'host' }, [fired]))
  expect((await host.notify(fired, { text: 'from host' })).type).toBe('success')
})

test('subscribe (a link): an output (notification or action outcome) feeds an op, with via and the same correlation', async () => {
  const { s, page, errors } = setup()
  const a = x(), b = x()
  s.register('a', a); s.register('b', b)
  const link = (op: string) => s.subscribe({ source: 'a', op, listener: 'b', target: log.name })
  const first = link(fired.name)
  link(typed.name)                                                  // an action's outcome
  await a.notify(fired, { text: 'hi' }); await page.call('a', typed, { n: 7 }); await flush()
  expect(b.got.map(g => [g.input, g.from])).toEqual([[{ text: 'hi' }, 'a'], [7, 'a']])
  expect(s.snapshot().subscriptions.map(l => l.op.split('/').pop())).toEqual(['fired', 'typed'])
  expect(first.type === 'success' && s.unsubscribe(first.data.id)).toEqual(ok(undefined))
  expect(s.snapshot().subscriptions.length).toBe(1)
  expect(errors).toEqual([])
})

test('bind / use: a dependency is served by whatever it is bound to; unbound is unavailable', async () => {
  const shape = { input: Type.String(), output: Type.String() }
  const G = Components.declare({ author: 't', id: 'greeter' })
  const upper = G.dependency('upper', 'uppercase', { op: { name: 'any', ...shape } })
  const greet = G.op('greet', 'greet', { input: Type.String(), output: Type.String(), requires: [upper] })
  const greeter = G.define({ state: () => null, handlers: [[greet, async (name, { deps }) => {
    const r = await deps.upper(name); return r.type === 'success' ? ok(`HELLO ${r.data}`) : r
  }]] }).create()
  const U = Components.declare({ author: 'lib', id: 'upper' })
  const up = U.op('to-upper', 'uppercase', shape)
  const upperLib = U.define({ state: () => null, handlers: [[up, s => ok(s.toUpperCase())]] }).create()
  const { s, page } = setup()
  s.register('greeter', greeter); s.register('up', upperLib)
  // call out our methods under test
  const unbound = await page.call('greeter', greet, 'ada')
  expect(unbound.type === 'error' && unbound.error.code).toBe('unavailable')
  s.register('x', x())
  expect(() => s.bind('greeter', 'upper', 'x', typed)).toThrow('does not have the shape')
  const unbind = s.bind('greeter', 'upper', 'up', up)
  expect(await page.call('greeter', greet, 'ada')).toEqual(ok('HELLO ADA'))
  expect(s.bindings()).toEqual([{ from: 'greeter', dependency: 'upper', to: 'up', op: up.name }])
  unbind()
  expect((await page.call('greeter', greet, 'ada')).type).toBe('error')
  s.bind('greeter', 'upper', 'up', up); s.unregister('up')
  expect(s.bindings()).toEqual([])
})

test('loops: over budget per correlation (even through async wrappers), and the burst backstop', async () => {
  const { s, errors } = setup({ budget: 50 })
  const a = x(), b = x()
  const ha = s.register('a', a, { wrap: h => h.withNotify((n, next) => next(n)) }), hb = s.register('b', b)
  ha.subscribe(fired, (p, d) => d.handle.notify(fired, p), { from: 'b' })
  hb.subscribe(fired, (p, d) => d.handle.notify(fired, p), { from: 'a' })
  await ha.notify(fired, { text: 'ping' })
  for (let i = 0; i < 100; i++) await flush()
  expect(errors.map(e => e.code)).toEqual(['loop'])
  const t2 = setup({ burst: 200 })
  const c = x(); const hc = t2.s.register('c', c)
  hc.subscribe(fired, p => { void hc.notify(fired, p) }, { from: 'c' })   // a kept handle: a new correlation each hop
  await hc.notify(fired, { text: 'spin' })
  expect(t2.errors.map(e => e.message)).toEqual(['more than 200 operations before the event loop was idle'])
})

test('unregister: its handles go dead, its subscriptions, links and bindings go, even if the id is reused', async () => {
  const { s, page } = setup()
  const a = x(), b = x()
  const ha = s.register('a', a); s.register('b', b)
  s.subscribe({ source: 'a', op: fired.name, listener: 'b', target: log.name })
  s.unregister('a')
  expect((await ha.notify(fired, { text: 'x' })).type).toBe('error')
  expect(s.snapshot().subscriptions).toEqual([])
  s.register('a', x())
  expect((await ha.notify(fired, { text: 'x' })).type).toBe('error')
  expect(page.system.instances.map(i => i.id)).toEqual(['page', 'b', 'a'])
})

test('observe traces every operation; muting is not built in, it is a wrapper you write', async () => {
  const { s, page } = setup()
  const a = x(), b = x()
  let muted = false
  const mute = (h: SystemInstance) => h.withNotify((n, next) => muted ? Promise.resolve({ type: 'not-allowed', reason: 'muted' }) : next(n))
  s.register('a', a, { wrap: mute }); s.register('b', b)
  s.subscribe({ source: 'a', op: fired.name, listener: 'b', target: log.name })
  const traces: Trace[] = []
  s.observe(t => traces.push(t))
  await a.notify(fired, { text: 'hi' }); await flush()
  expect(traces.map(t => `${t.kind}:${t.from}->${t.to ?? ''}`)).toEqual(['notify:a->', 'deliver:a->b', 'call:a->b'])
  muted = true
  expect(await a.notify(fired, { text: 'quiet' })).toEqual({ type: 'not-allowed', reason: 'muted' })
  await flush()
  expect(b.got.length).toBe(1)
  void page
})

test('wrappers: Notifications (filter/map/trace, last added runs first), debounce, Calls, Subscriptions, throwing wrapper', async () => {
  const { s, page } = setup()
  let open = false
  const traced: string[] = []
  const a = x()
  s.register('a', a, { wrap: h => h
    .withNotify(Notifications.trace((e, r) => traced.push(`${(e.payload as any).text}:${r.type}`)))
    .withNotify(Notifications.filter(() => open))
    .withNotify(Notifications.map(e => ({ ...e, payload: { text: (e.payload as any).text.toUpperCase() } })))
    .withCall(Calls.filter(c => c.target !== 'secret'))
    .withSubscribe(Subscriptions.filter(sub => sub.op.name !== typed.name)) })
  const got: string[] = []
  page.subscribe(fired, p => { got.push(p.text) })
  expect(await a.notify(fired, { text: 'x' })).toEqual({ type: 'not-allowed', reason: 'filtered' })
  open = true
  await a.notify(fired, { text: 'y' })
  expect(got).toEqual(['Y']); expect(traced).toEqual(['Y:success'])
  expect((await a.h(s.id).call('secret', log, 1)).type).toBe('not-allowed')
  const b = x(); s.register('b', b, { wrap: h => h.withNotify(Notifications.debounce(5)) })
  for (const t of ['1', '2', '3']) await b.notify(fired, { text: t })
  await flush(15)
  expect(got).toEqual(['Y', '3'])
  const c = x(); s.register('c', c, { wrap: h => h.withNotify(() => { throw new Error('nope') }) })
  const r = await c.notify(fired, { text: 'x' })
  expect(r.type === 'error' && r.error.code).toBe('handler')
})

test('types: handlers must return their op\'s output; only sources can be notified', () => {
  const T = Components.declare({ author: 't', id: 'types' })
  const n = T.op('n', 'n', { input: Type.Null(), output: Type.Number() })
  const sink = T.op('sink', 'sink', { input: Type.Number() })
  // @ts-expect-error the handler returns a string for a number output
  T.define({ state: () => null, handlers: [[n, () => ok('nope')], [sink, () => {}]] })
  const check = (h: SystemInstance) => {
    // @ts-expect-error a sink is not a source
    void h.notify(sink, 1)
  }
  void check
})

test('subscriptions are data: both kinds listed, opened and closed as deltas for everyone', async () => {
  const { s, page } = setup({ id: 's1' })
  const a = x(), b = x(), watcher = x()
  s.register('a', a); s.register('b', b); s.register('w', watcher)
  const r = s.subscribe({ source: 'a', op: fired.name, listener: 'b', target: log.name })
  expect(r).toEqual(ok({ id: 's1:s1', source: 'a', op: fired.name, listener: 'b', target: log.name }))
  const off = page.subscribe(fired, () => {}, { from: 'a' })
  expect(s.snapshot().subscriptions.map(x => [x.listener, x.target])).toEqual([['b', log.name], ['page', undefined]])
  expect(watcher.deltas).toContain(`subscription-opened:b`)   // describe() prints listeners for subscription deltas
  off()
  expect(watcher.deltas.at(-1)).toBe('subscription-closed:page')
  await a.notify(fired, { text: 'hi' }); await flush()
  expect(b.got.map(g => g.input)).toEqual([{ text: 'hi' }])
  expect(s.unsubscribe('s1:s1')).toEqual(ok(undefined))
  expect(s.unsubscribe('nope').type).toBe('error')
})

test('unregistering an instance closes all its subscriptions, as listener and as source, in one delta', () => {
  const { s } = setup({ id: 's1' })
  const a = x(), b = x(), c = x(), watcher = x()
  s.register('a', a); s.register('b', b); s.register('c', c); s.register('w', watcher)
  s.subscribe({ source: 'a', op: fired.name, listener: 'b', target: log.name })
  s.subscribe({ source: 'b', op: fired.name, listener: 'c', target: log.name })
  s.subscribe({ source: '*', op: fired.name, listener: 'c', target: log.name })
  s.unregister('b')
  expect(watcher.deltas.filter(d => d.startsWith('subscription-closed'))).toEqual(['subscription-closed:b,c'])
  expect(s.snapshot().subscriptions.map(x => `${x.source}->${x.listener}`)).toEqual(['*->c'])
})

test('subscribe validates: unknown instances or ops that do not fit are errors, not throws', () => {
  const { s } = setup()
  s.register('a', x()); s.register('b', x())
  expect(s.subscribe({ source: 'a', op: fired.name, listener: 'nope', target: log.name }).type).toBe('error')
  expect(s.subscribe({ source: 'a', op: log.name + 'x', listener: 'b', target: log.name }).type).toBe('error')
  expect(s.subscribe({ source: 'a', op: fired.name, listener: 'b', target: fired.name }).type).toBe('error')
})
