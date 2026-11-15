// The sandbox protocol over a MessageChannel, no iframe: `serve` on port1 (the frame), the stand-in on port2 (the host).
// Pods: `s` sandboxed, `h` host-mode; `s → h` by a call edge and `s.tick → h.record` by a pipe.
import { afterEach, expect, test } from 'bun:test'
import { Type } from 'typebox'
import {
  Application, Pod, assemble, createRegistry, defineSchema, iface, implementation, op, provide, provider, success,
  type AppDeployment, type AppEvent, type NanoContext,
} from '@pritzlaff/nano-core'
import { checkMsg, describeProvider } from '../src/sandbox/protocol.ts'
import { edgesFor } from '../src/sandbox/edges.ts'
import { serve } from '../src/sandbox/serve.ts'
import { standIn, type Frame } from '../src/sandbox/stand-in.ts'

const Text = defineSchema('Text', Type.String())
const Num = defineSchema('Num', Type.Number())
const Nothing = defineSchema('Nothing', Type.Null())
const Echo = iface('t.Echo', { echo: op.action('echo', Text, Text) })
const Ticks = iface('t.Ticks', { tick: op.event('tick', Num) })
const H = iface('t.H', { record: op.action('record', Num, Nothing) })

let inFrame: NanoContext | undefined, frameClosed = 0, seen: number[] = []
const sImpl = implementation('acme/s', { provides: [Echo, Ticks], dependencies: { h: H }, make: ctx => {
  inFrame = ctx
  ctx.addOnCloseListener(() => { frameClosed++ })
  return [provide(Echo, { echo: async x => success(x) }), provide(Ticks, {})]
} })
const hImpl = implementation('acme/h', { provides: [H], make: () => [provide(H, { record: async n => { seen.push(n); return success(null) } })] })
const acme = provider('acme', [sImpl, hImpl])
const registry = createRegistry()
registry.add(acme)

const dep = (wired = true): AppDeployment => ({
  pods: { s: Pod.lazy(sImpl, { isolation: 'sandbox' }), h: Pod.lazy(hImpl) },
  runtimes: { r: { pods: ['s', 'h'], subscriptions: [
    ...(wired ? [{ kind: 'call' as const, from: 's', to: 'h' }] : []),
    { kind: 'pipe', from: 's', source: 't.Ticks/tick', to: 'h', target: 't.H/record' },
  ] } },
})

const tick = (ms = 0) => new Promise(r => setTimeout(r, ms))
const warns: string[] = []
const consoleWarn = console.warn
afterEach(() => { console.warn = consoleWarn; inFrame = undefined; frameClosed = 0; seen = []; warns.length = 0 })

async function harness(o: { readyMs?: number; silent?: boolean } = {}) {
  let disposed = 0, frame: MessagePort | undefined
  const applied = new Set<() => void>(), toasts: string[] = []
  const deps = {
    url: 'mem:acme', readyMs: o.readyMs,
    open(): Frame {
      const ch = new MessageChannel()
      frame = ch.port1
      if (!o.silent) serve(ch.port1, async () => sImpl)
      return { port: ch.port2, ready: Promise.resolve(), dispose() { disposed++; ch.port1.close(); ch.port2.close() } }
    },
    edges: (pod: string) => edgesFor(app.deployment(), registry, pod),
    onApplied: (fn: () => void) => { applied.add(fn); return () => { applied.delete(fn) } },
    warn: (r: string) => { toasts.push(r) },
  }
  const rts = assemble(dep(), registry)
  if (!rts.ok) throw new Error(rts.fail.reason)
  const made = await Application.create(rts.value, { isolate: (_, pod) => standIn(registry.implementation(pod.implementation)!, deps) })
  if (!made.ok) throw new Error(made.fail.reason)
  const app = made.value, events: AppEvent[] = []
  app.listen(e => { events.push(e); if (e.type === 'applied') for (const fn of applied) fn() })
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
  expect(await inFrame!.one(H).call.record(1)).toEqual(success(null))
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

test('given on in the frame, then a no-op and a warning to the host', async () => {
  const { app, toasts } = await harness()
  await app.call('r', 's').echo!('x')
  inFrame!.one(H).on(H.ops.record, () => {})()
  await tick(10)
  expect(toasts).toEqual(['s: on does not cross a sandbox'])
  await app.close()
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

test('given junk from the frame, then each is dropped with a warning and calls still work', async () => {
  console.warn = (m: string) => { warns.push(m) }
  const { app, frame } = await harness()
  await app.call('r', 's').echo!('x')
  const bad = describeProvider(acme, {})
  expect(typeof checkMsg({ type: 'described', providers: [bad] })).toBe('object')
  ;(bad.implementations[0]!.provides[0]!.ops[0]!.input!.schema as Record<string, unknown>).pattern = '(a+)+$'
  for (const m of [{ type: 'result', id: 999 }, { type: 'nope' }, { type: 'publish', op: 'tick', data: 'x'.repeat(2 * 1024 * 1024) },
    { type: 'described', providers: [bad] }]) frame().postMessage(m)
  await tick(20)
  expect(warns.length).toBe(4)
  expect(warns.join('\n')).toContain('pattern')
  expect(await app.call('r', 's').echo!('y')).toEqual(success('y'))
  await app.close()
})

test('given apply removes s → h, then the frame sees no H and an outcall sent anyway is not-found', async () => {
  const { app } = await harness()
  await app.call('r', 's').echo!('x')
  const stale = inFrame!.one(H)
  expect(stale.ok).toBe(true)
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
