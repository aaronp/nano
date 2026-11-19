// HostDeploy in the workspace; see host-deploy-setup.ts for the page, the served bundle and the base deployments.
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { type AppDeployment } from '@pritzlaff/nano-core'
import { installFetch, restoreFetch, tick, lazy, node, answer } from './host-deploy-setup.ts'

beforeAll(installFetch)
afterAll(restoreFetch)
const { log } = await import('@pritzlaff/nano-ui')
const { start } = await import('../src/host.ts')

test('given a pod needing HostDeploy imported, then it is connected to deploy and its deploy asks: yes adds, no changes nothing', async () => {
  const r = await start()
  if (!r.ok) throw new Error(r.fail.reason)
  const host = r.value
  expect(await host.importUrl(new URL('./fixtures/deploy/app.json', import.meta.url).href)).toMatchObject({ ok: true })
  expect(host.app.deployment().runtimes['main']!.subscriptions).toContainEqual({ kind: 'call', from: 'cluster', to: 'deploy' })
  expect(host.saved().pods['deploy']).toBeUndefined()

  const add = { pods: { n1: lazy }, runtimes: { 'node-1': { pods: ['n1'], subscriptions: [] } } }
  const denied = host.app.call('ops', 'cluster').map(add)
  await answer('Deny')
  expect(await denied).toMatchObject({ ok: false, fail: { type: 'denied' } })
  expect(host.app.deployment().runtimes['node-1']).toBeUndefined()

  const approved = host.app.call('ops', 'cluster').map(add)
  await answer('Approve')
  expect(await approved).toEqual({ ok: true, value: null })
  expect(host.app.deployment().runtimes['node-1']).toEqual({ pods: ['n1'], subscriptions: [] })
  await tick(10)
  const applied = (await host.history.store.range()).map(e => e.event).filter(e => e.type === 'deployment')
  expect(applied.at(-1)).toMatchObject({ caller: 'deploy', deployment: { runtimes: { 'node-1': {} } } })
  expect(await host.app.call('ops', 'cluster').map({ pods: {}, runtimes: { 'node-1': { pods: [], subscriptions: [] } } })).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })

  const swapped = host.app.call('ops', 'cluster').map({ pods: { n2: lazy }, runtimes: { 'node-1': { pods: ['n2'], subscriptions: [] } }, onConflict: 'overwrite' })
  await answer('Approve', 'Replace runtime node-1; add 1 pod; drops n1')
  expect(await swapped).toEqual({ ok: true, value: null })
  expect(host.app.deployment().runtimes['node-1']).toEqual({ pods: ['n2'], subscriptions: [] })
  expect(host.app.deployment().pods['n1']).toBeUndefined()

  const node = (i: number) => ({ pods: { [`n${i}`]: lazy }, runtimes: { [`node-${i}`]: { pods: [`n${i}`], subscriptions: [] } } })
  const first = host.app.call('ops', 'cluster').map(node(3))
  for (let i = 0; i < 100 && !document.querySelector('dialog'); i++) await tick(5)   // its ask is open
  expect(await host.app.call('ops', 'cluster').map(node(4))).toMatchObject({ ok: false, fail: { type: 'invalid-input', reason: 'a deployment is already waiting for approval' } })
  await answer('Approve', 'Create runtime node-3 (1 pod)')
  expect(await first).toEqual({ ok: true, value: null })
  expect(Object.keys(host.app.deployment().runtimes)).toEqual(expect.arrayContaining(['node-1', 'node-3']))
  expect(host.app.deployment().runtimes['node-4']).toBeUndefined()
})

test('undeploy through the host: approved removes the runtimes and drops their pods; denied changes nothing; history says caller deploy', async () => {
  const r = await start()
  if (!r.ok) throw new Error(r.fail.reason)
  const host = r.value
  expect(await host.importUrl(new URL('./fixtures/deploy/app.json', import.meta.url).href)).toMatchObject({ ok: true })
  const added = host.app.call('ops', 'cluster').map({ pods: { n1: lazy }, runtimes: { 'node-1': { pods: ['n1'], subscriptions: [] } } })
  await answer('Approve'); expect(await added).toEqual({ ok: true, value: null })
  const undeploy = () => (host.app.call('main', 'deploy') as unknown as { undeploy(r: { runtimes: string[] }): Promise<unknown> }).undeploy({ runtimes: ['node-1'] })

  const denied = undeploy()
  await answer('Deny', 'Remove runtime node-1')
  expect(await denied).toMatchObject({ ok: false, fail: { type: 'denied' } })
  expect(host.app.deployment().runtimes['node-1']).toBeDefined()

  const approved = undeploy()
  await answer('Approve', 'Remove runtime node-1; drops n1')
  expect(await approved).toEqual({ ok: true, value: null })
  expect(host.app.deployment().runtimes['node-1']).toBeUndefined()
  expect(host.app.deployment().pods['n1']).toBeUndefined()
  await tick(10)
  const applied = (await host.history.store.range()).map(e => e.event).filter(e => e.type === 'deployment')
  expect(applied.at(-1)).toMatchObject({ caller: 'deploy' })
  expect(Object.keys((applied.at(-1) as { deployment: AppDeployment }).deployment.runtimes)).not.toContain('node-1')
})
