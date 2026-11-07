import { test, expect } from 'bun:test'
import Type from 'typebox'
import { Calls, Components, Publications, Scopes, Subscriptions, fail, ok, type ComponentFactory, type Context, type ErrorInfo, type SystemError, type Trace } from '../src'

const flush = (ms = 0) => new Promise(r => setTimeout(r, ms))
const setup = (opts: { budget?: number; burst?: number } = {}) => {
  const errors: { e: SystemError; info: ErrorInfo }[] = []
  const s = Scopes.create({ ...opts, onError: (e, info) => errors.push({ e, info }) })
  return { s, errors, page: s.context('page') }
}

// A component that hands out its contexts and answers `log` with its input.
const X = Components.declare({ author: 't', id: 'x' })
const fired = X.op('fired', 'fired', { output: Type.Object({ text: Type.String() }) })
const log = X.op('log', 'echo the input', { input: Type.Unknown(), output: Type.Unknown() })
const typed = X.op('typed', 'n → n', { input: Type.Object({ n: Type.Number() }), output: Type.Number() })
const x = () => {
  const got: { input: unknown; from: string; correlation: string }[] = []
  const c = { app: undefined as unknown as Context, mount: undefined as unknown as Context }
  const f = X.define({
    state: () => null,
    setup: ({ appContext, mountContext }) => { c.app = appContext; c.mount = mountContext },
    handlers: [
      [log, (input, { inv }) => { got.push({ input, from: inv.from, correlation: inv.correlation }); return ok(input) }],
      [typed, ({ n }) => n < 0 ? fail('handler', 'negative') : n === 13 ? ok('bad' as unknown as number) : ok(n)],
    ],
  })
  return Object.assign(f, { got, ctx: () => c.app, mount: () => c.mount })
}

test('publish delivers synchronously, in subscription order; nested publishes are queued FIFO', async () => {
  const { s, page } = setup()
  const a = x(), b = x()
  await s.add('a', a); await s.add('b', b)
  const order: string[] = []
  page.subscribe(fired, p => { order.push(`1:${p.text}`); if (p.text === 'first') void b.ctx().publish(fired, { text: 'nested' }) })
  page.subscribe(fired, p => { order.push(`2:${p.text}`) })
  expect((await a.ctx().publish(fired, { text: 'first' })).type).toBe('success')
  expect(order).toEqual(['1:first', '2:first', '1:nested', '2:nested'])
})

test('correlation: app contexts start one per operation; handler and delivery contexts carry theirs', async () => {
  const { s, page } = setup()
  const a = x(), b = x()
  await s.add('a', a); await s.add('b', b)
  const seen: string[] = []
  b.ctx().subscribe(fired, (_p, d) => { seen.push(d.correlation); void d.ctx.call('a', log, 'reply') }, { from: 'a' })
  await a.ctx().publish(fired, { text: '1' })
  await a.ctx().publish(fired, { text: '2' })
  await flush()
  expect(seen[0]).not.toBe(seen[1])                                    // two triggers, two correlations
  expect(a.got.map(g => g.correlation)).toEqual(seen)                  // the replies carried them
  expect(a.ctx().correlation).toBeUndefined()
  await page.call('a', log, 'direct')
  expect(a.got.at(-1)!.from).toBe('page')
})

test('setup: mountContext carries the mount correlation and can publish during setup', async () => {
  const { s, page } = setup()
  const M = Components.declare({ author: 't', id: 'm' })
  const hello = M.op('hello', 'announced on mount', { output: Type.Object({ text: Type.String() }) })
  const m = M.define({ state: () => null, setup: ({ mountContext }) => { void mountContext.publish(hello, { text: 'hi' }) } })
  const got: string[] = []
  page.subscribe(hello, (_p, d) => { got.push(d.correlation) })
  await s.add('m', m, { correlation: 'boot-1' })
  expect(got).toEqual(['boot-1'])
})

test('validation: publish of an undeclared op, bad payload, a party without a manifest; call input and output', async () => {
  const { s, page } = setup()
  const a = x(); await s.add('a', a)
  // @ts-expect-error runtime validation is what's under test
  const bad = await a.ctx().publish(fired, { text: 1 })
  expect(bad.type === 'error' && bad.error.code).toBe('validation')
  expect((await a.ctx().publish({ name: 'nope', output: Type.Unknown() }, {})).type).toBe('error')
  expect((await page.publish(fired, { text: 'x' })).type).toBe('error')
  const code = async (p: Promise<{ type: string; error?: { code: string } }>) => { const v = await p; return v.type === 'error' ? v.error!.code : v.type }
  expect(await code(page.call('a', typed, { n: 2 }))).toBe('success')
  expect(await code(page.call('a', typed, { n: 'x' as never }))).toBe('validation')
  expect(await code(page.call('a', typed, { n: 13 }))).toBe('validation')     // output
  expect(await code(page.call('a', typed, { n: -1 }))).toBe('handler')        // returned error
  expect(await code(page.call('nope', log, 1))).toBe('unknown-target')
  expect(await code(page.call('a', { name: 'zz', input: Type.Unknown() }, 1))).toBe('unknown-action')
  const thrower: ComponentFactory = { manifest: { id: { author: 't', id: 'th' }, ops: [log] }, create: () => ({ onAction: () => { throw new Error('boom') } }) }
  await s.add('th', thrower)
  expect(await code(page.call('th', log, 1))).toBe('handler')
  // A party can publish what its manifest declares.
  const host = s.context('host', { id: { author: 't', id: 'host' }, ops: [fired] })
  expect((await host.publish(fired, { text: 'from host' })).type).toBe('success')
})

test('route: validated when made; feeds the op with the publisher as sender and the same correlation', async () => {
  const { s, errors } = setup()
  const a = x(), b = x()
  await s.add('a', a); await s.add('b', b)
  expect(() => s.route('a', fired, 'missing', log)).toThrow('route: no instance "missing"')
  expect(() => s.route('a', { name: 't/x/nope', output: Type.Unknown() }, 'b', log)).toThrow('"a" has no op t/x/nope giving output')
  expect(() => s.route('a', fired, 'b', fired)).toThrow('"b" has no op')
  const unroute = s.route('a', fired, 'b', log)
  await a.ctx().publish(fired, { text: 'hi' }); await flush()
  expect(b.got.map(g => [g.input, g.from])).toEqual([[{ text: 'hi' }, 'a']])
  unroute()
  await a.ctx().publish(fired, { text: 'again' }); await flush()
  expect(b.got.length).toBe(1)
  expect(errors).toEqual([])
})

test('a long route pipeline is not mistaken for a loop', async () => {
  const { s, errors } = setup()
  const P = Components.declare({ author: 't', id: 'stage' })
  const into = P.op('in', 'in', { input: Type.Number() }), out = P.op('out', 'out', { output: Type.Number() })
  const stage = P.define({ state: () => null, handlers: [[into, (n, { ctx }) => ctx.publish(out, n + 1)]] })
  for (let i = 0; i < 20; i++) await s.add(`s${i}`, stage)
  for (let i = 0; i < 19; i++) s.route(`s${i}`, out, `s${i + 1}`, into)
  let last = -1
  s.context('end').subscribe(out, n => { last = n }, { from: 's19' })
  await s.context('kick').call('s0', into, 0)
  for (let i = 0; i < 60; i++) await flush()
  expect(last).toBe(20); expect(errors).toEqual([])
})

test('loops: a correlation over budget is dropped and reported once, even through async wrappers', async () => {
  const { s, errors } = setup({ budget: 50 })
  const a = x(), b = x()
  await s.add('a', a, { wrap: c => c.withPublish((p, next) => next(p)) })   // async publish
  await s.add('b', b)
  a.ctx().subscribe(fired, (p, d) => d.ctx.publish(fired, p), { from: 'b' })
  b.ctx().subscribe(fired, (p, d) => d.ctx.publish(fired, p), { from: 'a' })
  await a.ctx().publish(fired, { text: 'ping' })
  for (let i = 0; i < 100; i++) await flush()
  expect(errors.map(e => e.e.code)).toEqual(['loop'])
  expect(errors[0].e.message).toContain('exceeded 50 operations')
})

test('loops: the burst backstop stops one that starts a new correlation every hop', async () => {
  const { s, errors } = setup({ burst: 200 })
  const a = x()
  await s.add('a', a)
  a.ctx().subscribe(fired, p => { void a.ctx().publish(fired, p) }, { from: 'a' })    // the wrong context
  await a.ctx().publish(fired, { text: 'spin' })
  expect(errors.map(e => e.e.message)).toEqual(['more than 200 operations before the event loop was idle'])
})

test('observe sees every operation; mute refuses an instance both ways', async () => {
  const { s, page } = setup()
  const a = x(), b = x()
  await s.add('a', a); await s.add('b', b)
  s.route('a', fired, 'b', log)
  const traces: Trace[] = []
  const off = s.observe(t => traces.push(t))
  await a.ctx().publish(fired, { text: 'hi' }); await flush()
  expect(traces.map(t => `${t.kind}:${t.from}->${t.to ?? ''}`)).toEqual(['publish:a->', 'deliver:a->b', 'call:a->b'])
  expect(new Set(traces.map(t => t.correlation)).size).toBe(1)

  traces.length = 0
  s.mute('b')
  expect(await page.call('b', log, 1)).toEqual({ type: 'not-allowed', reason: 'muted' })
  expect(await b.ctx().publish(fired, { text: 'x' })).toEqual({ type: 'not-allowed', reason: 'muted' })
  await a.ctx().publish(fired, { text: 'to muted b' }); await flush()
  expect(b.got.length).toBe(1)
  expect(traces.filter(t => t.kind === 'drop').map(t => t.reason)).toEqual(['muted', 'muted', 'muted'])
  s.mute('b', false)
  await page.call('b', log, 2)
  expect(b.got.length).toBe(2)
  off()
})

test('remove: disposes, drops subscriptions; a removed context goes dead even if the name is reused', async () => {
  const { s, page } = setup()
  const heard: string[] = []
  const D = Components.declare({ author: 't', id: 'd' })
  const d = D.define({ state: () => null, setup: ({ appContext }) => { appContext.subscribe(fired, p => { heard.push(p.text) }); return () => { heard.push('disposed') } } })
  const a = x(); await s.add('a', a); await s.add('d', d)
  const zombie = a.ctx()
  await s.remove('d'); await s.remove('a')
  expect((await zombie.publish(fired, { text: 'x' })).type).toBe('error')
  const a2 = x(); await s.add('a', a2)
  expect((await zombie.publish(fired, { text: 'x' })).type).toBe('error')
  await a2.ctx().publish(fired, { text: 'y' })
  expect(heard).toEqual(['disposed'])
  expect(page.instances().map(i => i.name)).toEqual(['a'])
})

test('races and teardown: remove during create, a throwing dispose, duplicate names, party name spoofing', async () => {
  const { s, errors } = setup()
  let disposed = 0
  let release!: () => void
  const slow: ComponentFactory = {
    manifest: { id: { author: 't', id: 'slow' }, ops: [] },
    create: () => new Promise(r => { release = () => r({ onAction: async () => ok(null), dispose: () => { disposed++ } }) }),
  }
  const adding = s.add('slow', slow)
  await s.remove('slow'); release()
  await expect(adding).rejects.toThrow('removed while being created')
  expect(disposed).toBe(1); expect(s.component('slow')).toBeUndefined()

  const T = Components.declare({ author: 't', id: 'thrower' })
  const thrower = T.define({ state: () => null, setup: () => () => { throw new Error('bad dispose') } })
  await s.add('t', thrower); await s.add('after', x())
  await s.clear()
  expect(s.component('after')).toBeUndefined()
  expect(errors.map(e => e.e.message)).toEqual(['bad dispose'])

  const r = await Promise.allSettled([s.add('a', x()), s.add('a', x())])
  expect(r.map(v => v.status).sort()).toEqual(['fulfilled', 'rejected'])
  expect(() => s.context('a')).toThrow('a party cannot take its name')
})

test('a hand-built context from wrap works (no hidden identity)', async () => {
  const { s, page } = setup()
  await s.add('a', x(), { wrap: c => ({ ...c }) })
  expect(await page.call('a', log, 'ok')).toEqual(ok('ok'))
})

test('declaring an op after define does not change the manifest', () => {
  const D = Components.declare({ author: 't', id: 'late' })
  const f = D.define({ state: () => null })
  D.op('late', 'too late', { output: Type.Null() })
  expect(f.manifest.ops).toEqual([])
})

test('wrappers: Publications (filter/map/trace, last added runs first), debounce, Calls, Subscriptions, throwing wrapper', async () => {
  const { s, page } = setup()
  let open = false
  const traced: string[] = []
  const a = x()
  await s.add('a', a, { wrap: c => c
    .withPublish(Publications.trace((e, r) => traced.push(`${(e.payload as any).text}:${r.type}`)))
    .withPublish(Publications.filter(() => open))
    .withPublish(Publications.map(e => ({ ...e, payload: { text: (e.payload as any).text.toUpperCase() } })))
    .withCall(Calls.filter(c => c.target !== 'secret'))
    .withSubscribe(Subscriptions.filter(sub => sub.op.name !== typed.name)) })
  const got: string[] = []
  page.subscribe(fired, p => { got.push(p.text) })
  expect(await a.ctx().publish(fired, { text: 'x' })).toEqual({ type: 'not-allowed', reason: 'filtered' })
  open = true
  await a.ctx().publish(fired, { text: 'y' })
  expect(got).toEqual(['Y']); expect(traced).toEqual(['Y:success'])
  expect((await a.ctx().call('secret', log, 1)).type).toBe('not-allowed')

  const b = x()
  await s.add('b', b, { wrap: c => c.withPublish(Publications.debounce(5)) })
  for (const t of ['1', '2', '3']) await b.ctx().publish(fired, { text: t })
  await flush(15)
  expect(got).toEqual(['Y', '3'])

  const c = x()
  await s.add('c', c, { wrap: ctx => ctx.withPublish(() => { throw new Error('nope') }) })
  const r = await c.ctx().publish(fired, { text: 'x' })
  expect(r.type === 'error' && r.error.code).toBe('handler')
})

test('types: handlers must return their op\'s output; only publications can be published', () => {
  const T = Components.declare({ author: 't', id: 'types' })
  const n = T.op('n', 'n', { input: Type.Null(), output: Type.Number() })
  const sub = T.op('sub', 'sub', { input: Type.Number() })
  // @ts-expect-error the handler returns a string for a number output
  T.define({ state: () => null, handlers: [[n, () => ok('nope')], [sub, () => {}]] })
  const check = (ctx: Context) => {
    // @ts-expect-error a subscription is not a publication
    void ctx.publish(sub, 1)
  }
  void check
})

test('an action\'s outcome is a source: routed and subscribed like a publication; scope.routes() shows what is wired', async () => {
  // setup: a's `typed` action feeds b's `log`
  const { s, page } = setup()
  const a = x(), b = x()
  await s.add('a', a); await s.add('b', b)
  const off = s.route('a', typed, 'b', log)
  const seen: unknown[] = []
  page.subscribe(typed, (n, d) => { seen.push([n, d.from]) })
  // call out our method under test: a plain call of the action
  const r = await page.call('a', typed, { n: 7 })
  await flush()
  // the caller still gets the result, and the outcome reached the route and the subscriber, same correlation
  expect(r).toEqual(ok(7))
  expect(b.got.map(g => [g.input, g.from])).toEqual([[7, 'a']])
  expect(seen).toEqual([[7, 'a']])
  expect(s.routes()).toEqual([{ from: 'a', output: typed.name, to: 'b', op: log.name }])
  // failed calls have no outcome
  await page.call('a', typed, { n: -1 }); await flush()
  expect(b.got.length).toBe(1)
  off()
  expect(s.routes()).toEqual([])
})
