// Import from another origin: confirmed once, probed, then loaded once confirmed, and a pod that would run it asks `approve` first.
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { success } from '@pritzlaff/nano-core'
import type { Foreign } from '../src/import.ts'
import { isolated, remembered } from '../src/import-gate.ts'
import { described, probe } from '../src/described.ts'
import { serve } from '../src/sandbox/serve.ts'
import { confirmImports } from '../src/import-confirm.ts'
import { describeProvider } from '../src/sandbox/protocol.ts'
import { real, realProvider, app, installFetch, restoreFetch, running } from './cross-origin-setup.ts'

beforeAll(installFetch)
afterAll(restoreFetch)

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
