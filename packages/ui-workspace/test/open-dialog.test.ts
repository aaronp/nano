import { GlobalRegistrator } from '@happy-dom/global-registrator'
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
import { expect, test } from 'bun:test'
import type { NanoApp } from '@composable/shell'
import { openDialog } from '../src/components/open-dialog'
import { confirmImports } from '../src/components/imports-confirm'
import { askName } from '../src/components/name-dialog'

const tick = () => new Promise(r => setTimeout(r, 0))
const a = (title: string): NanoApp => ({ nano: 1, title, imports: [], systems: [], workspaces: [] })
const dlg = () => document.querySelector('dialog') as HTMLDialogElement
const $ = (s: string) => dlg().querySelector(s) as HTMLElement

test('a URL is fetched without credentials and opened; a bad document stays in the dialog with its error', async () => {
  const calls: any[] = []
  const fetchFn = (async (u: string, init: any) => { calls.push([u, init.credentials]); return new Response(u.includes('bad') ? '{"nano":3}' : JSON.stringify(a('Remote'))) }) as never
  const p = openDialog(document, { mode: 'open', apps: {}, fetchFn })
  const url = $('input[name="url"]') as HTMLInputElement
  url.value = 'https://h/bad.json'; $('[data-url]').click(); await tick(); await tick()
  expect($('[role="alert"]').textContent).toContain('Not opened'); expect(dlg()).not.toBeNull()
  url.value = 'https://h/ok.json'; $('[data-url]').click(); await tick(); await tick()
  expect(await p).toEqual({ app: a('Remote') }); expect(calls[1]).toEqual(['https://h/ok.json', 'omit']); expect(dlg()).toBeNull()
})

test('a saved app opens by name; Cancel gives null; kept copies can be opened (checked) or discarded', async () => {
  const p = openDialog(document, { mode: 'open', apps: { one: a('One') } })
  $('[data-app="0"]').click(); expect(await p).toEqual({ app: a('One'), name: 'one', own: true })
  const q = openDialog(document, { mode: 'import', apps: {} }); $('[data-cancel]').click(); expect(await q).toBeNull()
  const gone: string[] = []
  const r = openDialog(document, { mode: 'open', apps: {}, kept: [{ key: 'bad', text: 'nope' }, { key: 'unrestored', text: JSON.stringify(a('Kept')) }], discard: k => gone.push(k) })
  $('[data-kopen="bad"]').click(); expect($('[role="alert"]').textContent).toContain('not JSON')
  $('[data-kdiscard="bad"]').click(); expect(gone).toEqual(['bad']); expect(dlg().querySelector('[data-kopen="bad"]')).toBeNull()
  $('[data-kopen="unrestored"]').click(); expect(await r).toEqual({ app: a('Kept'), own: true, kept: 'unrestored' })
})

test('the imports confirmation: trusted unticked by default, sandboxed and already-imported have no tick; Cancel gives null', async () => {
  const wanted = [{ url: 'https://t/m', trust: 'trusted' as const }, { url: 'https://s/m', trust: 'sandboxed' as const }, { url: 'https://a/m', trust: 'trusted' as const }]
  const p = confirmImports(document, wanted, ['https://a/m'], [{ system: 'host', instance: 'm1', kind: 'map' }])
  expect(dlg().querySelectorAll('input[data-import]').length).toBe(1)
  expect((dlg().querySelector('input[data-import]') as HTMLInputElement).checked).toBe(false)
  expect((dlg().querySelector('input[data-code]') as HTMLInputElement).checked).toBe(false)
  $('[data-ok]').click()
  expect(await p).toEqual({ imports: [{ url: 'https://t/m', trust: 'sandboxed' }, { url: 'https://s/m', trust: 'sandboxed' }, { url: 'https://a/m', trust: 'trusted' }], code: [] })
  const q = confirmImports(document, wanted, [], [{ system: 'host', instance: 'm1', kind: 'map' }])
  ;(dlg().querySelector('input[data-import="0"]') as HTMLInputElement).checked = true; (dlg().querySelector('input[data-code="0"]') as HTMLInputElement).checked = true
  $('[data-ok]').click(); const r = (await q)!
  expect(r.imports[0]!.trust).toBe('trusted'); expect(r.code).toEqual(['host/m1'])
  const c = confirmImports(document, wanted, [], []); $('[data-cancel]').click(); expect(await c).toBeNull()
})

test('askName needs a name', async () => {
  const p = askName(document, 'App'); ;($('input') as HTMLInputElement).value = '  '; $('[data-ok]').click(); await tick()
  expect($('[role="alert"]').textContent).toContain('name'); ;($('input') as HTMLInputElement).value = ' Mine '; $('[data-ok]').click()
  expect(await p).toBe('Mine')
})
