/**
 * Folding a KV store's history gives what a shadow app rebuilt to the same time holds: at every message boundary of a
 * seeded run on a simulated clock, across five seeds. The run's `at` is stamped by the test, one step per host input,
 * so each boundary falls where the app is quiet (shadowAt finishes what its last input set off).
 */
import { expect, test } from 'bun:test'
import { Application, AppDeployment, Coord, Implementation, Registry, port, type NanoResult } from '@pritzlaff/nano-core'
import uiProvider, { Clock, Random, diverge, foldAt, memoryStore, pair, record, replay, shadowAt, type MessageStore, type Recorded } from '@pritzlaff/nano-ui'
import { KeyValueStoreDef } from './contract.ts'
import { kvStep } from './fold.ts'
import kv from './memory.ts'

const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
const settle = () => new Promise(r => setTimeout(r, 0))
const { api } = KeyValueStoreDef

const ns = Coord.namespace('test')
/** On each firing of its own timer, puts or deletes one of four keys at random, then re-arms 10 to 29 ms out. */
const writer = Implementation.define(ns.implementationId('writer'), {
  provides: [],
  dependencies: { clock: Clock, random: Random, kv: api },
  make: ctx => {
    const clock = must(ctx.one(Clock)), random = must(ctx.one(Random)), store = must(ctx.one(api))
    let mine: unknown
    clock.on(Clock.ops.fired, async e => {
      if (e.output.id !== mine) return
      const a = must(await random.call.next(null)), b = must(await random.call.next(null))
      const key = ['k', String(Math.floor(a * 4))]
      must(await (b < 0.3 ? store.call.delete(key) : store.call.put({ key, value: Math.round(b * 100) })))
      mine = must(await clock.call.after({ ms: 10 + Math.floor(a * 20) }))
    })
    void clock.call.after({ ms: 10 }).then(r => { mine = must(r) })
    return []
  },
})

const registry = Registry.create()
for (const p of [uiProvider, kv, ns.provider([writer])]) must(registry.add(p))
const create = (d: AppDeployment) => Application.create(must(AppDeployment.assemble(d, registry)), {})
const kvPod = (entries: KeyValueStoreDef.Entry[]) => ({ implementation: 'example.kv/memory', eager: true, config: { entries } })
const base = (seed: number): AppDeployment => ({
  pods: { sim: { implementation: 'nano.ui/sim-clock', eager: true }, rng: { implementation: 'nano.ui/seeded-random', eager: true, config: { seed } },
    kv: kvPod([{ key: ['k', '0'], value: 'start' }]), writer: { implementation: 'test/writer', eager: true } },
  runtimes: { main: { pods: ['sim', 'rng', 'kv', 'writer'], subscriptions: [
    { kind: 'call', from: 'writer', to: 'sim' }, { kind: 'call', from: 'writer', to: 'rng' }, { kind: 'call', from: 'writer', to: 'kv' }] } },
})

/** 30 `advance(10)`, settling after each; after the 15th an apply changes the store's config. `at` moves 10 per input. */
async function run(seed: number) {
  const app = must(await create(base(seed)))
  const store = memoryStore()
  let now = 0
  const { stop } = await record(app, store, { clean: true, now: () => now })
  await settle()
  for (let i = 1; i <= 30; i++) {
    now += 10
    must(await app.call('main', 'sim').advance(10))
    await settle()
    if (i === 15) { now += 10; must(await app.apply({ ...app.deployment(), pods: { ...app.deployment().pods, kv: kvPod([{ key: ['k', '9'], value: 'reset' }]) } })); await settle() }
  }
  stop()
  return { app, store }
}

test.each([1, 2, 3, 4, 5])('the fold equals the shadow app at every message boundary (seed %d)', async seed => {
  const { app, store } = await run(seed)
  const boundaries = [...new Set((await store.range()).map(e => e.at))]
  const states = new Set<string>()
  for (const t of boundaries) {
    const folded = await foldAt(store, t, kvStep('kv'))
    const shadow = must(await shadowAt(store, t, create))
    expect(must(await shadow.call('main', 'kv').list({ prefix: [] }))).toEqual(folded.entries)
    await shadow.close()
    states.add(JSON.stringify(folded.entries))
  }
  expect(boundaries.length).toBe(32)
  expect(states.size).toBeGreaterThan(5)   // the store really changed along the way
  expect(await foldAt(store, Infinity, kvStep('kv'))).toMatchObject({ entries: must(await app.call('main', 'kv').list({ prefix: [] })) })
  await app.close()
}, 30_000)

test.each(['fast', 'original'] as const)('the run replayed at %s pace gives the same messages', async pace => {
  const { app, store } = await run(1)
  const second = memoryStore()
  const { stop } = await record(app, second)
  const r = must(await replay(app, store, { pace }))
  await settle()
  stop()
  // The reset restarts every pod, so the replay holds the writer's startup `after`; compare from the first host input.
  const replayed = pair(await second.range()), begun = replayed.findIndex(m => m.sent.from === 'host')
  expect(diverge(pair(await store.range(r.from, r.to)), replayed.slice(begun))).toBeNull()
  await app.close()
})

/** A store filled by hand: the pod `kv` from config [a], then a put, a failed put, a delete to another pod, and two applies. */
function history(): MessageStore {
  const store = memoryStore()
  let seq = 0
  const add = (event: Recorded) => store.append({ seq: ++seq, at: seq, event })
  const d = (entries: KeyValueStoreDef.Entry[], eager = true): AppDeployment => ({ pods: { kv: { ...kvPod(entries), eager } }, runtimes: {} })
  const call = (id: string, to: string, op: 'put' | 'delete', input: unknown, ok = true) => {
    add({ type: 'sent', id, runtime: 'main', kind: 'call', from: 'host', to, port: port(api, api.ops[op]), correlation: id, input: JSON.stringify(input) })
    add({ type: 'delivered', id, ok, result: 'null', ms: 0 })
  }
  add({ type: 'deployment', deployment: d([{ key: ['a'], value: 1 }]), clean: true })
  call('1', 'kv', 'put', { key: ['b'], value: 2 })
  call('2', 'kv', 'put', { key: ['c'], value: 3 }, false)
  call('3', 'other', 'delete', ['a'])
  add({ type: 'deployment', deployment: d([{ key: ['a'], value: 1 }], false) })   // only eager changed: no reset
  call('4', 'kv', 'put', { key: ['a'], value: 5 })
  add({ type: 'deployment', deployment: d([{ key: ['z'], value: 0 }]) })   // the config changed: back to it
  return store
}

test('kvStep folds succeeded puts and deletes to its pod, and resets on an apply that changes its config', async () => {
  const store = history()
  expect((await foldAt(store, 1, kvStep('kv'))).entries).toEqual([{ key: ['a'], value: 1 }])
  expect((await foldAt(store, 8, kvStep('kv'))).entries).toEqual([{ key: ['a'], value: 1 }, { key: ['b'], value: 2 }])
  expect((await foldAt(store, 10, kvStep('kv'))).entries).toEqual([{ key: ['a'], value: 5 }, { key: ['b'], value: 2 }])
  expect((await foldAt(store, Infinity, kvStep('kv'))).entries).toEqual([{ key: ['z'], value: 0 }])
})
