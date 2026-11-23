import { describe, expect, test } from 'bun:test'
import type { ViewTarget } from '@pritzlaff/nano-ui'
import { must, open } from './app.ts'

type El = HTMLElement & { target: ViewTarget; updateComplete: Promise<unknown> }
const mount = async (tag: string, t: ViewTarget) => {
  const el = document.createElement(tag) as El
  el.target = t
  document.body.append(el)
  await el.updateComplete
  return el
}
const settle = async (el: El) => { for (let i = 0; i < 5; i++) { await Bun.sleep(5); await el.updateComplete } }
const type = (el: El, label: string, value: string) => {
  const input = el.shadowRoot!.querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`)!
  input.value = value
  input.dispatchEvent(new Event('input'))
  input.dispatchEvent(new Event('change'))
}

describe('<nano-calculator>', () => {
  test('type 2 and 3, choose +, click =: the result is 5, and the history lists it', async () => {
    const { app, registry } = await open()
    const el = await mount('nano-calculator', { app, registry, runtime: 'main', pod: 'calculator' })
    type(el, 'a', '2'); type(el, 'operator', '+'); type(el, 'b', '3')
    el.shadowRoot!.querySelector<HTMLButtonElement>('button[aria-label="equals"]')!.click()
    await settle(el)
    expect(el.shadowRoot!.querySelector('output')!.textContent).toBe('5')
    expect([...el.shadowRoot!.querySelectorAll('li')].map(li => li.textContent)).toEqual(['2 + 3 = 5'])
  })

  test('a division by zero shows its reason; the history lists what is saved elsewhere too', async () => {
    const { app, registry } = await open()
    const el = await mount('nano-calculator', { app, registry, runtime: 'main', pod: 'calculator' })
    type(el, 'a', '1'); type(el, 'operator', '/'); type(el, 'b', '0')
    el.shadowRoot!.querySelector<HTMLButtonElement>('button[aria-label="equals"]')!.click()
    await settle(el)
    expect(el.shadowRoot!.querySelector('[role="alert"]')!.textContent).toContain('division by zero')
    must(await app.call('main', 'calculator').calculate({ a: 4, op: '*', b: 2 }))   // not from the view: heard as calculated
    await settle(el)
    expect([...el.shadowRoot!.querySelectorAll('li')].map(li => li.textContent)).toEqual(['4 * 2 = 8'])
  })
})
