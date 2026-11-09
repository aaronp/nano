// <nano-timer>: shows the count, and drives the Timer with Start/Stop, Reset and an interval field.
import { expect, test } from 'bun:test'
import { Ops, Registries, Runtimes, type Op } from '@pritzlaff/nano-core'
import { provide } from '@pritzlaff/nano-elements'
import { define, Timer } from '../src'

define()
const rt = Runtimes.create(Registries.create('page'))
provide(document, rt.registry)
type El = HTMLElement & { updateComplete: Promise<boolean> }
const settle = async (el: El) => { for (let i = 0; i < 3; i++) { await new Promise(r => setTimeout(r, 0)); await el.updateComplete } }
const value = async (op: Op) => ((await rt.call({ registry: 'page', instance: 'test' }, 't1', Ops.key(op), null)) as any).value
const button = (el: El, text: string) => [...el.shadowRoot!.querySelectorAll('button')].find(b => b.textContent?.trim() === text)!

test('<nano-timer> shows the count; Start, Stop, Reset and the interval field drive the Timer', async () => {
  document.body.innerHTML = '<nano-timer name="t1"></nano-timer>'
  const el = document.querySelector('nano-timer') as El
  await settle(el)
  expect(el.shadowRoot!.querySelector('.count')!.textContent).toBe('0')
  button(el, 'Start').click(); await settle(el)
  expect(await value(Timer.ops.running)).toBe(true)
  expect(button(el, 'Stop')).toBeDefined()
  button(el, 'Stop').click(); await settle(el)
  expect(await value(Timer.ops.running)).toBe(false)
  const field = el.shadowRoot!.querySelector('input[type=number]') as HTMLInputElement
  field.value = '50'; field.dispatchEvent(new Event('change')); await settle(el)
  expect(await value(Timer.ops.interval)).toBe(50)
  button(el, 'Start').click(); await new Promise(r => setTimeout(r, 120)); await settle(el)
  button(el, 'Stop').click(); await settle(el)
  expect(Number(el.shadowRoot!.querySelector('.count')!.textContent)).toBeGreaterThan(0)
  button(el, 'Reset').click(); await settle(el)
  expect(await value(Timer.ops.count)).toBe(0)
  expect(el.shadowRoot!.querySelector('.count')!.textContent).toBe('0')
})

test('define() twice is harmless', () => {
  expect(() => define()).not.toThrow()
  expect(customElements.get('nano-timer')).toBeDefined()
})
