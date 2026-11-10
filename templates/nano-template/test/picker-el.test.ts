// <nano-picker>: the Picker's options in the kit's <nano-select>; choosing one picks it.
import { expect, test } from 'bun:test'
import { Ops, Registries, Runtimes, type Op } from '@pritzlaff/nano-core'
import { provide } from '@pritzlaff/nano-elements'
import { define, Picker } from '../src'

define()
const rt = Runtimes.create(Registries.create('page'))
provide(document, rt.registry)
type El = HTMLElement & { updateComplete: Promise<boolean>; [k: string]: any }
const settle = async (el: El) => { for (let i = 0; i < 3; i++) { await new Promise(r => setTimeout(r, 0)); await el.updateComplete } }
const value = async (op: Op) => ((await rt.call({ registry: 'page', instance: 'test' }, 'speed', Ops.key(op), null)) as any).value

test('<nano-picker> shows the options and value in a select, labelled; choosing one picks it', async () => {
  document.body.innerHTML = '<nano-picker name="speed" label="Speed"></nano-picker>'
  const el = document.querySelector('nano-picker') as El
  await settle(el)
  const select = el.shadowRoot!.querySelector('nano-select') as El
  expect(select.options).toEqual(['slow', 'normal', 'fast'])
  expect(select.value).toBe('slow')
  await settle(select)
  expect(select.shadowRoot!.querySelector('[role="combobox"]')!.getAttribute('aria-label')).toBe('Speed')
  select.value = 'normal'; select.dispatchEvent(new Event('change')); await settle(el)
  expect(await value(Picker.ops.value)).toBe('normal')
  expect(el.shadowRoot!.querySelector('.kicker')!.textContent).toBe('Speed')
})
