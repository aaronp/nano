import { expect, test } from 'bun:test'
import { Application, AppDeployment, Registry, success } from '@pritzlaff/nano-core'
import uiProvider from '../../src/index.ts'
import { memoryStore } from '../../src/observe/memory-store.ts'
import { record } from '../../src/observe/record.ts'
import { shadowAt } from '../../src/observe/shadow.ts'
import { must, settle } from './typing.ts'

const registry = Registry.create()
must(registry.add(uiProvider))
const create = (d: AppDeployment) => Application.create(must(AppDeployment.assemble(d, registry)), {})
const log = { implementation: 'nano.ui/log', eager: true }

/** Two log pods, `ui` (standing in for the host's own pod) and `log`, each called by the host at times 1, 2 and 3. */
async function twoLogs(store = memoryStore()) {
  const app = must(await create({ pods: { ui: log, log }, runtimes: { main: { pods: ['ui', 'log'], subscriptions: [] } } }))
  let now = 0
  const { stop } = await record(app, store, { clean: true, now: () => now })
  for (const x of ['a', 'b', 'c']) {
    now++
    await app.call('main', 'ui').log(x)
    await app.call('main', 'log').log(x)
    await settle()
  }
  stop()
  await app.close()
  return store
}

test('shadowAt rebuilds the app as of t, without the ui pod or the inputs to it', async () => {
  const store = await twoLogs()
  const shadow = must(await shadowAt(store, 2, create))
  expect(Object.keys(shadow.deployment().pods)).toEqual(['log'])
  expect(await shadow.call('main', 'log').entries(null)).toEqual(success(['a', 'b']))
  await shadow.close()
})

test('shadowAt keeps the pod opts.host names otherwise', async () => {
  const shadow = must(await shadowAt(await twoLogs(), 3, create, { host: 'log' }))
  expect(await shadow.call('main', 'ui').entries(null)).toEqual(success(['a', 'b', 'c']))
  expect(shadow.deployment().pods['log']).toBeUndefined()
  await shadow.close()
})

test('shadowAt refuses when the clean start is gone, building nothing', async () => {
  let built = 0
  const r = await shadowAt(await twoLogs(memoryStore({ max: 5 })), 3, d => { built++; return create(d) })
  expect(r.ok || r.fail.type).toBe('not-found')
  expect(built).toBe(0)
})
