// HostDeploy in the workspace; see host-deploy-setup.ts for the page, the served bundle and the base deployments.
import { expect, test } from 'bun:test'
import { Pod, type AppDeployment } from '@pritzlaff/nano-core'
import { lazy, node, base, three, answer } from './host-deploy-setup.ts'

const { log } = await import('@pritzlaff/nano-ui')
const { addTo, removeFrom, approvalPolicy } = await import('../src/host-deploy.ts')
const { summary } = await import('../src/deploy-summary.ts')

test('addTo adds pods and runtimes', () => {
  const d: AppDeployment = { pods: { messaging: lazy }, runtimes: { raft: { pods: ['messaging'], subscriptions: [] } } }
  const r = addTo(d, three)
  expect(r).toMatchObject({ ok: true })
  if (!r.ok) return
  expect(Object.keys(r.value.pods)).toEqual(['messaging', 'example-1-raft', 'example-2-raft', 'example-3-raft'])
  expect(r.value.runtimes['example-3']).toEqual(node(3))   // places the shared messaging, already there
  expect(d.runtimes['example-1']).toBeUndefined()            // pure
})

test('addTo refuses a name that exists, adding nothing', () => {
  const d = base(), r = addTo(d, three)
  expect(r).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
  if (!r.ok) expect(r.fail.reason).toContain('example-2')
  expect(d).toEqual(base())
  expect(addTo(d, { pods: { messaging: lazy }, runtimes: {} })).toMatchObject({ ok: false, fail: { type: 'invalid-input', reason: expect.stringContaining('messaging') } })
})

test('removeFrom drops the runtimes and the pods placed nowhere else, keeping shared ones', () => {
  const d = addTo({ pods: { messaging: lazy }, runtimes: { raft: { pods: ['messaging'], subscriptions: [] } } }, three)
  if (!d.ok) throw new Error(d.fail.reason)
  const r = removeFrom(d.value, { runtimes: ['example-1', 'example-2', 'example-3'] })
  expect(r).toEqual({ ok: true, value: { pods: { messaging: lazy }, runtimes: { raft: { pods: ['messaging'], subscriptions: [] } } } })
  expect(removeFrom(d.value, { runtimes: ['example-9'] })).toMatchObject({ ok: false, fail: { type: 'not-found', reason: expect.stringContaining('example-9') } })
})

test('addTo with overwrite replaces and adds, dropping the pods a replaced runtime no longer places; the summary says so', () => {
  const d = base(), r = addTo(d, { ...three, onConflict: 'overwrite' })
  expect(r).toMatchObject({ ok: true })
  if (!r.ok) return
  expect(Object.keys(r.value.runtimes).sort()).toEqual(['example-1', 'example-2', 'example-3', 'raft'])
  expect(summary(d, r.value)).toBe('Create runtimes example-1, example-3 (2 pods); places messaging')   // example-2 comes back the same
  const swap = addTo(d, { pods: { n: Pod.eager(log) }, runtimes: { 'example-2': { pods: ['messaging', 'n'], subscriptions: [] } }, onConflict: 'overwrite' })
  if (!swap.ok) throw new Error(swap.fail.reason)
  expect(swap.value.pods['example-2-raft']).toBeUndefined()
  expect(swap.value.runtimes['example-2']).toEqual({ pods: ['messaging', 'n'], subscriptions: [] })
  expect(summary(d, swap.value)).toBe('Replace runtime example-2; add 1 pod; drops example-2-raft')
  const both = addTo(d, { pods: { 'example-2-raft': Pod.eager(log), 'example-1-raft': lazy }, runtimes: { 'example-1': node(1), 'example-2': { pods: ['example-2-raft'], subscriptions: [] } }, onConflict: 'overwrite' })
  if (!both.ok) throw new Error(both.fail.reason)
  expect(summary(d, both.value)).toBe('Replace runtime example-2; replace pod example-2-raft; create runtime example-1 (1 pod); places messaging')
  expect(addTo(d, { ...three, onConflict: 'error' })).toMatchObject({ ok: false, fail: { type: 'invalid-input', reason: expect.stringContaining('example-2') } })
})

test('approvalPolicy allows host, asks for pods, and a no denies', async () => {
  const asked: string[] = [], answers = [true, false]
  const current: AppDeployment = { pods: {}, runtimes: {} }
  const next: AppDeployment = { pods: { a: lazy }, runtimes: { r: { pods: ['a'], subscriptions: [] } } }
  const p = approvalPolicy(async text => { asked.push(text); return answers.shift()! }, () => current)
  expect(await p.isAllowed({ caller: 'host', deployment: next })).toEqual({ approved: true })
  expect(asked).toEqual([])
  expect(await p.isAllowed({ caller: 'deploy', deployment: next })).toEqual({ approved: true })
  expect(await p.isAllowed({ caller: 'deploy', deployment: next })).toMatchObject({ approved: false, reason: expect.stringContaining('Create runtime r') })
  expect(asked).toEqual(['Create runtime r (1 pod)', 'Create runtime r (1 pod)'])
})

test('approvalPolicy takes no answer within its time as a no', async () => {
  const p = approvalPolicy(() => new Promise<boolean>(() => {}), () => ({ pods: {}, runtimes: {} }), 20)
  const at = Date.now()
  expect(await p.isAllowed({ caller: 'deploy', deployment: { pods: {}, runtimes: { r: { pods: [], subscriptions: [] } } } })).toMatchObject({ approved: false })
  expect(Date.now() - at).toBeLessThan(1000)
})

test('the host pods, and a runtime placing one, are never overwritten or removed', () => {
  const d: AppDeployment = { pods: { ui: lazy, deploy: lazy, x: lazy }, runtimes: { main: { pods: ['ui', 'deploy'], subscriptions: [] }, side: { pods: ['x', 'deploy'], subscriptions: [] } } }
  const refused = (r: { ok: boolean }, name: string) => expect(r).toMatchObject({ ok: false, fail: { type: 'invalid-input', reason: expect.stringContaining(name) } })
  refused(addTo(d, { pods: {}, runtimes: { main: { pods: ['ui', 'deploy'], subscriptions: [] } }, onConflict: 'overwrite' }), 'main')
  refused(addTo(d, { pods: {}, runtimes: { side: { pods: ['x'], subscriptions: [] } }, onConflict: 'overwrite' }), 'side')
  refused(addTo(d, { pods: { deploy: lazy }, runtimes: {}, onConflict: 'overwrite' }), 'deploy')
  refused(addTo(d, { pods: { ui: lazy }, runtimes: {}, onConflict: 'overwrite' }), 'ui')
  refused(removeFrom(d, { runtimes: ['main'] }), 'main')
  refused(removeFrom(d, { runtimes: ['side'] }), 'side')
  expect(addTo(d, { pods: { x: Pod.eager(log) }, runtimes: {}, onConflict: 'overwrite' })).toMatchObject({ ok: true })
  refused(addTo(d, { pods: {}, runtimes: { fresh: { pods: ['x', 'deploy'], subscriptions: [] } } }), 'deploy')   // a pod never places a host pod
  const plain = { ...d, runtimes: { ...d.runtimes, plain: { pods: ['x'], subscriptions: [] } } }
  refused(addTo(plain, { pods: {}, runtimes: { plain: { pods: ['x', 'ui'], subscriptions: [] } }, onConflict: 'overwrite' }), 'ui')
})
