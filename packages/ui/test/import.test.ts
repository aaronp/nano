import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createRegistry, type AppDeployment } from '@pritzlaff/nano-core'
import { importApp, merge, type Loaded } from '../src/import.ts'

const fx = (name: string) => new URL(`./fixtures/${name}`, import.meta.url).href
const empty = (): Loaded => ({ deployment: { pods: {}, runtimes: {} }, registry: createRegistry(), views: {} })
const dep = (over: Partial<AppDeployment>): AppDeployment => ({ pods: {}, runtimes: {}, ...over })

// The happy-dom preload swaps `fetch` for one that refuses file: URLs, so these tests read fixtures with Bun.file.
const domFetch = globalThis.fetch
beforeAll(() => {
  globalThis.fetch = (async (u: string) => {
    if (u === 'http://a.test/app/nano.json') return { ok: true, status: 200, json: async () => ({ pods: {}, runtimes: {}, providers: { 'example.fx': 'http://b.test/x.js' } }) }
    const f = Bun.file(new URL(u))
    const ok = await f.exists()
    return { ok, status: ok ? 200 : 404, json: () => f.json() }
  }) as never
})
afterAll(() => { globalThis.fetch = domFetch })

describe('importApp', () => {
  test('given the good app, when imported into an empty Loaded, then the deployment, registry and views come back', async () => {
    const r = await importApp(fx('app.json'), empty())
    if (!r.ok) throw new Error(r.fail.reason)
    expect(Object.keys(r.value.deployment.pods)).toEqual(['in'])
    expect(r.value.registry.provider('example.fx')).toBeDefined()
    expect(r.value.views).toEqual({ 'example.fx/echo': 'nano-map' })
  })

  test('given a provider URL that 404s, then it fails naming the URL and loaded is unchanged', async () => {
    const loaded = empty()
    const r = await importApp(fx('missing.json'), loaded)
    expect(r).toMatchObject({ ok: false })
    expect(!r.ok && r.fail.reason).toContain('missing.ts')
    expect(loaded.registry.manifest().providers).toEqual([])
  })

  test('given a module without a default Provider, then it fails naming the URL', async () => {
    const r = await importApp(fx('nodefault.json'), empty())
    expect(r).toMatchObject({ ok: false })
    expect(!r.ok && r.fail.reason).toContain('nodefault.ts')
  })

  test('given the same app imported twice, then the second is refused with clash: pod in is already loaded', async () => {
    const first = await importApp(fx('app.json'), empty())
    if (!first.ok) throw new Error(first.fail.reason)
    const second = await importApp(fx('app.json'), first.value)
    expect(second).toMatchObject({ ok: false, fail: { reason: 'clash: pod in is already loaded' } })
  })
})

describe('provider URLs', () => {
  test('given a provider on another origin than its nano.json, then it is refused naming the URL, before anything loads', async () => {
    const loaded = empty()
    const r = await importApp('http://a.test/app/nano.json', loaded)
    expect(r).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
    expect(!r.ok && r.fail.reason).toBe('http://b.test/x.js is not on the origin of http://a.test/app/nano.json')
    expect(loaded.registry.manifest().providers).toEqual([])
  })

  test('given a relative provider, then it is stored resolved, and another nano.json naming the same module is no clash', async () => {
    const first = await importApp(fx('app.json'), empty())
    if (!first.ok) throw new Error(first.fail.reason)
    expect(first.value.deployment.providers).toEqual({ 'example.fx': fx('good.ts') })
    const second = await importApp(fx('sub/again.json'), first.value)
    expect(second).toMatchObject({ ok: true, value: { deployment: { providers: { 'example.fx': fx('good.ts') } } } })
  })
})

describe('merge', () => {
  test('tags, providers and views are unioned; a provider under another URL is a clash', () => {
    const a = dep({ tags: { x: ['a'] }, providers: { p: '/p.js' }, views: { v: 'el-a' } })
    const b = dep({ tags: { y: ['b'] }, providers: { p: '/p.js', q: '/q.js' }, views: { w: 'el-b' } })
    expect(merge(a, b)).toMatchObject({ ok: true, value: { tags: { x: ['a'], y: ['b'] }, providers: { p: '/p.js', q: '/q.js' }, views: { v: 'el-a', w: 'el-b' } } })
    expect(merge(a, dep({ providers: { p: '/other.js' } }))).toMatchObject({ ok: false, fail: { reason: 'clash: provider p is already loaded' } })
  })
})
