// Import from another origin: confirmed once, probed (never loaded), and a pod that would run it with the page's access
// asks `approve` first. The page is http://host.test; the foreign nano.json and module are on https://other.test.
import { GlobalRegistrator } from '@happy-dom/global-registrator'
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: 'http://host.test/' })
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { Type } from 'typebox'
import { Coord, Application, AppDeployment, Registry, Schema, failure, Interface, Implementation, Op, provide, success, type Pod } from '@pritzlaff/nano-core'
import { importApp, isolated, foreignOrigin, remembered, type Foreign, type Loaded } from '../src/import.ts'
import { described, probe } from '../src/described.ts'
import { serve } from '../src/sandbox/serve.ts'
import { confirmImports } from '../src/import-confirm.ts'
import { describeProvider } from '../src/sandbox/protocol.ts'

const ns = Coord.namespace('other.fx')

const Text = Schema.define(Type.String(), 'Text')
const X = Interface.define('other.X', { x: Op.action(Text, Text) })
const real = Implementation.define(ns.implementationId('x'), { provides: [X], make: () => [provide(X, { x: async s => success(`real ${s}`) })] })
const realProvider = ns.provider([real])

const app: AppDeployment = {
  pods: {
    h: { implementation: 'other.fx/x', eager: false },
    s: { implementation: 'other.fx/x', eager: false, isolation: 'sandbox' },
    i: { implementation: 'other.fx/x', eager: false, isolation: 'isolated-sandbox' },
  },
  runtimes: { main: { pods: ['h', 's', 'i'], subscriptions: [] } },
  modules: { 'other.fx': './x.js' },
}
const docs: Record<string, AppDeployment> = {
  'https://other.test/app/nano.json': app,
  'http://host.test/app/nano.json': { pods: { h: { implementation: 'other.fx/x', eager: false } }, runtimes: {}, modules: { 'other.fx': './x.js' } },
}
const domFetch = globalThis.fetch
beforeAll(() => { globalThis.fetch = (async (u: string) => ({ ok: true, status: 200, json: async () => structuredClone(docs[u]) })) as never })
afterAll(() => { globalThis.fetch = domFetch })

const empty = (): Loaded => ({ deployment: { pods: {}, runtimes: {} }, registry: Registry.create(), views: {} })
function fakes(o: { confirm?: boolean; approve?: boolean; remember?: boolean } = {}) {
  const seen = { load: [] as string[], probe: [] as string[], confirm: [] as Foreign[][], approve: [] as string[] }
  const deps = {
    load: async (u: string) => { seen.load.push(u); return { default: realProvider } },
    probe: async (u: string) => { seen.probe.push(u); return described(describeProvider(realProvider, { 'other.fx/x': 'x-view' })) },
    confirm: async (list: Foreign[]) => { seen.confirm.push(list); return o.confirm ?? true },
    approve: async (t: string) => { seen.approve.push(t); await Promise.resolve(); return o.approve ?? true },
  }
  if (o.remember) deps.approve = remembered(deps.approve)
  return { seen, deps }
}

test('given a same-origin import, then confirm and probe are never called', async () => {
  const { seen, deps } = fakes()
  const r = await importApp('http://host.test/app/nano.json', empty(), deps)
  expect(r.ok).toBe(true)
  expect(seen).toMatchObject({ confirm: [], probe: [], load: ['http://host.test/app/x.js'] })
  expect(r.ok && r.value.deployment.modules).toEqual({ 'other.fx': '/app/x.js' })
})

test('given a foreign provider, then confirm gets one entry: host and sandbox pods have full access, isolated-sandbox not', async () => {
  const { seen, deps } = fakes()
  await importApp('https://other.test/app/nano.json', empty(), deps)
  expect(seen.confirm).toEqual([[{ coord: 'other.fx', url: 'https://other.test/app/x.js', origin: 'https://other.test', pods: [
    { name: 'h', isolation: 'host', fullAccess: true },
    { name: 's', isolation: 'sandbox', fullAccess: true },
    { name: 'i', isolation: 'isolated-sandbox', fullAccess: false },
  ] }]])
})

test('given confirm says no, then the registry gains nothing and the result is import cancelled', async () => {
  const { seen, deps } = fakes({ confirm: false }), loaded = empty()
  const r = await importApp('https://other.test/app/nano.json', loaded, deps)
  expect(r).toMatchObject({ ok: false, fail: { type: 'invalid-input', reason: 'import cancelled' } })
  expect(loaded.registry.manifest().providers).toEqual([])
  expect(seen).toMatchObject({ probe: [], load: [] })
})

test('given confirm says yes, then it is probed, not loaded, kept whole, and its ops keep their coords', async () => {
  const { seen, deps } = fakes()
  const r = await importApp('https://other.test/app/nano.json', empty(), deps)
  if (!r.ok) throw new Error(r.fail.reason)
  expect(seen).toMatchObject({ probe: ['https://other.test/app/x.js'], load: [] })
  expect(r.value.deployment.modules).toEqual({ 'other.fx': 'https://other.test/app/x.js' })
  expect(foreignOrigin(r.value.deployment.modules!['other.fx'])).toBe('https://other.test')
  expect(r.value.views).toEqual({ 'other.fx/x': 'x-view' })
  expect(r.value.registry.implementation('other.fx/x')!.provides[0]!.ops.x!.coord).toBe(real.provides[0]!.ops.x!.coord)
})

/** The imported app running, its non-host pods through `isolated` around a stand-in that runs the probed shape in place. */
async function running(o: { approve: boolean; remember?: boolean }) {
  const { seen, deps } = fakes(o)
  const r = await importApp('https://other.test/app/nano.json', empty(), deps)
  if (!r.ok) throw new Error(r.fail.reason)
  const runtimes = AppDeployment.assemble(r.value.deployment, r.value.registry)
  if (!runtimes.ok) throw new Error(runtimes.fail.reason)
  const standIn: Implementation = { ...real, make: real.make }
  const isolate = (_: string, pod: Pod) => isolated(standIn, pod.isolation, foreignOrigin(r.value.deployment.modules!['other.fx']), deps.approve)
  const made = await Application.create(runtimes.value, { isolate })
  if (!made.ok) throw new Error(made.fail.reason)
  return { seen, app: made.value, call: (pod: string) => (made.value.call('main', pod) as unknown as { x(s: string): Promise<unknown> }).x('hi') }
}

test('given a host-mode pod of it and approve says no, then the call fails and nothing is loaded', async () => {
  const { seen, call } = await running({ approve: false })
  expect(await call('h')).toMatchObject({ ok: false })
  expect(seen.approve).toEqual(['Run other.fx from https://other.test in this page?'])
  expect(seen.load).toEqual([])
})

test('given a host-mode pod of it and approve says yes, then it is loaded once and the call succeeds', async () => {
  const { seen, call } = await running({ approve: true })
  expect(await call('h')).toEqual(success('real hi'))
  expect(seen.load).toEqual(['https://other.test/app/x.js'])
})

test('given a sandbox pod of it, then approve is asked; an isolated-sandbox pod is not asked', async () => {
  const no = await running({ approve: false })
  expect(await no.call('s')).toMatchObject({ ok: false })
  expect(no.seen.approve).toEqual(['Run other.fx from https://other.test in this page?'])
  const iso = await running({ approve: false })
  expect(await iso.call('i')).toEqual(success('real hi'))
  expect(iso.seen.approve).toEqual([])
  expect(iso.seen.load).toEqual([])
})

test('given a probe that fails, then the import fails with its reason and nothing is registered', async () => {
  const { deps } = fakes(), loaded = empty()
  const r = await importApp('https://other.test/app/nano.json', loaded, { ...deps, probe: async () => failure('invalid-input', 'no answer') })
  expect(r).toMatchObject({ ok: false, fail: { reason: 'no answer' } })
  expect(loaded.registry.manifest().providers).toEqual([])
})

test('given the confirm dialog, then it shows names as text, flags full access, and answers per button', async () => {
  const list: Foreign[] = [{ coord: '<img src=x onerror=alert(1)>', url: 'https://other.test/x.js', origin: 'https://other.test',
    pods: [{ name: 'h', isolation: 'host', fullAccess: true }, { name: 'i', isolation: 'isolated-sandbox', fullAccess: false }] }]
  const click = (label: string) => [...document.querySelectorAll('dialog button')].find(b => b.textContent === label)!.dispatchEvent(new Event('click'))
  const yes = confirmImports(list)
  const d = document.querySelector('dialog')!
  expect(d.querySelector('img')).toBeNull()
  expect(d.textContent).toContain('<img src=x onerror=alert(1)>')
  expect(d.querySelectorAll('strong').length).toBe(1)
  click('Import')
  expect(await yes).toBe(true)
  const no = confirmImports(list)
  click('Cancel')
  expect(await no).toBe(false)
  expect(document.querySelector('dialog')).toBeNull()
})

test('given a description naming views of other implementations or bad tags, then only its own valid ones are kept', () => {
  const d = describeProvider(realProvider, { 'other.fx/x': 'x y', 'nano.ui/map': 'evil-view' })
  expect(described(d)).toMatchObject({ ok: true, value: { views: {} } })
  expect(described({ ...d, coord: 'elsewhere' })).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
})

test('given probe over a port to a serving frame, then it resolves with the provider and lets the frame go', async () => {
  let disposed = 0
  const open = () => {
    const ch = new MessageChannel()
    serve(ch.port1, async () => real, { probe: async () => [describeProvider(realProvider, {})] })
    return { port: ch.port2, ready: Promise.resolve(), dispose() { disposed++; ch.port1.close(); ch.port2.close() } }
  }
  const r = await probe('https://other.test/app/x.js', open)
  expect(r.ok && r.value.provider.implementations.get('other.fx/x')!.provides[0]!.ops.x!.coord).toBe(real.provides[0]!.ops.x!.coord)
  expect(disposed).toBe(1)
  const silent = await probe('https://other.test/app/x.js', () => ({ ...open(), port: new MessageChannel().port2 }), 20)
  expect(silent).toMatchObject({ ok: false, fail: { reason: 'https://other.test/app/x.js: no description within 20ms' } })
})

test('given approve remembered, then a yes holds across parallel makes and a restart, and after a no the next make asks', async () => {
  const yes = await running({ approve: true, remember: true })
  expect(await Promise.all([yes.call('h'), yes.call('s')])).toEqual([success('real hi'), success('real hi')])
  expect(await yes.app.restart('h')).toMatchObject({ ok: true })
  expect(await yes.call('h')).toEqual(success('real hi'))
  expect(yes.seen.approve).toEqual(['Run other.fx from https://other.test in this page?'])
  const no = await running({ approve: false, remember: true })
  expect(await no.call('h')).toMatchObject({ ok: false })
  expect(await no.call('h')).toMatchObject({ ok: false })
  expect(no.seen.approve.length).toBe(2)
})

test('given a same-origin ref whose path reads as protocol-relative, then it is stored whole, on this origin, not foreign', async () => {
  docs['http://host.test/trick/nano.json'] = { pods: {}, runtimes: {}, modules: { 'other.fx': '/.//evil.test/x.js' } }
  const { seen, deps } = fakes()
  const r = await importApp('http://host.test/trick/nano.json', empty(), deps)
  if (!r.ok) throw new Error(r.fail.reason)
  expect(seen).toMatchObject({ confirm: [], probe: [] })   // import decided: same origin
  const stored = r.value.deployment.modules!['other.fx']!
  expect(new URL(stored, location.href).origin).toBe('http://host.test')
  expect(foreignOrigin(stored)).toBeUndefined()
})

test('given an import that clashes, then it is refused before confirm is asked', async () => {
  const { seen, deps } = fakes(), loaded = empty()
  loaded.deployment.pods.h = { implementation: 'some.p/q', eager: false }
  expect(await importApp('https://other.test/app/nano.json', loaded, deps)).toMatchObject({ ok: false, fail: { reason: 'clash: pod h is already loaded' } })
  expect(seen.confirm).toEqual([])
})
