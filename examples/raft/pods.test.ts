/**
 * The Raft pods on a sim clock, driven by `advance`: the `raft` runtime of nano.json with a test `HostDeploy`, and a
 * cluster `example` of 3 nodes created through it, as the management view does.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { Application, AppDeployment, Coord, Implementation, Registry, failure, provide, success, type AppEvent } from '@pritzlaff/nano-core'
import uiProvider, { foldAt, memoryStore, record } from '@pritzlaff/nano-ui'
import type { Node, Persistent } from './core/types.ts'
import { clusterDeployment } from './deployment.ts'
import { ledgerStep } from './fold.ts'
import raft from './index.ts'
import { Ledger } from './interfaces.ts'
import { advance, ids, leaders, must, node, openRaft, settle, status, statuses } from './test-host.ts'

const read = async (app: Application, id: string) => must(await app.call(id, `${id}-ledger`).read(null)) as Persistent

let app: Application
afterEach(async () => { await app?.close() })

async function cluster(seed = 1) {
  app = await openRaft()
  must(await app.call('raft', 'cluster').create({ name: 'example', size: 3, seed }))
  await advance(app, 1000)
  return app
}

describe('a cluster of 3 on the sim clock', () => {
  test.each([1, 2, 3, 4, 5])('a leader is elected for seed %d', async seed => {
    await cluster(seed)
    const [l] = await leaders(app)
    expect(await leaders(app)).toHaveLength(1)
    expect((await statuses(app)).map(n => n.leader)).toEqual(ids.map(() => l!.id))
    expect(must(await app.call('raft', 'cluster').list(null))).toEqual(['example'])
  })

  test('request commits on every ledger; a follower refuses, naming the leader', async () => {
    await cluster()
    const [l] = await leaders(app), follower = ids.find(id => id !== l!.id)!
    expect(await node(app, follower).request('no')).toMatchObject({ ok: false, fail: { type: 'invalid-input', reason: expect.stringContaining(l!.id) } })
    must(await node(app, l!.id).request('x'))
    await advance(app, 200)
    for (const id of ids) expect((await read(app, id)).log.map(e => e.value)).toEqual(['x'])
    expect((await statuses(app)).map(n => n.commitIndex)).toEqual([1, 1, 1])
  })

  test('stop / resume / restart / time-out act as in Task 5', async () => {
    await cluster()
    const [old] = await leaders(app)
    must(await node(app, old!.id).stop(null))
    expect(await node(app, old!.id).request('x')).toMatchObject({ ok: false, fail: { type: 'invalid-input', reason: expect.stringContaining('stopped') } })
    await advance(app, 1000)
    const [now] = await leaders(app)
    expect(now!.id).not.toBe(old!.id)
    expect(now!.p.currentTerm).toBeGreaterThan(old!.p.currentTerm)
    must(await node(app, old!.id).resume(null))
    await advance(app, 200)
    expect(await status(app, old!.id)).toMatchObject({ role: 'follower', stopped: false, leader: now!.id, p: { currentTerm: now!.p.currentTerm } })
    // time out: a follower starts an election at once, in a new term
    const f = ids.find(id => id !== now!.id)!, term = (await status(app, f)).p.currentTerm
    must(await node(app, f).timeOut(null))
    expect(await status(app, f)).toMatchObject({ role: 'candidate', p: { currentTerm: term + 1, votedFor: f } })
    await advance(app, 1000)
    expect(await leaders(app)).toHaveLength(1)
    // restart: a follower drops its memory and reloads term, vote and log from its ledger
    const [l] = await leaders(app), g = ids.find(id => id !== l!.id)!
    must(await node(app, l!.id).request('y'))
    await advance(app, 200)
    must(await node(app, g).restart(null))
    expect(await status(app, g)).toMatchObject({ role: 'follower', commitIndex: 0, leader: null, p: await read(app, g) })
  })

  test('remove() with messages in flight: dropped, no failure, no throw', async () => {
    await cluster()
    const events: AppEvent[] = [], rejections: unknown[] = []
    const onRejection = (e: unknown) => rejections.push(e)
    process.on('unhandledRejection', onRejection)
    app.listen(e => events.push(e))
    await advance(app, 15)   // heartbeats are on their way
    must(await app.call('raft', 'cluster').remove({ name: 'example' }))
    const removed = events.length
    await advance(app, 500)
    process.off('unhandledRejection', onRejection)
    expect(Object.keys(app.deployment().runtimes)).toEqual(['raft'])
    expect(must(await app.call('raft', 'cluster').list(null))).toEqual([])
    const after = events.slice(removed)
    expect(after.filter(e => e.type === 'failure' || e.type === 'warning')).toEqual([])
    expect(after.filter(e => e.type === 'sent' && e.to.startsWith('example-'))).toEqual([])
    expect(after.some(e => e.type === 'sent' && e.port.endsWith('/fired'))).toBe(true)   // messages were in flight
    expect(rejections).toEqual([])
  })

  test('ledgerStep folds a node\'s ledger to equal Ledger.read', async () => {
    app = await openRaft()
    const store = memoryStore()
    const { stop } = await record(app, store, { clean: true })
    must(await app.call('raft', 'cluster').create({ name: 'example', size: 3, seed: 2 }))
    await advance(app, 1000)
    const [l] = await leaders(app)
    must(await node(app, l!.id).request('a'))
    await advance(app, 200)
    stop()
    for (const id of ids) {
      const held = await read(app, id)
      expect(held.log).toHaveLength(1)
      expect(await foldAt(store, Infinity, ledgerStep(`${id}-ledger`))).toEqual(held)
    }
    expect(await foldAt(store, -1, ledgerStep('example-1-ledger'))).toBeUndefined()
  })

  test('after the cluster pod restarts (its memory gone), remove still removes the cluster', async () => {
    await cluster()
    await app.restart('cluster')
    expect(must(await app.call('raft', 'cluster').list(null))).toEqual([])
    must(await app.call('raft', 'cluster').remove({ name: 'example' }))
    expect(Object.keys(app.deployment().runtimes)).toEqual(['raft'])
    expect(await app.call('raft', 'cluster').remove({ name: 'example' })).toMatchObject({ ok: false, fail: { type: 'not-found' } })
  })
})

test('a failed effect (the ledger refuses a write) still re-arms the node\'s timer: it keeps trying', async () => {
  let writes = 0
  const broken = Implementation.define(Coord.namespace('example.raft.test').implementationId('broken-ledger'), { provides: [Ledger], make: () => [provide(Ledger, {
    read: async () => success({ currentTerm: 0, votedFor: null, log: [] }), write: async () => { writes++; return failure('invalid-input', 'disk full') } })] })
  const registry = Registry.create()
  for (const p of [uiProvider, raft, Coord.namespace('example.raft.test').provider([broken])]) must(registry.add(p))
  const doc = await Bun.file(new URL('./nano.json', import.meta.url)).json() as AppDeployment, c = clusterDeployment('example', 3, 1)
  const { cluster: _, ...shared } = doc.pods   // a lone node (its peers never deployed), its ledger broken
  const d: AppDeployment = { pods: { ...shared, ...c.pods, 'example-1-ledger': { implementation: 'example.raft.test/broken-ledger', eager: true } },
    runtimes: { raft: { ...doc.runtimes.raft!, pods: doc.runtimes.raft!.pods.filter(p => p !== 'cluster') }, 'example-1': c.runtimes['example-1']! } }
  for (const id of ['example-2', 'example-3']) for (const k of ['raft', 'ledger', 'random']) delete d.pods[`${id}-${k}`]
  app = must(await Application.create(must(AppDeployment.assemble(d, registry)), {}))
  await advance(app, 2000)   // several election timeouts: each a candidacy whose persist fails
  expect(writes).toBeGreaterThan(1)
})

describe('seconds-scale timing', () => {
  test('a node built with it has its election alarm 3000-6000 ms after start', async () => {
    const timing = { electionMin: 3000, electionMax: 6000, heartbeat: 1000 }
    app = await openRaft()
    const d = clusterDeployment('s', 3, 1, timing)
    must(await app.apply({ ...app.deployment(), pods: { ...app.deployment().pods, ...d.pods }, runtimes: { ...app.deployment().runtimes, ...d.runtimes } } as AppDeployment, { caller: 'host' }))
    await settle()
    const n = await status(app, 's-1')
    expect(n.electionAlarm).toBeGreaterThanOrEqual(3000)
    expect(n.electionAlarm).toBeLessThanOrEqual(6000)
  })
})
