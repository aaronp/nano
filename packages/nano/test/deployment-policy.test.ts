import { expect, test } from 'bun:test'
import { AppDeployment, Application, DeploymentPolicies, Implementation, Provider, Registry, type AppEvent, type DeploymentAsk, type DeploymentPolicy } from '../src/index.ts'

const registry = Registry.create()
registry.add(Provider.define('acme', [Implementation.define('acme/a', { provides: [], make: () => ({ }) as never })]))
const dep = (...names: string[]): AppDeployment => ({ pods: Object.fromEntries(names.map(n => [n, { implementation: 'acme/a', eager: true }])), runtimes: { r: { pods: names, subscriptions: [] } } })
const make = async (deploymentPolicy?: DeploymentPolicy) => {
  const d = AppDeployment.assemble(dep('a'), registry)
  if (!d.ok) throw new Error(d.fail.reason)
  const app = await Application.create(d.value, { deploymentPolicy })
  if (!app.ok) throw new Error(app.fail.reason)
  const events: AppEvent[] = []
  app.value.listen(e => events.push(e))
  return { app: app.value, applied: () => events.filter(e => e.type === 'applied') }
}

for (const [name, p] of [['absent policy', undefined], ['allowAll', DeploymentPolicies.allowAll()]] as const)
  test(`${name}: apply works as before and applied.caller is 'host'`, async () => {
    const { app, applied } = await make(p)
    expect((await app.apply(dep('a', 'b'))).ok).toBe(true)
    expect(Object.keys(app.deployment().pods)).toEqual(['a', 'b'])
    expect(applied()).toMatchObject([{ caller: 'host', added: ['b'] }])
  })

test('a refusing policy: apply is denied with its reason, the deployment is unchanged, no applied event', async () => {
  const { app, applied } = await make({ isAllowed: () => ({ approved: false, reason: 'no growing' }) })
  const r = await app.apply(dep('a', 'b'))
  expect(r.ok).toBe(false)
  if (!r.ok) expect(r.fail).toMatchObject({ type: 'denied', reason: 'no growing' })
  expect(Object.keys(app.deployment().pods)).toEqual(['a'])
  expect(applied()).toEqual([])
})

test('the policy hears caller and the next deployment', async () => {
  const asks: DeploymentAsk[] = []
  const { app, applied } = await make({ isAllowed: a => (asks.push(a), { approved: true }) })
  const next = dep('a', 'b')
  await app.apply(next, { caller: 'grower' })
  expect(asks).toEqual([{ caller: 'grower', deployment: next }])
  expect(applied()).toMatchObject([{ caller: 'grower' }])
})

test('an async policy is awaited', async () => {
  const { app } = await make({ isAllowed: async () => ({ approved: false, reason: 'later' }) })
  const r = await app.apply(dep('a', 'b'))
  expect(!r.ok && r.fail.reason).toBe('later')
  expect(Object.keys(app.deployment().pods)).toEqual(['a'])
})

test('a policy that throws, rejects or gives no verdict refuses: apply answers denied, never rejects', async () => {
  const bad: DeploymentPolicy[] = [
    { isAllowed: () => { throw new Error('boom') } },
    { isAllowed: async () => { throw new Error('boom') } },
    { isAllowed: () => undefined as never },
  ]
  for (const p of bad) {
    const { app, applied } = await make(p)
    const r = await app.apply(dep('a', 'b'))
    expect(!r.ok && r.fail.type).toBe('denied')
    expect(Object.keys(app.deployment().pods)).toEqual(['a'])
    expect(applied()).toEqual([])
  }
})
