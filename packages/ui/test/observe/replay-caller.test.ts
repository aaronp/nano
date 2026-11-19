import { expect, test } from 'bun:test'
import { Application, AppDeployment, Coord, Implementation, Op, Registry, Schema, provide, success } from '@pritzlaff/nano-core'
import { Type } from 'typebox'
import { pair } from '../../src/observe/entry.ts'
import { memoryStore } from '../../src/observe/memory-store.ts'
import { record } from '../../src/observe/record.ts'
import { diverge, replay } from '../../src/observe/replay.ts'
import { must, settle } from './typing.ts'

const ns = Coord.namespace('test')
const Grow = ns.interface('Grow', { grow: Op.action(Schema.define(Type.String(), 'Name'), Schema.define(Type.Null(), 'Nothing')) })
let app: Application   // the grower holds the app through this, set after create
/** `grow(name)` applies the current deployment plus an empty runtime `name`, as the pod `grower`. */
const grower = Implementation.define(ns.implementationId('grower'), {
  provides: [Grow],
  make: () => [provide(Grow, {
    grow: async name => {
      const d = app.deployment()
      must(await app.apply({ ...d, runtimes: { ...d.runtimes, [name]: { pods: [], subscriptions: [] } } }, { caller: 'grower' }))
      return success(null)
    },
  })],
})

async function make(): Promise<Application> {
  const registry = Registry.create()
  must(registry.add(ns.provider([grower])))
  app = must(await Application.create(must(AppDeployment.assemble({
    pods: { grower: { implementation: 'test/grower', eager: true } },
    runtimes: { main: { pods: ['grower'], subscriptions: [] } },
  }, registry)), {}))
  return app
}

const runtimes = () => Object.keys(app.deployment().runtimes).filter(r => r === 'r1')

test("a pod's apply is recorded with its caller", async () => {
  await make()
  const store = memoryStore()
  const { stop } = await record(app, store, { clean: true })
  must(await app.call('main', 'grower').grow('r1'))
  await settle()
  stop()
  const deployments = (await store.range()).flatMap(e => e.event.type === 'deployment' ? [e.event] : [])
  expect(deployments.map(d => d.caller)).toEqual([undefined, 'grower'])
})

test.each(['fast', 'original'] as const)('replay applies a pod\'s apply once, at %s pace', async pace => {
  await make()
  const first = memoryStore()
  const { stop } = await record(app, first, { clean: true })
  must(await app.call('main', 'grower').grow('r1'))
  await settle()
  stop()
  const second = memoryStore()
  const { stop: stop2 } = await record(app, second)
  const r = must(await replay(app, first, { pace }))
  await settle()
  stop2()
  expect(r.failed).toBe(0)
  expect(r.applied).toBe(0)
  expect(runtimes()).toEqual(['r1'])
  expect(diverge(pair(await first.range(r.from, r.to)), pair(await second.range()))).toBeNull()
})
