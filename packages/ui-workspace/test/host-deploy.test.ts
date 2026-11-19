// HostDeploy in the workspace: the pure addTo and removeFrom, the approval policy, and a pod deploying a
// runtime through the host's `deploy` pod, approved or denied in the host's dialog.
import { GlobalRegistrator } from '@happy-dom/global-registrator'
const page = new URL('../../../', import.meta.url).href
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: page })
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { plugin } from 'bun'
import { Pod, type AppDeployment } from '@pritzlaff/nano-core'

// After happy-dom is registered (static imports would run first): elements define themselves on import.
await import('../src/boot-theme.ts')
const { log } = await import('@pritzlaff/nano-ui')
const { addTo, removeFrom, approvalPolicy } = await import('../src/host-deploy.ts')
const { summary } = await import('../src/deploy-summary.ts')
const { start } = await import('../src/host.ts')

// /bundle/nano-ui.js is packages/ui, as the site serves it.
const nanoUi = new URL('../../ui/src/index.ts', import.meta.url).pathname
plugin({ name: 'served', setup(b) {
  b.onResolve({ filter: /bundle\/nano-ui\.js$/ }, () => ({ path: 'nano-ui', namespace: 'served' }))
  b.onLoad({ filter: /.*/, namespace: 'served' }, () => ({ contents: `export * from '${nanoUi}'; export { default } from '${nanoUi}'`, loader: 'ts' }))
} })
const domFetch = globalThis.fetch
beforeAll(() => { globalThis.fetch = (async (u: string) => { const f = Bun.file(new URL(u)), ok = await f.exists(); return { ok, status: ok ? 200 : 404, json: () => f.json() } }) as never })
afterAll(() => { globalThis.fetch = domFetch })

const tick = (ms = 0) => new Promise(r => setTimeout(r, ms))
const lazy = Pod.lazy(log)
const node = (i: number) => ({ pods: ['messaging', `example-${i}-raft`], subscriptions: [] })
/** A base with the shared `messaging` and runtime example-2 already there. */
const base = (): AppDeployment => ({
  pods: { messaging: lazy, 'example-2-raft': lazy }, runtimes: { raft: { pods: ['messaging'], subscriptions: [] }, 'example-2': node(2) },
})
const three = {
  pods: Object.fromEntries([1, 2, 3].map(i => [`example-${i}-raft`, lazy])),
  runtimes: Object.fromEntries([1, 2, 3].map(i => [`example-${i}`, node(i)])),
}

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

async function answer(label: 'Approve' | 'Deny', text = 'Create runtime node-1 (1 pod)') {
  for (let i = 0; i < 100 && !document.querySelector('dialog'); i++) await tick(5)
  const dialog = document.querySelector('dialog')!
  for (const clause of text.split('; ')) expect(dialog.textContent).toContain(clause)   // the dialog lists the summary's clauses
  ;[...dialog.querySelectorAll('button')].find(b => b.textContent === label)!.click()
}

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
