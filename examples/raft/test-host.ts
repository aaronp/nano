/**
 * Test-only: a `HostDeploy` holding the app (the workspace's own lives in ui-workspace, which examples don't import),
 * and the `raft` runtime of nano.json opened with it, as importing it into a host does: `deploy` placed beside the
 * cluster and wired to it, the deployment policy `allowAll`.
 *
 *   const app = await openRaft()
 *   await app.call('raft', 'cluster').create({ name: 'example', size: 3, seed: 1 })
 *   await shadowAt(store, t, createRaft)   // the app as of t, its `deploy` bound to the shadow
 */
import { Application, AppDeployment, Coord, DeploymentPolicies, Implementation, Pod, Registry, failure, provide, success, type NanoResult } from '@pritzlaff/nano-core'
import uiProvider, { HostDeploy, memoryStore, record } from '@pritzlaff/nano-ui'
import type { Node } from './core/types.ts'
import raft from './index.ts'

const ns = Coord.namespace('example.raft.test')
const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }

/** Adds pods and runtimes (a name already there is invalid-input); removes runtimes (an unknown one is not-found) and the pods placed nowhere else. */
function testDeploy(app: () => Application) {
  return Implementation.define(ns.implementationId('deploy'), {
    provides: [HostDeploy],
    make: ctx => {
      const apply = async (next: AppDeployment): Promise<NanoResult<null>> => {
        const r = await app().apply(next, { caller: ctx.self })
        return r.ok ? success(null) : r
      }
      return [provide(HostDeploy, {
        deploy: async ({ pods, runtimes }) => {
          const d = app().deployment()
          const taken = [...Object.keys(pods).filter(p => p in d.pods), ...Object.keys(runtimes).filter(r => r in d.runtimes)]
          if (taken.length) return failure('invalid-input', `already in the deployment: ${taken.join(', ')}`)
          return apply({ ...d, pods: { ...d.pods, ...pods }, runtimes: { ...d.runtimes, ...runtimes } } as AppDeployment)
        },
        undeploy: async ({ runtimes }) => {
          const d = structuredClone(app().deployment()), missing = runtimes.find(r => !(r in d.runtimes))
          if (missing !== undefined) return failure('not-found', `no runtime ${missing}`)   // as the workspace's: nothing removed
          for (const r of runtimes) delete d.runtimes[r]
          const placed = new Set(Object.values(d.runtimes).flatMap(r => r.pods))
          for (const p of Object.keys(d.pods)) if (!placed.has(p)) delete d.pods[p]
          return apply(d)
        },
      })]
    },
  })
}

/** An app of `d` whose test `deploy` acts on that app itself, never another: openRaft's, and a shadow's (`shadowAt`). */
export async function createRaft(d: AppDeployment): Promise<NanoResult<Application>> {
  let app: Application | undefined
  const registry = Registry.create()
  for (const p of [uiProvider, raft, ns.provider([testDeploy(() => app!)])]) must(registry.add(p))
  const made = await Application.create(must(AppDeployment.assemble(d, registry)), { deploymentPolicy: DeploymentPolicies.allowAll() })
  if (made.ok) app = made.value
  return made
}

/** The `raft` runtime with the test host's `deploy`; a fresh registry and app each time. */
export async function openRaft(): Promise<Application> {
  const doc = await Bun.file(new URL('./nano.json', import.meta.url)).json() as AppDeployment
  const main = doc.runtimes.raft!
  const d = { pods: { ...doc.pods, deploy: Pod.lazy(testDeploy(() => { throw new Error('a placeholder') })) }, runtimes: { raft: {
    ...main, pods: [...main.pods, 'deploy'], subscriptions: [...main.subscriptions, { kind: 'call' as const, from: 'cluster', to: 'deploy' }] } } }
  return must(await createRaft(d))
}

const settle = () => new Promise(r => setTimeout(r, 0))
export const ids = ['example-1', 'example-2', 'example-3']

/**
 * The case study's recorded run, from a clean start: create `example` with `seed`; advance until a leader; two
 * requests; stop the leader, advance, resume it, restart a follower; one request. `at` moves 10 per host input, so
 * every boundary is a quiet point; after each `advance` the host reads every node's `status` (same `at`), which is
 * how the history holds each node's state (`changed` is recorded only while someone listens).
 */
export async function recordedRun(seed: number) {
  const app = await openRaft(), store = memoryStore()
  let now = 0
  const { stop } = await record(app, store, { clean: true, now: () => now })
  const input = async <T>(f: () => Promise<NanoResult<T>>) => { now += 10; const r = must(await f()); await settle(); return r }
  const node = (id: string) => app.call(id, `${id}-raft`)
  const statuses = async () => Promise.all(ids.map(async id => must(await node(id).status(null)) as Node))
  const leader = async () => (await statuses()).find(n => n.role === 'leader' && !n.stopped)?.id
  const advance = async (ms: number) => { for (let t = 0; t < ms; t += 100) { await input(() => app.call('raft', 'raft-clock').advance(100)); await statuses() } }
  const until = async () => { for (let i = 0; i < 30; i++) { const l = await leader(); if (l) return l; await advance(100) } throw new Error('no leader') }

  await input(() => app.call('raft', 'cluster').create({ name: 'example', size: 3, seed }))
  await statuses()
  const first = await until()
  for (const value of ['a', 'b']) { await input(() => node(first).request(value)); await advance(200) }
  await input(() => node(first).stop(null)); await advance(1000)
  const second = await until()
  await input(() => node(first).resume(null)); await advance(200)
  await input(() => node(ids.find(id => id !== second && id !== first)!).restart(null)); await advance(200)
  const third = await until()
  await input(() => node(third).request('c')); await advance(200)
  stop()
  return { app, store, statuses }
}
