/**
 * Use case 2 (spec: 2026-11-16-runtime-view-streams-design.md): the no-callback form of `on` / `subscribe` is an
 * AsyncIterable of emissions; it ends when its listener is removed by anything but the consumer.
 */
import { expect, test } from 'bun:test'
import { Type } from 'typebox'
import { AppDeployment, Application, Implementation, Interface, Op, Provider, Registry, type NanoResult, type Policy } from '../../src/index.ts'

const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
const KV = Interface.define('acme.KV', { put: Op.action(Type.String(), Type.Null()) })
const Watch = Interface.define('acme.Watch', { ping: Op.action(Type.Null(), Type.Null()) })
let listening: AsyncIterable<{ input: unknown; output: unknown }> | undefined
const registry = Registry.create()
must(registry.add(Provider.define('acme', [
  Implementation.define('acme/kv', { provides: [KV], make: () => ({ async put() {} }) }),
  Implementation.define('acme/watch', { provides: [Watch], make: ctx => {
    const s = ctx.one(KV)
    if (s.ok) listening = s.value.on(KV.ops.put) as never
    return { async ping() {} }
  } }),
])))
const d: AppDeployment = { pods: { store: { implementation: 'acme/kv', eager: false } }, runtimes: { main: { pods: ['store'], subscriptions: [] } } }
const open = async (policies?: Record<string, Policy>) => must(await Application.create(must(AppDeployment.assemble(d, registry)), { policies }))

test('subscribe(op) iterates emissions made after it starts; break removes the listener', async () => {
  const app = await open(), main = app.runtime('main')
  await main.call('store').put('a'); await main.call('store').put('b')
  const seen: unknown[] = []
  const loop = (async () => { for await (const e of main.subscribe(KV.ops.put)) { seen.push(e.input); break } })()
  await main.call('store').put('c'); await loop
  await main.call('store').put('d')
  expect(seen).toEqual(['c'])
  let extra = 0
  const off = main.subscribe(KV.ops.put, () => { extra++ })
  await main.call('store').put('e'); await Bun.sleep(0)
  expect(extra).toBe(1)
  off()
})

test('break before anything arrives removes it', async () => {
  const app = await open(), main = app.runtime('main')
  const seen: unknown[] = []
  const closed = (async () => { for await (const e of main.subscribe(KV.ops.put)) { seen.push(e); break } })()
  await main.call('store').put('x')
  await closed
  const it = main.subscribe(KV.ops.put)[Symbol.asyncIterator]()
  await it.return!()
  await main.call('store').put('y'); await Bun.sleep(0)
  expect(await it.next()).toEqual({ done: true, value: undefined })
})

test('a removed pod ends the iteration', async () => {
  const app = await open(), main = app.runtime('main')
  const done = (async () => { for await (const _ of main.subscribe(KV.ops.put)); return 'ended' })()
  must(await app.apply({ pods: {}, runtimes: { main: { pods: [], subscriptions: [] } } }))
  expect(await done).toBe('ended')
})

test('a denied subscribe ends at once', async () => {
  const app = await open({ main: { isAllowed: (_f, _t, data) => data === 'subscribe' ? { approved: false, reason: 'no' } : { approved: true } } })
  for await (const _ of app.runtime('main').subscribe(KV.ops.put));
})

const watched: AppDeployment = {
  pods: { store: { implementation: 'acme/kv', eager: false }, watch: { implementation: 'acme/watch', eager: true } },
  runtimes: { main: { pods: ['store', 'watch'], subscriptions: [{ kind: 'call', from: 'watch', to: 'store' }] } },
}
const openWatched = async () => must(await Application.create(must(AppDeployment.assemble(watched, registry)), {}))

test('on(op) iterates emissions after it starts; break removes it', async () => {
  const app = await openWatched()
  await app.call('store').put('a')
  const seen: unknown[] = []
  const loop = (async () => { for await (const e of listening!) { seen.push(e.input); break } })()
  await app.call('store').put('c'); await loop
  await app.call('store').put('d')
  expect(seen).toEqual(['c'])
  let extra = 0
  app.subscribe(KV.ops.put, () => { extra++ })
  await app.call('store').put('e'); await Bun.sleep(0)
  expect(extra).toBe(1)
})

test('on(op): break before anything arrives, and a second iteration throws', async () => {
  await openWatched()
  const it = listening![Symbol.asyncIterator]()
  expect(() => listening![Symbol.asyncIterator]()).toThrow()
  await it.return!()
  expect(await it.next()).toEqual({ done: true, value: undefined })
})

test('on(op) ends when apply removes the source', async () => {
  const app = await openWatched()
  const done = (async () => { for await (const _ of listening!); return 'ended' })()
  await Bun.sleep(0)
  must(await app.apply({ ...watched, pods: { watch: watched.pods.watch! }, runtimes: { main: { pods: ['watch'], subscriptions: [] } } }))
  expect(await done).toBe('ended')
})

test('on(op) ends when the listening pod is restarted or removed', async () => {
  const app = await openWatched()
  const a = (async () => { for await (const _ of listening!); return 'ended' })()
  await Bun.sleep(0)
  must(await app.restart('watch'))
  expect(await a).toBe('ended')
  const b = (async () => { for await (const _ of listening!); return 'ended' })()
  await Bun.sleep(0)
  must(await app.apply({ ...watched, pods: { store: watched.pods.store! }, runtimes: { main: { pods: ['store'], subscriptions: [] } } }))
  expect(await b).toBe('ended')
})

test('app.close() ends a host iteration', async () => {
  const app = await open()
  const done = (async () => { for await (const _ of app.runtime('main').subscribe(KV.ops.put)); return 'ended' })()
  await Bun.sleep(0)
  must(await app.close())
  expect(await done).toBe('ended')
})
