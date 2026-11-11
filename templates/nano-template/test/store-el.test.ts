// <nano-store>: the Store's entries in a table, a key and value to set, and a remove button per entry.
import { beforeEach, expect, test } from 'bun:test'
import { Ops, Registries, Runtimes, type Op } from '@pritzlaff/nano-core'
import { provide } from '@pritzlaff/nano-elements'
import { define, Store } from '../src'

define()
const rt = Runtimes.create(Registries.create('page'))
provide(document, rt.registry)
type El = HTMLElement & { updateComplete: Promise<boolean> }
const settle = async (el: El) => { for (let i = 0; i < 3; i++) { await new Promise(r => setTimeout(r, 0)); await el.updateComplete } }
const call = async (op: Op, arg: unknown = null, id = 'prefs') => ((await rt.call({ registry: 'page', instance: 'test' }, id, Ops.key(op), arg)) as any).value

beforeEach(() => localStorage.clear())

test('<nano-store> shows where it keeps values and its entries; Save sets one; × removes it', async () => {
  document.body.innerHTML = '<nano-store name="prefs"></nano-store>'
  const el = document.querySelector('nano-store') as El
  await settle(el)
  const $ = (s: string) => el.shadowRoot!.querySelector(s) as HTMLElement
  expect($('.backing').textContent).toContain('localStorage')

  const type = (sel: string, v: string) => { const i = $(sel) as HTMLInputElement; i.value = v; i.dispatchEvent(new Event('input')) }
  type('input[name="key"]', 'theme'); type('input[name="value"]', 'dark')
  expect(!!el.shadowRoot!.querySelector('form')).toBe(false)   // a sandboxed frame without allow-forms never fires submit
  $('button.save').click(); await settle(el)
  expect(await call(Store.ops.get, 'theme')).toBe('dark')
  expect($('tbody').textContent).toContain('theme')
  expect($('tbody').textContent).toContain('dark')

  ;(el.shadowRoot!.querySelector('button[aria-label="Remove theme"]') as HTMLElement).click(); await settle(el)
  expect(await call(Store.ops.get, 'theme')).toBeNull()
})

test('<nano-store>: Enter in the value saves too', async () => {
  document.body.innerHTML = '<nano-store name="keys"></nano-store>'   // its own instance: the last test's goes a moment after its element
  const el = document.querySelector('nano-store') as El
  await settle(el)
  const input = (sel: string, v: string) => { const i = el.shadowRoot!.querySelector(sel) as HTMLInputElement; i.value = v; i.dispatchEvent(new Event('input')); return i }
  input('input[name="key"]', 'k')
  input('input[name="value"]', 'v').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); await settle(el)
  expect(await call(Store.ops.get, 'k', 'keys')).toBe('v')
})
