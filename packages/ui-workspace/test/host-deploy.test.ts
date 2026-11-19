// HostDeploy in the workspace: the pure addTo, removeFrom and summary, the approval policy, and a pod deploying a
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
const { addTo, removeFrom, summary, approvalPolicy } = await import('../src/host-deploy.ts')
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

test('summary names the runtimes and pod count', () => {
  const before: AppDeployment = { pods: { messaging: lazy }, runtimes: { raft: { pods: ['messaging'], subscriptions: [] } } }
  const after = addTo(before, three)
  if (!after.ok) throw new Error(after.fail.reason)
  expect(summary(before, after.value)).toBe('Create runtimes example-1..3 (3 pods)')
  expect(summary(after.value, before)).toBe('Remove runtimes example-1..3')
  const one = addTo(before, { pods: { solo: lazy }, runtimes: { solo: { pods: ['solo'], subscriptions: [] } } })
  if (!one.ok) throw new Error(one.fail.reason)
  expect(summary(before, one.value)).toBe('Create runtime solo (1 pod)')
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

async function answer(label: 'Approve' | 'Deny') {
  for (let i = 0; i < 100 && !document.querySelector('dialog'); i++) await tick(5)
  const dialog = document.querySelector('dialog')!
  expect(dialog.textContent).toContain('Create runtime node-1 (1 pod)')
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
})
