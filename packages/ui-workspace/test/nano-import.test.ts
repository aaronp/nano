import { GlobalRegistrator } from '@happy-dom/global-registrator'
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Registry, type AppDeployment } from '@pritzlaff/nano-core'
import { importApp, merge, type Loaded } from '../src/import.ts'

const fx = (name: string) => new URL(`./fixtures/import/${name}`, import.meta.url).href
// Same-origin only (the page is not http, so the nano.json's origin is home): cross-origin is test/cross-origin.test.ts.
const no = (what: string) => async () => { throw new Error(`${what} on a same-origin import`) }
const deps = { load: (u: string) => import(u), probe: no('probe'), confirm: no('confirm'), approve: no('approve') }
const empty = (): Loaded => ({ deployment: { pods: {}, runtimes: {} }, registry: Registry.create(), views: {} })
const dep = (over: Partial<AppDeployment>): AppDeployment => ({ pods: {}, runtimes: {}, ...over })

// The happy-dom preload swaps `fetch` for one that refuses file: URLs, so these tests read fixtures with Bun.file.
const domFetch = globalThis.fetch
beforeAll(() => {
  globalThis.fetch = (async (u: string) => {
    const f = Bun.file(new URL(u))
    const ok = await f.exists()
    return { ok, status: ok ? 200 : 404, json: () => f.json() }
  }) as never
})
afterAll(() => { globalThis.fetch = domFetch })

describe('importApp', () => {
  test('given the good app, when imported into an empty Loaded, then the deployment, registry and views come back', async () => {
    const r = await importApp(fx('app.json'), empty(), deps)
    if (!r.ok) throw new Error(r.fail.reason)
    expect(Object.keys(r.value.deployment.pods)).toEqual(['in'])
    expect(r.value.registry.provider('example.fx')).toBeDefined()
    expect(r.value.views).toEqual({ 'example.fx/echo': 'nano-map' })
  })

  test('given a provider URL that 404s, then it fails naming the URL and loaded is unchanged', async () => {
    const loaded = empty()
    const r = await importApp(fx('missing.json'), loaded, deps)
    expect(r).toMatchObject({ ok: false })
    expect(!r.ok && r.fail.reason).toContain('missing.ts')
    expect(loaded.registry.manifest().providers).toEqual([])
  })

  test('given a module without a default Provider, then it fails naming the URL', async () => {
    const r = await importApp(fx('nodefault.json'), empty(), deps)
    expect(r).toMatchObject({ ok: false })
    expect(!r.ok && r.fail.reason).toContain('nodefault.ts')
  })

  test('given the same app imported twice, then the second is refused with clash: pod in is already loaded', async () => {
    const first = await importApp(fx('app.json'), empty(), deps)
    if (!first.ok) throw new Error(first.fail.reason)
    const second = await importApp(fx('app.json'), first.value, deps)
    expect(second).toMatchObject({ ok: false, fail: { reason: 'clash: pod in is already loaded' } })
  })
})

test('given a module built with a newer nano-core, then the import warns and still succeeds', async () => {
  const warned: string[] = []
  const r = await importApp(fx('app.json'), empty(), { ...deps, warn: (t: string) => void warned.push(t) })
  expect(r.ok).toBe(true)
  expect(warned).toEqual([expect.stringMatching(/^example\.fx was built with nano-core 99\.0\.0; this workspace has /)])
})

describe('provider URLs', () => {
  test('given a relative provider, then it is stored resolved, and another nano.json naming the same module is no clash', async () => {
    const first = await importApp(fx('app.json'), empty(), deps)
    if (!first.ok) throw new Error(first.fail.reason)
    expect(first.value.deployment.modules).toEqual({ 'example.fx': fx('good.ts') })
    const second = await importApp(fx('sub/again.json'), first.value, deps)
    expect(second).toMatchObject({ ok: true, value: { deployment: { modules: { 'example.fx': fx('good.ts') } } } })
  })
})

describe('a coord the registry has', () => {
  test('given the provider is already registered, then its module is not imported again', async () => {
    const first = await importApp(fx('app.json'), empty(), deps)
    if (!first.ok) throw new Error(first.fail.reason)
    // The stored URL matches but names no module: an import() would fail.
    const url = fx('missing.ts')
    const loaded = { ...first.value, deployment: { ...first.value.deployment, modules: { 'example.fx': url } } }
    const r = await importApp(fx('skip.json'), loaded, deps)
    expect(r.ok).toBe(true)
  })
})

describe('own names', () => {
  test('given a pod named constructor, then it imports without a clash', async () => {
    const r = merge(dep({}), dep({ pods: { constructor: { implementation: 'x/y', eager: false } } }))
    expect(r.ok).toBe(true)
  })
})

describe('merge', () => {
  test('merging into a runtime: both with a policy is refused; one policy is kept, never dropped', () => {
    const rules = (from: string) => ({ kind: 'rules' as const, rules: [{ allow: '*' as const, from }] })
    const has = (p?: ReturnType<typeof rules>) => ({ pods: [], subscriptions: [], ...(p && { policy: p }) })
    expect(merge(dep({ runtimes: { r: has(rules('a')) } }), dep({ runtimes: { r: has(rules('b')) } }))).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
    expect(merge(dep({ runtimes: { r: has() } }), dep({ runtimes: { r: has(rules('b')) } }))).toMatchObject({ ok: true, value: { runtimes: { r: { policy: rules('b') } } } })
    expect(merge(dep({ runtimes: { r: has(rules('a')) } }), dep({ runtimes: { r: has() } }))).toMatchObject({ ok: true, value: { runtimes: { r: { policy: rules('a') } } } })
  })
  test('a runtime already there gains the incoming pods and subscriptions (the Import dialog named it)', () => {
    const call = { kind: 'call' as const, from: 'b', to: 'a' }
    const a = dep({ runtimes: { r: { pods: ['a'], subscriptions: [] } } }), b = dep({ runtimes: { r: { pods: ['b'], subscriptions: [call] } } })
    expect(merge(a, b)).toMatchObject({ ok: true, value: { runtimes: { r: { pods: ['a', 'b'], subscriptions: [call] } } } })
  })

  test('tags, modules and views are unioned; a provider under another URL is a clash', () => {
    const a = dep({ tags: { x: ['a'] }, modules: { p: '/p.js' }, views: { v: 'el-a' } })
    const b = dep({ tags: { y: ['b'] }, modules: { p: '/p.js', q: '/q.js' }, views: { w: 'el-b' } })
    expect(merge(a, b)).toMatchObject({ ok: true, value: { tags: { x: ['a'], y: ['b'] }, modules: { p: '/p.js', q: '/q.js' }, views: { v: 'el-a', w: 'el-b' } } })
    expect(merge(a, dep({ modules: { p: '/other.js' } }))).toMatchObject({ ok: false, fail: { reason: 'clash: provider p is already loaded' } })
  })
})
