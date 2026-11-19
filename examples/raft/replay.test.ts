/**
 * A recorded cluster replays exactly: the same messages come out, at either pace, for five seeds. The cluster was
 * created by a pod (`cluster` through the host's `deploy`), so its deployment entry is the pod's: replay re-sends the
 * host's `cluster.create` and lets it deploy again, rather than also applying the entry.
 */
import { expect, test } from 'bun:test'
import { port } from '@pritzlaff/nano-core'
import { HostDeploy, diverge, memoryStore, pair, record, replay } from '@pritzlaff/nano-ui'
import { ids, must, recordedRun, settle } from './test-host.ts'

const DEPLOY = port(HostDeploy, HostDeploy.ops.deploy)

const cases = [1, 2, 3, 4, 5].flatMap(seed => (['fast', 'original'] as const).map(pace => [seed, pace] as const))

test.each(cases)('replayed fast and original: diverge is null, the cluster is created once (seed %d, %s)', async (seed, pace) => {
  const { app, store } = await recordedRun(seed)
  const second = memoryStore()
  const { stop } = await record(app, second)
  const r = must(await replay(app, store, { pace }))
  await settle()
  stop()
  expect(r).toMatchObject({ failed: 0, applied: 0 })   // the pod's deployment entry is not applied again
  const replayed = pair(await second.range()), begun = replayed.findIndex(m => m.sent.from === 'host')
  expect(diverge(pair(await store.range(r.from, r.to)), replayed.slice(begun))).toBeNull()
  expect(replayed.filter(m => m.sent.port === DEPLOY)).toHaveLength(1)
  expect((await second.range()).filter(e => e.event.type === 'applied')).toHaveLength(2)   // the reset, then the cluster
  expect(Object.keys(app.deployment().runtimes)).toEqual(['raft', ...ids])
  expect(must(await app.call('raft', 'cluster').list(null))).toEqual(['example'])
  await app.close()
}, 30_000)
