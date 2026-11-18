import { expect, test } from 'bun:test'
import { Application, AppDeployment, Coord, Implementation, Op, Registry, Schema, provide, success } from '@pritzlaff/nano-core'
import uiProvider, { Clock, Random } from '@pritzlaff/nano-ui'
import { Type } from 'typebox'
import { pair } from '../../src/recorder/entry.ts'
import { memoryStore } from '../../src/recorder/memory-store.ts'
import { record } from '../../src/recorder/record.ts'
import { diverge, replay } from '../../src/recorder/replay.ts'
import { log, must, settle } from './typing.ts'

const ns = Coord.namespace('test')
const Jitter = ns.interface('Jitter', { drawn: Op.event(Schema.define(Type.Number(), 'Drawn')) })
/** When its timer fires it draws a random, publishes it as `drawn`, and re-arms the timer 10 to 49 ms out, reacting only to the id `after` returned. */
const jitter = Implementation.define(ns.implementationId('jitter'), {
  provides: [Jitter],
  dependencies: { clock: Clock, random: Random },
  make: ctx => {
    const clock = must(ctx.one(Clock)), random = must(ctx.one(Random))
    let mine: unknown
    clock.on(Clock.ops.fired, async e => {
      if (e.output.id !== mine) return
      const r = must(await random.call.next(null))
      void ctx.publish(Jitter.ops.drawn, r)
      mine = must(await clock.call.after({ ms: 10 + Math.floor(r * 40) }))
    })
    void clock.call.after({ ms: 10 }).then(r => { mine = must(r) })
    return [provide(Jitter, {})]
  },
})

async function jitterApp(order = ['sim', 'rng', 'jitter', 'log']): Promise<Application> {
  const registry = Registry.create()
  must(registry.add(uiProvider))
  must(registry.add(ns.provider([jitter])))
  const pod = (implementation: string, config?: unknown) => ({ implementation, config, eager: true })
  return must(await Application.create(must(AppDeployment.assemble({
    pods: Object.fromEntries(order.map(n => [n, { sim: pod('nano.ui/sim-clock'), rng: pod('nano.ui/seeded-random', { seed: 7 }), jitter: pod('test/jitter'), log: pod('nano.ui/log') }[n]!])),
    runtimes: { main: { pods: order, subscriptions: [
      { kind: 'call', from: 'jitter', to: 'sim' },
      { kind: 'call', from: 'jitter', to: 'rng' },
      { kind: 'pipe', from: 'jitter', source: 'test.Jitter/drawn', to: 'log', target: 'nano.ui.Log/log' },
    ] } },
  }, registry)), {}))
}

test.each([['providers first', ['sim', 'rng', 'jitter', 'log']], ['dependent listed first', ['jitter', 'rng', 'sim', 'log']]])('seeded randomness on a sim clock replays exactly, fast (%s)', async (_, order) => {
  const app = await jitterApp(order)
  const first = memoryStore()
  const stop = await record(app, first, { clean: true })
  await settle()   // the startup `after` has answered, so jitter holds its timer id
  for (let i = 0; i < 5; i++) { await app.call('main', 'sim').advance(100); await settle() }
  const drawn = await log(app)
  expect(drawn.ok && (drawn.value as unknown[]).length).toBeGreaterThan(0)
  stop()
  const second = memoryStore()
  const stop2 = await record(app, second)
  const r = must(await replay(app, first, { pace: 'fast' }))
  await settle()
  stop2()
  expect(await log(app)).toEqual(drawn)
  // The reset restarts every pod, so the replay holds jitter's startup `after`; the recording began after it. Compare from the first host input.
  const replayed = pair(await second.range()), begun = replayed.findIndex(m => m.sent.from === 'host')
  expect(diverge(pair(await first.range(r.from, r.to)), replayed.slice(begun))).toBeNull()
})
