import { expect, test } from 'bun:test'
import { Components, Ops, Registries, Runtimes } from '@composable/core'
import { provide } from '@composable/elements'
import { catalog, Log, Range } from '@composable/bundle'
import { definePlatform, platform, PlatformOps as P } from '../src'

definePlatform()
const tick = () => new Promise(r => setTimeout(r, 0))
type El = HTMLElement & { updateComplete: Promise<boolean> }

const mount = async () => {
  const host = Runtimes.create(Registries.create('host'))
  host.registry.add('platform', Components.instantiate(platform(host, catalog)))
  const call = (op: any, arg: unknown = null) => host.call({ registry: 'host', instance: 't' }, 'platform', Ops.key(op), arg) as Promise<any>
  await call(P.createComponent, { kind: 'range', name: 'r', system: 'host' })
  await call(P.createComponent, { kind: 'log', name: 'l', system: 'host' })
  await call(P.createSystem, 'lab')
  provide(document, host.registry)
  document.body.innerHTML = '<c-platform></c-platform>'
  const el = document.querySelector('c-platform') as El
  const settle = async () => { for (let i = 0; i < 4; i++) { await tick(); await el.updateComplete } }
  await settle()
  const $ = (sel: string) => el.shadowRoot!.querySelector(sel) as HTMLElement | null
  const $$ = (sel: string) => [...el.shadowRoot!.querySelectorAll(sel)] as HTMLElement[]
  const button = (text: string) => $$('button').find(b => b.textContent!.trim() === text)!
  const type = async (sel: string, v: string, ev = 'input') => { const i = $(sel) as HTMLInputElement; i.value = v; i.dispatchEvent(new Event(ev)); await settle() }
  return { host, el, call, settle, $, $$, button, type }
}

test('the filter hides what does not match', async () => {
  const { $, type } = await mount()
  expect($('[data-instance="host/r"]')).not.toBeNull()
  await type('input[name="filter"]', 'warn')
  expect($('[data-instance="host/r"]')).toBeNull()
  expect($('[data-instance="host/l"]')).not.toBeNull()
  expect($(`[data-op="host/l/${Ops.key(Log.ops.warn)}"]`)).not.toBeNull()
})

test('select an action, then connect it to a fitting one; ones that do not fit get no connect button', async () => {
  const { host, $, settle, type } = await mount()
  await type('input[name="filter"]', ' ')   // a blank filter opens everything
  $(`[data-op="host/r/${Ops.key(Range.ops.value)}"]`)!.click(); await settle()
  expect($(`[data-connect="host/l/${Ops.key(Log.ops.info)}"]`)).not.toBeNull()
  expect($(`[data-connect="host/l/${Ops.key(Log.ops.entries)}"]`)).toBeNull()
  $(`[data-connect="host/l/${Ops.key(Log.ops.info)}"]`)!.click(); await settle()
  expect(host.registry.snapshot().subscriptions.some(s => s.source === 'r' && s.listener === 'l')).toBe(true)
  expect($('.connection')).not.toBeNull()
})

test('by component: add a component to another system', async () => {
  const { call, button, $, settle } = await mount()
  button('By component').click(); await settle()
  $('[data-toggle="c:r"]')!.click(); await settle()
  const pick = $('select[name="add-to-r"]') as HTMLSelectElement
  pick.value = 'lab'; pick.dispatchEvent(new Event('change')); await settle()
  $('[aria-label="Add r to system"]')!.click(); await settle()
  const lab = (await call(P.systems)).value[1]
  expect(lab.instances.map((i: any) => i.id)).toContain('r')
})

test('Add creates a component from the catalog', async () => {
  const { call, button, type, $, settle } = await mount()
  button('+ Add').click(); await settle()
  const kind = $('select[name="kind"]') as HTMLSelectElement
  kind.value = 'debounce'; kind.dispatchEvent(new Event('change'))
  await type('input[name="name"]', 'd1')
  button('Create').click(); await settle()
  expect((await call(P.systems)).value[0].instances.map((i: any) => i.id)).toContain('d1')
})

test('the tree lists connections, not the hidden subscriptions of views', async () => {
  const { $$ } = await mount()
  expect($$('.connection')).toHaveLength(0)   // <c-platform> itself subscribes to the platform, in host
})
