// The sandbox protocol over a MessageChannel, no iframe: `serve` on port1 (the frame), the stand-in on port2 (the host).
// Pods: `s` sandboxed, `h` host-mode; `s → h` by a call edge and `s.tick → h.record` by a pipe.
import { afterEach, expect, test } from 'bun:test'
import { Type } from 'typebox'
import { Coord, Application, Pod, AppDeployment, Registry, Schema, Interface, Implementation, Op, provide, success, type AppEvent, type NanoContext, type NanoResult } from '@pritzlaff/nano-core'
import { checkMsg, describeProvider } from '../src/sandbox/protocol.ts'
import { edgesFor } from '../src/sandbox/edges.ts'
import type { ViewTarget } from '@pritzlaff/nano-ui'
import { serve } from '../src/sandbox/serve.ts'
import { standIn, type Frame } from '../src/sandbox/stand-in.ts'

const ns = Coord.namespace('acme')

const Text = Schema.define(Type.String(), 'Text')
const Num = Schema.define(Type.Number(), 'Num')
const Nothing = Schema.define(Type.Null(), 'Nothing')
const Echo = Interface.define('t.Echo', { echo: Op.action(Text, Text) })
const Ticks = Interface.define('t.Ticks', { tick: Op.event(Num) })
const H = Interface.define('t.H', { record: Op.action(Num, Nothing), said: Op.event(Num) })

const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }

let inFrame: NanoContext | undefined, inH: NanoContext | undefined, view: Omit<ViewTarget, 'registry'> | undefined, frameClosed = 0, seen: number[] = []
const sImpl = Implementation.define(ns.implementationId('s'), { provides: [Echo, Ticks], dependencies: { h: H }, make: ctx => {
  inFrame = ctx
  ctx.addOnCloseListener(() => { frameClosed++ })
  return [provide(Echo, { echo: async x => success(x) }), provide(Ticks, {})]
} })
const hImpl = Implementation.define(ns.implementationId('h'), { provides: [H], make: ctx => { inH = ctx; return [provide(H, { record: async n => { seen.push(n); return success(null) } })] } })
// A sandboxed pod whose source hears h's said through its own edge and yields each plus one.
const relay = Implementation.define(ns.implementationId('relay'), { provides: [Ticks], dependencies: { h: H }, make: ctx => ({
  async *tick() { for await (const n of ctx.deps.h.said()) yield n + 1 },
}) })
const acme = ns.provider([sImpl, hImpl, relay])
const registry = Registry.create()
registry.add(acme)

const dep = (wired = true, o: { relay?: boolean; deny?: boolean } = {}): AppDeployment => ({
  pods: { s: Pod.lazy(sImpl, { isolation: 'sandbox' }), h: Pod.eager(hImpl), ...(o.relay && { p: Pod.eager(relay, { isolation: 'sandbox' }) }) },
  runtimes: { r: { pods: ['s', 'h', ...(o.relay ? ['p'] : [])], ...(o.deny && { policy: { kind: 'rules' as const, rules: [{ deny: 'subscribe' as const, from: 's' }, { allow: '*' as const }] } }), subscriptions: [
    ...(o.relay ? [{ kind: 'call' as const, from: 'p', to: 'h' }] : []),
    ...(wired ? [{ kind: 'call' as const, from: 's', to: 'h' }] : []),
    { kind: 'pipe', from: 's', source: 't.Ticks/tick', to: 'h', target: 't.H/record' },
  ] } },
})

const tick = (ms = 0) => new Promise(r => setTimeout(r, ms))
const warns: string[] = []
const consoleWarn = console.warn
afterEach(() => { console.warn = consoleWarn; inFrame = undefined; inH = undefined; view = undefined; frameClosed = 0; seen = []; warns.length = 0 })

async function harness(o: { readyMs?: number; silent?: boolean; relay?: boolean; deny?: boolean } = {}) {
  let disposed = 0, frame: MessagePort | undefined
  const applied = new Set<() => void>(), toasts: string[] = []
  const deps = {
    url: 'mem:acme', readyMs: o.readyMs,
    open(): Frame {
      const ch = new MessageChannel()
      frame = ch.port1
      if (!o.silent) serve(ch.port1, async (_, coord) => registry.implementation(coord)!, { render: (_, t) => { view = t } })
      return { port: ch.port2, ready: Promise.resolve(), dispose() { disposed++; ch.port1.close(); ch.port2.close() } }
    },
    edges: (pod: string) => edgesFor(app.deployment(), registry, pod), implementation: (c: string) => registry.implementation(c),
    onApplied: (fn: () => void) => { applied.add(fn); return () => { applied.delete(fn) } },
    warn: (r: string) => { toasts.push(r) },
    app: () => app,
  }
  const rts = AppDeployment.assemble(dep(true, { deny: o.deny }), registry)
  if (!rts.ok) throw new Error(rts.fail.reason)
  const made = await Application.create(rts.value, { isolate: (_, pod) => standIn(registry.implementation(pod.implementation)!, deps) })
  if (!made.ok) throw new Error(made.fail.reason)
  const app = made.value, events: AppEvent[] = []
  app.listen(e => { events.push(e); if (e.type === 'applied') for (const fn of applied) fn() })
  if (o.relay) must(await app.apply(dep(true, o)))   // added after create, as an import is: its frame needs the app
  return { app, events, toasts, disposed: () => disposed, frame: () => frame! }
}

test('given a sandboxed pod, then a call crosses the port and is on the stream', async () => {
  const { app, events } = await harness()
  expect(await app.call('r', 's').echo!('x')).toEqual(success('x'))
  const sent = events.find(e => e.type === 'sent' && e.to === 's' && e.port === 't.Echo/echo') as { id: string } | undefined
  expect(sent).toBeDefined()
  expect(events).toContainEqual(expect.objectContaining({ type: 'delivered', id: sent!.id, result: success('x') }))
  await app.close()
})

test('given the frame calls out through its edge, then h hears it', async () => {
  const { app } = await harness()
  await app.call('r', 's').echo!('x')
  expect(await must(inFrame!.one(H)).call.record(1)).toEqual(success(null))
  expect(seen).toEqual([1])
  await app.close()
})

test('given the frame publishes tick, then the pipe delivers it to h.record', async () => {
  const { app } = await harness()
  await app.call('r', 's').echo!('x')
  await inFrame!.publish(Ticks.ops.tick, 2)
  await tick(10)
  expect(seen).toEqual([2])
  await app.close()
})

test("given on in the frame, then the host subscribes as the frame's pod and forwards each emission until return()", async () => {
  const { app, events } = await harness()
  await app.call('r', 's').echo!('x')
  const it = must(inFrame!.one(H)).on(H.ops.said)[Symbol.asyncIterator]()
  await tick(10)
  await inH!.publish(H.ops.said, 4)
  expect(await it.next()).toEqual({ done: false, value: { output: 4 } })
  expect(events).toContainEqual(expect.objectContaining({ type: 'sent', kind: 'subscribe', from: 's', to: 'h', port: 't.H/said' }))
  await it.return!()
  await tick(10)
  expect(events).toContainEqual(expect.objectContaining({ type: 'sent', kind: 'unsubscribe', from: 's', to: 'h' }))
  await app.close()
})

test('given a callback on in the frame, then it hears emissions until the frame closes, and nothing is left host-side', async () => {
  const { app, events } = await harness()
  await app.call('r', 's').echo!('x')
  const heard: unknown[] = []
  must(inFrame!.one(H)).on(H.ops.said, e => { heard.push(e.output) })
  await tick(10)
  await inH!.publish(H.ops.said, 1)
  await tick(10)
  expect(heard).toEqual([1])
  await app.restart('s')
  await tick(10)
  await inH!.publish(H.ops.said, 2)
  await tick(10)
  expect(heard).toEqual([1])
  expect(events.filter(e => e.type === 'sent' && e.kind === 'unsubscribe' && e.from === 's')).toHaveLength(1)
  await app.close()
})

test("given the runtime's policy refuses s's subscribe, then on in the frame fails denied", async () => {
  const { app, toasts } = await harness({ deny: true })
  await app.call('r', 's').echo!('x')
  const it = must(inFrame!.one(H)).on(H.ops.said)[Symbol.asyncIterator]()
  expect(it.next()).rejects.toMatchObject({ fail: { type: 'denied' } })
  must(inFrame!.one(H)).on(H.ops.said, () => {})
  await tick(10)
  expect(toasts.join()).toContain('denied')
  await app.close()
})

test("given a sandboxed pod's source, then it runs in the frame and the host hears its values", async () => {
  const { app } = await harness({ relay: true })
  const it = app.runtime('r').get(Ticks, { pod: 'p' }).tick()[Symbol.asyncIterator]()
  await tick(20)
  await inH!.publish(H.ops.said, 1)
  expect(await it.next()).toEqual({ done: false, value: 2 })
  await it.return!()
  await app.close()
})

test("given the frame's view iterates its own pod's event, then it hears what the pod publishes", async () => {
  const { app } = await harness()
  await app.call('r', 's').echo!('x')
  const it = view!.app.runtime('r').get(Ticks, { pod: 's' }).tick()[Symbol.asyncIterator]()
  await tick(10)
  await inFrame!.publish(Ticks.ops.tick, 7)
  expect(await it.next()).toEqual({ done: false, value: 7 })
  await it.return!()
  await app.close()
})

test('subscription messages: ids are numbers, ops strings, results results', () => {
  expect(checkMsg({ type: 'on', id: 1, pod: 'h', runtime: 'r', op: 't.H/said' })).toMatchObject({ type: 'on' })
  expect(checkMsg({ type: 'on', id: '1', pod: 'h', runtime: 'r', op: 't.H/said' })).toBe('on: bad id')
  expect(checkMsg({ type: 'view-on', id: 1, op: 5 })).toBe('view-on: bad op')
  expect(checkMsg({ type: 'off', id: 1 })).toEqual({ type: 'off', id: 1 })
  expect(checkMsg({ type: 'emission', id: 1, event: { output: 1 } })).toMatchObject({ type: 'emission' })
  expect(checkMsg({ type: 'ended', id: 1, result: { nope: 1 } })).toBe('ended: bad result')
})

test('given app.close(), then the frame closes and the frame is disposed once', async () => {
  const { app, disposed } = await harness()
  await app.call('r', 's').echo!('x')
  await app.close()
  expect(frameClosed).toBe(1)
  expect(disposed()).toBe(1)
})

test('given a frame that never sends ready, then the call fails threw within 200ms', async () => {
  const { app, disposed } = await harness({ readyMs: 50, silent: true })
  const t0 = Date.now(), r = await app.call('r', 's').echo!('x')
  expect(r).toMatchObject({ ok: false, fail: { type: 'threw' } })
  expect(Date.now() - t0).toBeLessThan(200)
  expect(disposed()).toBe(1)
  await app.close()
})

test('given junk from the frame, then it fails the frame as failed does: a pending call settles threw with the reason', async () => {
  const bad = describeProvider(acme, {})
  expect(typeof checkMsg({ type: 'described', providers: [bad] })).toBe('object')
  ;(bad.implementations[0]!.provides[0]!.ops[0]!.input!.schema as Record<string, unknown>).pattern = '(a+)+$'
  const junk: [unknown, string][] = [[{ type: 'result', id: 999 }, 'bad result'], [{ type: 'nope' }, 'unknown type nope'],
    [{ type: 'publish', op: 'tick', data: 'x'.repeat(2 * 1024 * 1024) }, 'over 1 MiB'], [{ type: 'described', providers: [bad] }, 'pattern']]
  for (const [m, why] of junk) {
    const { app, frame } = await harness({ silent: true })
    const pending = app.call('r', 's').echo!('x')
    await tick(10)
    frame().postMessage({ type: 'ready' })
    await tick(10)   // built; the call is posted and the silent frame never answers
    frame().postMessage(m)
    const r = await pending
    expect(r).toMatchObject({ ok: false, fail: { type: 'threw' } })
    expect(r.ok ? '' : r.fail.reason).toContain(why)
    expect(await app.call('r', 's').echo!('y')).toMatchObject({ ok: false, fail: { type: 'threw' } })
    await app.close()
  }
})

test('given apply removes s → h, then the frame sees no H and an outcall sent anyway is not-found', async () => {
  const { app } = await harness()
  await app.call('r', 's').echo!('x')
  const stale = must(inFrame!.one(H))
  expect(await app.apply(dep(false))).toEqual(success(undefined))
  await tick(10)
  expect(inFrame!.one(H).ok).toBe(false)
  expect(await stale.call.record(3)).toMatchObject({ ok: false, fail: { type: 'not-found' } })
  expect(seen).toEqual([])
  await app.close()
})

test('given non-JSON clone types, then checkMsg sizes and returns only their JSON', () => {
  expect(checkMsg({ type: 'publish', op: 'tick', data: new Map([['k', 'x'.repeat(5 * 1024 * 1024)]]) })).toEqual({ type: 'publish', op: 'tick', data: {} })
  expect(checkMsg({ type: 'publish', op: 'tick', data: new ArrayBuffer(50 * 1024 * 1024) })).toEqual({ type: 'publish', op: 'tick', data: {} })
  expect(checkMsg({ type: 'publish', op: 'tick', data: { big: 'x'.repeat(2 * 1024 * 1024), m: new Map() } })).toContain('over 1 MiB')
  expect(checkMsg({ type: 'result', id: 1, result: success(undefined) })).toEqual({ type: 'result', id: 1, result: success(undefined) })
})

test('a theme message carries a known theme id and mode, never CSS', () => {
  expect(checkMsg({ type: 'theme', theme: 'enterprise', mode: 'dark' })).toEqual({ type: 'theme', theme: 'enterprise', mode: 'dark' })
  expect(checkMsg({ type: 'theme', theme: 'nope', mode: 'dark' })).toBe('theme: bad theme')
  expect(checkMsg({ type: 'theme', theme: 'enterprise', mode: 'neon' })).toBe('theme: bad mode')
  expect(checkMsg({ type: 'theme', theme: 'body{background:red}', mode: 'light' })).toBe('theme: bad theme')
  expect(checkMsg({ type: 'theme', theme: 'toString', mode: 'light' })).toBe('theme: bad theme')
})

test("a call edge in another runtime (its target's, the caller outside) is the caller's edge, as nano's ctx.one has it", () => {
  const d: AppDeployment = { pods: { s: Pod.lazy(sImpl), h: Pod.lazy(hImpl) },
    runtimes: { front: { pods: ['s'], subscriptions: [] }, back: { pods: ['h'], subscriptions: [{ kind: 'call', from: 's', to: 'h' }] } } }
  expect(edgesFor(d, registry, 's')).toEqual([{ pod: 'h', runtime: 'back', implementation: hImpl.coord, provider: hImpl.provider, provides: ['t.H'], tags: [] }])
})
