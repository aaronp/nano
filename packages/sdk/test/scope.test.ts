import { test, expect } from 'bun:test'
import Type from 'typebox'
import { Calls, Components, Contexts, Publications, Subscriptions, fail, ok, type ComponentFactory, type Context, type ErrorInfo, type SystemError } from '../src'

const flush = (ms = 0) => new Promise(r => setTimeout(r, ms))
const setup = (opts: { maxDepth?: number; maxRound?: number } = {}) => {
  const errors: { e: SystemError; info: ErrorInfo }[] = []
  const s = Contexts.scope({ ...opts, onError: (e, info) => errors.push({ e, info }) })
  return { s, errors, page: s.context('page') }
}

// A component that hands its context out and answers `log` with its input.
const X = Components.declare({ author: 't', id: 'x' })
const fired = X.op('fired', 'fired', { output: Type.Object({ text: Type.String() }) })
const log = X.op('log', 'echo the input', { input: Type.Unknown() })
const typed = X.op('typed', 'n → n', { input: Type.Object({ n: Type.Number() }), output: Type.Number() })
const x = () => {
  const got: { input: unknown; from: string; depth: number }[] = []
  let ctx!: Context
  const f = X.define({
    state: () => null,
    setup: on => { ctx = on.ctx },
    handlers: [
      [log, (input, { inv }) => { got.push({ input, from: inv.from, depth: inv.stack.length }); return ok(input) }],
      [typed, ({ n }) => n < 0 ? fail('handler', 'negative') : n === 13 ? ok('bad' as unknown as number) : ok(n)],
    ],
  })
  return Object.assign(f, { got, ctx: () => ctx })
}

test('publish delivers synchronously, in subscription order; nested publishes are queued FIFO', async () => {
  const { s, page } = setup()
  const a = x(), b = x()
  await s.add('a', a); await s.add('b', b)
  const order: string[] = []
  page.subscribe(undefined, fired, p => { order.push(`1:${p.text}`); if (p.text === 'first') void b.ctx().publish(fired, { text: 'nested' }) })
  page.subscribe(undefined, fired, p => { order.push(`2:${p.text}`) })
  const r = await a.ctx().publish(fired, { text: 'first' })
  expect(r.type).toBe('success')
  expect(order).toEqual(['1:first', '2:first', '1:nested', '2:nested'])
})

test('on: filter by sender; delivery carries sender and stack; unsubscribe', async () => {
  const { s, page } = setup()
  const a = x(), b = x()
  await s.add('a', a); await s.add('b', b)
  const seen: string[] = []
  const off = page.subscribe('b', fired, (p, d) => { seen.push(`${d.from}:${p.text}:${d.stack.map(f => f.from).join('>')}`) })
  await a.ctx().publish(fired, { text: 'ignored' })
  await b.ctx().publish(fired, { text: 'hi' })
  off()
  await b.ctx().publish(fired, { text: 'after' })
  expect(seen).toEqual(['b:hi:b'])
})

test('emit validation: undeclared event, bad payload, and a non-component party', async () => {
  const { s, page } = setup()
  const a = x(); await s.add('a', a)
  // @ts-expect-error runtime validation is what's under test
  const bad = await a.ctx().publish(fired, { text: 1 })
  expect(bad.type === 'error' && bad.error.code).toBe('validation')
  const undeclared = await a.ctx().publish({ name: 'nope', output: Type.Unknown() }, {})
  expect(undeclared.type === 'error' && undeclared.error.message).toBe('a does not publish nope')
  expect((await page.publish(fired, { text: 'x' })).type).toBe('error')
})

test('call: result, validation of input and output, unknown target/action, throwing handler', async () => {
  const { s, page } = setup()
  const a = x(); await s.add('a', a)
  expect(await page.call('a', log, { q: 1 })).toEqual(ok({ q: 1 }))
  expect(a.got[0]).toEqual({ input: { q: 1 }, from: 'page', depth: 0 })
  const r = await page.call('a', typed, { n: 2 })
  if (r.type === 'success') { const n: number = r.data; expect(n).toBe(2) }
  const code = async (p: Promise<{ type: string; error?: { code: string } }>) => { const v = await p; return v.type === 'error' ? v.error!.code : v.type }
  expect(await code(page.call('a', typed, { n: 'x' as never }))).toBe('validation')
  expect(await code(page.call('a', typed, { n: 13 }))).toBe('validation')     // output
  expect(await code(page.call('a', typed, { n: -1 }))).toBe('handler')        // returned error
  expect(await code(page.call('nope', log, 1))).toBe('unknown-target')
  expect(await code(page.call('a', { name: 'zz', input: Type.Unknown() }, 1))).toBe('unknown-action')
  const thrower: ComponentFactory = { manifest: { id: { author: 't', id: 'th' } , ops: [log] }, create: () => ({ onAction: () => { throw new Error('boom') } }) }
  await s.add('th', thrower)
  expect(await code(page.call('th', log, 1))).toBe('handler')
})

test('route: event → action with the emitter as sender; failures reported; unroute', async () => {
  const { s, errors } = setup()
  const a = x(), b = x(), n = x()
  await s.add('a', a); await s.add('b', b)
  const unroute = s.route('a', fired, 'b', log)
  s.route('a', fired, 'missing', log)
  await a.ctx().publish(fired, { text: 'hi' }); await flush()
  expect(b.got).toEqual([{ input: { text: 'hi' }, from: 'a', depth: 1 }])
  expect(errors.map(e => e.e.code)).toEqual(['unknown-target'])
  unroute()
  await a.ctx().publish(fired, { text: 'again' }); await flush()
  expect(b.got.length).toBe(1)
  void n
})

test('a feedback loop through subscriptions stops at max depth and is reported', async () => {
  const { s, errors } = setup({ maxDepth: 8 })
  const a = x(), b = x()
  await s.add('a', a); await s.add('b', b)
  a.ctx().subscribe('b', fired, (p, d) => d.ctx.publish(fired, p))
  b.ctx().subscribe('a', fired, (p, d) => d.ctx.publish(fired, p))
  await a.ctx().publish(fired, { text: 'ping' })
  expect(errors.map(e => e.e.code)).toEqual(['loop'])
  expect(errors[0].info.stack.length).toBe(8)
})

test('a loop that bypasses the stack is capped per dispatch round', async () => {
  const { s, errors } = setup({ maxRound: 50 })
  const a = x(); await s.add('a', a)
  a.ctx().subscribe(undefined, fired, p => { void a.ctx().publish(fired, p) })   // closure ctx: no stack
  await a.ctx().publish(fired, { text: 'spin' })
  expect(errors.map(e => e.e.message)).toEqual(['more than 50 publications in one dispatch'])
})

test('a throwing subscriber is reported and does not stop the others', async () => {
  const { s, page, errors } = setup()
  const a = x(); await s.add('a', a)
  const got: string[] = []
  page.subscribe(undefined, fired, () => { throw new Error('sub') })
  page.subscribe(undefined, fired, async () => { throw new Error('async sub') })
  page.subscribe(undefined, fired, p => { got.push(p.text) })
  await a.ctx().publish(fired, { text: 'ok' }); await flush()
  expect(got).toEqual(['ok'])
  expect(errors.map(e => e.e.message).sort()).toEqual(['async sub', 'sub'])
})

test('remove: disposes, drops its subscriptions, and its context goes dead even if the name is reused', async () => {
  const { s, page } = setup()
  let disposed = 0
  const D = Components.declare({ author: 't', id: 'd' })
  const heard: string[] = []
  const d = D.define({ state: () => null, setup: ({ ctx }) => { ctx.subscribe(undefined, fired, p => { heard.push(p.text) }) }, dispose: () => { disposed++ } })
  const a = x(); await s.add('a', a); await s.add('d', d)
  const zombie = a.ctx()
  await s.remove('d'); await s.remove('a')
  expect(disposed).toBe(1)
  expect((await zombie.publish(fired, { text: 'x' })).type).toBe('error')
  const a2 = x(); await s.add('a', a2)
  expect((await zombie.publish(fired, { text: 'x' })).type).toBe('error')
  await a2.ctx().publish(fired, { text: 'y' })
  expect(heard).toEqual([])
  expect(page.instances().map(i => i.name)).toEqual(['a'])
})

test('concurrent duplicate add is rejected; a failing create leaves nothing behind', async () => {
  const { s } = setup()
  const r = await Promise.allSettled([s.add('a', x()), s.add('a', x())])
  expect(r.map(v => v.status).sort()).toEqual(['fulfilled', 'rejected'])
  await expect(s.add('boom', { manifest: x().manifest, create: () => { throw new Error('nope') } })).rejects.toThrow('nope')
  expect(s.component('boom')).toBeUndefined()
})

test('watch: now and on every change, through withInstances', async () => {
  const { s, page } = setup()
  const seen: string[][] = []
  page.withInstances(l => l.filter(i => i.name !== 'hidden')).watch(l => seen.push(l.map(i => i.name)))
  await s.add('a', x()); await s.add('hidden', x()); await s.remove('a')
  expect(seen).toEqual([[], ['a'], ['a'], []])
})

test('wrappers: Publications (filter/map/trace, last added runs first), debounce, Calls, Subscriptions, throwing wrapper', async () => {
  const { s, page } = setup()
  let open = false
  const traced: string[] = []
  const a = x()
  await s.add('a', a, c => c
    .withPublish(Publications.trace((e, r) => traced.push(`${(e.payload as any).text}:${r.type}`)))
    .withPublish(Publications.filter(() => open))
    .withPublish(Publications.map(e => ({ ...e, payload: { text: (e.payload as any).text.toUpperCase() } })))
    .withCall(Calls.filter(c => c.target !== 'secret'))
    .withSubscribe(Subscriptions.filter(sub => sub.op.name !== log.name)))
  const got: string[] = []
  page.subscribe(undefined, fired, p => { got.push(p.text) })
  expect(await a.ctx().publish(fired, { text: 'x' })).toEqual({ type: 'not-allowed', reason: 'filtered' })
  open = true
  await a.ctx().publish(fired, { text: 'y' })
  expect(got).toEqual(['Y']); expect(traced).toEqual(['Y:success'])
  expect((await a.ctx().call('secret', log, 1)).type).toBe('not-allowed')

  const b = x()
  await s.add('b', b, c => c.withPublish(Publications.debounce(5)))
  for (const t of ['1', '2', '3']) await b.ctx().publish(fired, { text: t })
  await flush(15)
  expect(got).toEqual(['Y', '3'])

  const c = x()
  await s.add('c', c, ctx => ctx.withPublish(() => { throw new Error('nope') }))
  const r = await c.ctx().publish(fired, { text: 'x' })
  expect(r.type === 'error' && r.error.code).toBe('handler')
})
