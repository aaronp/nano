// Import from another origin: confirmed once, probed, then loaded once confirmed, and a pod that would run it asks `approve` first.
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { AppDeployment, failure, success } from '@pritzlaff/nano-core'
import { importApp, foreignOrigin } from '../src/import.ts'
import { isolated } from '../src/import-gate.ts'
import { probe } from '../src/described.ts'
import { renameRuntimes, trusted } from '../src/import-plan.ts'
import { real, app, docs, installFetch, restoreFetch, empty, fakes, running } from './cross-origin-setup.ts'

beforeAll(installFetch)
afterAll(restoreFetch)

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

test('given a foreign provider whose pods are all isolated-sandbox, then confirming loads none of its code into the page', async () => {
  const { seen, deps } = fakes()
  const r = await importApp('https://other.test/iso/nano.json', empty(), deps)
  if (!r.ok) throw new Error(r.fail.reason)
  expect(seen).toMatchObject({ probe: ['https://other.test/app/x.js'], load: [] })
})

test('given an edit (the dialog\'s choices), then it applies before anything is decided: all isolated-sandbox loads nothing', async () => {
  const { seen, deps } = fakes()
  const edit = (d: AppDeployment) => trusted(renameRuntimes(d, { main: 'other.fx.main' }), 'sandboxed')
  const r = await importApp('https://other.test/app/nano.json', empty(), { ...deps, edit })
  if (!r.ok) throw new Error(r.fail.reason)
  expect(Object.keys(r.value.deployment.runtimes)).toEqual(['other.fx.main'])
  expect(seen.confirm[0]![0]!.pods.every(p => !p.fullAccess)).toBe(true)
  expect(seen.load).toEqual([])
})

test('given confirm says no, then the registry gains nothing and the result is import cancelled', async () => {
  const { seen, deps } = fakes({ confirm: false }), loaded = empty()
  const r = await importApp('https://other.test/app/nano.json', loaded, deps)
  expect(r).toMatchObject({ ok: false, fail: { type: 'invalid-input', reason: 'import cancelled' } })
  expect(loaded.registry.manifest().providers).toEqual([])
  expect(seen).toMatchObject({ probe: [], load: [] })
})

test('given confirm says yes, then it is probed and loaded once before any pod builds, kept whole, and its ops keep their coords', async () => {
  const { seen, deps } = fakes()
  const r = await importApp('https://other.test/app/nano.json', empty(), deps)
  if (!r.ok) throw new Error(r.fail.reason)
  expect(seen).toMatchObject({ probe: ['https://other.test/app/x.js'], load: ['https://other.test/app/x.js'], approve: [] })
  expect(r.value.deployment.modules).toEqual({ 'other.fx': 'https://other.test/app/x.js' })
  expect(foreignOrigin(r.value.deployment.modules!['other.fx'])).toBe('https://other.test')
  expect(r.value.views).toEqual({ 'other.fx/x': 'x-view' })
  expect(r.value.registry.implementation('other.fx/x')!.provides[0]!.ops.x!.coord).toBe(real.provides[0]!.ops.x!.coord)
})

test('given a host-mode pod of it and approve says no, then the call fails and it is not loaded again', async () => {
  const { seen, call } = await running({ approve: false })
  expect(await call('h')).toMatchObject({ ok: false })
  expect(seen.approve).toEqual(['Run other.fx from https://other.test in this page?'])
  expect(seen.load).toEqual(['https://other.test/app/x.js'])
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
  expect(iso.seen.load).toEqual(['https://other.test/app/x.js'])
})

test('given a foreign module that fails to load, then the import fails as a same-origin load would', async () => {
  const { deps } = fakes(), loaded = empty()
  const r = await importApp('https://other.test/app/nano.json', loaded, { ...deps, load: async () => { throw new Error('404') } })
  expect(r).toMatchObject({ ok: false, fail: { reason: 'cannot load https://other.test/app/x.js: 404' } })
  expect(loaded.registry.manifest().providers).toEqual([])
})

test('given a probe that fails, then the import fails with its reason and nothing is registered', async () => {
  const { deps } = fakes(), loaded = empty()
  const r = await importApp('https://other.test/app/nano.json', loaded, { ...deps, probe: async () => failure('invalid-input', 'no answer') })
  expect(r).toMatchObject({ ok: false, fail: { reason: 'no answer' } })
  expect(loaded.registry.manifest().providers).toEqual([])
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
