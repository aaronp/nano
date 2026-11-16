/**
 * Use case 1 (spec: 2026-11-16-runtime-view-streams-design.md): a Subscription as a deployment descriptor, and the one
 * delivery primitive under it: a pipe passes an emission's `output` on; `on` gets the emission (`{ input, output }` for
 * an action, `{ output }` for an event); the 'subscribe' question is asked once, when a listener connects.
 */
import { expect, test } from 'bun:test'
import { Type } from 'typebox'
import { AppDeployment, Application, Implementation, Interface, Op, Provider, Registry, type AppEvent, type NanoContext, type NanoResult, type Policy } from '../../src/index.ts'

const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
const Ticker = Interface.define('acme.Ticker', { tick: Op.event(Type.Number()) })
const Sink = Interface.define('acme.Sink', { record: Op.action(Type.Number(), Type.Null()) })
const KV = Interface.define('acme.KV', { put: Op.action(Type.Object({ key: Type.String(), value: Type.String() }), Type.Null()) })
const Watch = Interface.define('acme.Watch', { ping: Op.action(Type.Null(), Type.Null()) })

let ticker: NanoContext | undefined
const recorded: number[] = [], seen: unknown[] = []
const impls = [
  Implementation.define('acme/ticker', { provides: [Ticker], make: ctx => { ticker = ctx; return {} as never } }),
  Implementation.define('acme/sink', { provides: [Sink], make: () => ({ async record(n: number) { recorded.push(n) } }) }),
  Implementation.define('acme/kv', { provides: [KV], make: () => ({ async put() {} }) }),
  Implementation.define('acme/watch', { provides: [Watch], dependencies: { store: KV }, make: ctx => {
    const s = ctx.one(KV)
    if (s.ok) s.value.on(KV.ops.put, e => { seen.push(e) })
    return { async ping() {} }
  } }),
]
const registry = Registry.create()
must(registry.add(Provider.define('acme', impls)))
const open = async (d: AppDeployment, policies?: Record<string, Policy>) =>
  must(await Application.create(must(AppDeployment.assemble(d, registry)), { policies }))

const piped: AppDeployment = {
  pods: { ticker: { implementation: 'acme/ticker', eager: true }, sink: { implementation: 'acme/sink', eager: false } },
  runtimes: { main: { pods: ['ticker', 'sink'], subscriptions: [{ kind: 'pipe', from: 'ticker', source: 'acme.Ticker/tick', to: 'sink', target: 'acme.Sink/record' }] } },
}

test("a pipe Subscription delivers each emission's output to the target action", async () => {
  recorded.length = 0
  await open(piped)
  await ticker!.publish(Ticker.ops.tick, 3)
  expect(recorded).toEqual([3])
})

test('apply removing the pipe ends it', async () => {
  recorded.length = 0
  const app = await open(piped)
  must(await app.apply({ ...piped, runtimes: { main: { pods: ['ticker', 'sink'], subscriptions: [] } } }))
  await ticker!.publish(Ticker.ops.tick, 4)
  expect(recorded).toEqual([])
})

const watched: AppDeployment = {
  pods: { store: { implementation: 'acme/kv', eager: false }, watch: { implementation: 'acme/watch', eager: true } },
  runtimes: { main: { pods: ['store', 'watch'], subscriptions: [{ kind: 'call', from: 'watch', to: 'store' }] } },
}

test('on gets { input, output } for an action and { output } for an event', async () => {
  seen.length = 0
  const app = await open(watched)
  await app.call('store').put({ key: 'k', value: 'v' })
  await Bun.sleep(0)
  expect(seen).toEqual([{ input: { key: 'k', value: 'v' }, output: null }])
})

test('a denied subscribe is asked once, at connect: no-op unsubscribe, one denied event', async () => {
  seen.length = 0
  let asked = 0
  const deny: Policy = { isAllowed: (_f, _t, data) => data === 'subscribe' ? (asked++, { approved: false, reason: 'no' }) : { approved: true } }
  const app = await open({ ...watched, pods: { ...watched.pods, watch: { implementation: 'acme/watch', eager: false } } }, { main: deny })
  const events: AppEvent[] = []
  app.listen(e => { events.push(e) })
  await app.call('watch').ping(null)
  await app.call('store').put({ key: 'k', value: 'v' })
  await app.call('store').put({ key: 'k2', value: 'v' })
  await Bun.sleep(0)
  expect(asked).toBe(1)
  expect(events.filter(e => e.type === 'denied')).toHaveLength(1)
  expect(seen).toEqual([])
})
