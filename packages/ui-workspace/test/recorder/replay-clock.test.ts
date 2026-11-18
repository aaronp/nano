import { expect, test } from 'bun:test'
import { Coord, Implementation, provide, success, type Application } from '@pritzlaff/nano-core'
import { Log } from '@pritzlaff/nano-ui'
import { pair } from '../../src/recorder/entry.ts'
import { memoryStore } from '../../src/recorder/memory-store.ts'
import { record } from '../../src/recorder/record.ts'
import { diverge, replay } from '../../src/recorder/replay.ts'
import { log, must, settle, sleep, typingSim } from './typing.ts'

/**
 * h, hi, a second passes, hey, a second passes, on the sim clock: the log is HI, HEY. Like any host it lets each input's
 * pipes land before the next (an awaited call doesn't wait for them). Stopped `ms` of real time after.
 */
async function recordTyping(app: Application, ms = 0) {
  const store = memoryStore()
  const stop = await record(app, store, { clean: true })
  const input = app.call('main', 'input'), clock = app.call('main', 'clock')
  for (const step of [() => input.change('h'), () => input.change('hi'), () => clock.advance(1000), () => input.change('hey'), () => clock.advance(1000)]) {
    await step()
    await settle()
  }
  await sleep(ms)
  stop()
  return store
}

/** Replays `first` into a new store, settling before it stops recording; the replay's result and how long it took. */
async function replayInto(app: Application, first: ReturnType<typeof memoryStore>, pace: 'original' | 'fast') {
  const second = memoryStore()
  const stop = await record(app, second)
  const t0 = performance.now()
  const r = must(await replay(app, first, { pace }))
  const ms = performance.now() - t0
  await settle()
  stop()
  return { r, ms, same: diverge(pair(await first.range(r.from, r.to)), pair(await second.range())), second }
}

test('typing on a sim clock, replayed fast, is exact', async () => {
  const app = await typingSim()
  const first = await recordTyping(app)
  expect(await log(app)).toEqual(success(['HI', 'HEY']))
  const { r, same } = await replayInto(app, first, 'fast')
  expect(r).toMatchObject({ sent: 5, failed: 0 })
  expect(await log(app)).toEqual(success(['HI', 'HEY']))
  expect(same).toBeNull()
})

test('fast replay is quick', async () => {
  const app = await typingSim()
  const first = await recordTyping(app)
  await sleep(300)   // the recording spans real time too: fast replay must not keep to it
  const { ms } = await replayInto(app, first, 'fast')
  expect(ms).toBeLessThan(200)
})

test('the same recording replayed at original pace is exact too', async () => {
  const app = await typingSim()
  const first = await recordTyping(app)
  const { same } = await replayInto(app, first, 'original')
  expect(await log(app)).toEqual(success(['HI', 'HEY']))
  expect(same).toBeNull()
})

const ns = Coord.namespace('test')
const hangLog = Implementation.define(ns.implementationId('hang-log'), {
  provides: [Log],
  make: () => [provide(Log, { log: () => new Promise(() => {}), entries: async () => success([]), clear: async () => success(null) })],
})

test('quiet is bounded: a log that never answers times out and replay goes on', async () => {
  const timeoutMs = 100
  const app = await typingSim({ log: 'test/hang-log', provider: ns.provider([hangLog]), timeoutMs })
  const first = await recordTyping(app, timeoutMs + 50)   // the hung log deliveries time out in the recording too
  const { r, ms, same, second } = await replayInto(app, first, 'fast')
  expect(ms).toBeLessThan(timeoutMs + 1000)
  expect(r).toMatchObject({ sent: 5, failed: 0 })   // every root answered; the hang was a pipe's
  const hung = pair(await second.range()).filter(m => m.sent.to === 'log')
  expect(hung.map(m => m.outcome?.type === 'delivered' && m.outcome.ok)).toEqual([false, false])   // timed out, not lost
  expect(same).toBeNull()
})
