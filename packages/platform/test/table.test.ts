import { expect, test } from 'bun:test'
import { Components, Ops, Registries, Runtimes } from '@pritzlaff/nano-core'
import { provide } from '@pritzlaff/nano-elements'
import { catalog } from '@composable/bundle'
import { definePlatformTable, platform, PlatformOps as P, type Row } from '../src'

definePlatformTable()
const tick = () => new Promise(r => setTimeout(r, 0))
type El = HTMLElement & { updateComplete: Promise<boolean> }

const mount = async () => {
  const host = Runtimes.create(Registries.create('host'))
  host.registry.add('platform', Components.instantiate(platform(host, catalog)))
  const call = (op: any, arg: unknown = null) => host.call({ registry: 'host', instance: 't' }, 'platform', Ops.key(op), arg) as Promise<any>
  await call(P.createComponent, { kind: 'range', name: 'r', system: 'host' })
  await call(P.createComponent, { kind: 'log', name: 'l', system: 'host' })
  await call(P.createSystem, 'lab')
  await call(P.addToSystem, { instance: 'r', from: 'host', to: 'lab' })
  provide(document, host.registry)
  document.body.innerHTML = '<c-platform-table></c-platform-table>'
  const el = document.querySelector('c-platform-table') as El
  const table = () => el.shadowRoot!.querySelector('nano-data-table') as El & { rows: Row[] }
  const settle = async () => { for (let i = 0; i < 4; i++) { await tick(); await el.updateComplete; await table()?.updateComplete } }
  await settle()
  const $ = (sel: string) => el.shadowRoot!.querySelector(sel) as HTMLElement | null
  const at = (sel: string) => table().shadowRoot!.querySelector(sel) as HTMLElement | null
  const rows = () => table().rows
  return { host, el, call, settle, $, at, rows }
}

test('lists every instance, including views, with owners', async () => {
  const { rows } = await mount()
  expect(rows().find(r => r.system === 'host' && r.instance === 'r')).toEqual({ system: 'host', component: 'range', instance: 'r', name: 'composable.bundle/range', owner: 'platform · platform' })
  expect(rows().some(r => r.instance.includes('~view') && r.owner === 'view · c-platform-table')).toBe(true)
  expect(rows().some(r => r.system === '—' && r.component === 'debounce')).toBe(true)
})

test('Filters expands, picks a system, and counts it', async () => {
  const { $, settle, rows } = await mount()
  expect($('.badge')).toBeNull()
  expect($('.options')).toBeNull()
  $('button.filters')!.click(); await settle()
  expect($('button.filters')!.getAttribute('aria-expanded')).toBe('true')
  $('[data-system="lab"]')!.click(); await settle()
  expect($('[data-system="lab"]')!.getAttribute('aria-pressed')).toBe('true')
  expect($('.badge')!.textContent).toBe('1')
  expect($('[aria-label="Remove filter lab"]')).not.toBeNull()
  expect(rows().map(r => `${r.system}/${r.instance}`)).toEqual(['lab/registry', 'lab/r'])
})

test("a pill's ✕ and Clear remove filters", async () => {
  const { $, settle, rows } = await mount()
  const all = rows().length
  $('button.filters')!.click(); await settle()
  $('[data-system="lab"]')!.click(); $('[data-component="log"]')!.click(); await settle()
  expect($('.badge')!.textContent).toBe('2')
  $('[aria-label="Remove filter lab"]')!.click(); await settle()
  expect($('.badge')!.textContent).toBe('1')
  expect(rows().every(r => r.component === 'log')).toBe(true)
  $('button.clear')!.click(); await settle()
  expect($('.badge')).toBeNull()
  expect($('button.clear')).toBeNull()
  expect(rows()).toHaveLength(all)
})

test('the Unregistered pill keeps kinds nothing has been made of', async () => {
  const { $, settle, rows } = await mount()
  $('button.filters')!.click(); await settle()
  $('[data-system="Unregistered"]')!.click(); await settle()
  expect(rows().length).toBeGreaterThan(0)
  expect(rows().every(r => r.system === '—')).toBe(true)
})

test('free text filters the rows', async () => {
  const { $, settle, rows } = await mount()
  const q = $('input[name="q"]') as HTMLInputElement
  q.value = 'composable.bundle/log'; q.dispatchEvent(new Event('input')); await settle()
  expect(rows().map(r => `${r.system}/${r.instance}`)).toEqual(['host/l'])
})

test('clicking an instance selects it', async () => {
  const { at, call, settle } = await mount()
  at('[data-select="lab/r"]')!.click(); await settle()
  expect((await call(P.selected)).value).toEqual({ system: 'lab', instance: 'r' })
})

test('a component created elsewhere appears', async () => {
  const { call, settle, rows } = await mount()
  await call(P.createComponent, { kind: 'map', name: 'm', system: 'lab' }); await settle()
  expect(rows().some(r => r.system === 'lab' && r.instance === 'm')).toBe(true)
})

test("the table's colours come from the kit's tokens, with the kit's fallbacks", async () => {
  const { PlatformTableEl } = await import('../src')
  const { t } = await import('@pritzlaff/nano-elements')
  const css = (PlatformTableEl.styles as { cssText: string }[]).at(-1)!.cssText   // its own sheet, after base and kit
  expect(css).not.toContain('accent-fg')
  for (const light of ['#2563EB', '#E2E5EA', '#6B7280', '#fff']) expect(css).not.toContain(light)   // no hand-written light fallbacks
  for (const k of ['accent', 'border', 'muted'] as const) expect(css).toContain(String(t(k)))
  expect(css).toContain(String(t('on-accent')))
})
