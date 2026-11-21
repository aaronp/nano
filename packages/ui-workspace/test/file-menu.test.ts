// File › Examples: each shipped example is one click, dispatching `file:example` with its name.
import './wires/dom.ts'
import { expect, test } from 'bun:test'
import { EXAMPLES, FileMenuEl } from '../src/components/file-menu.ts'

if (!customElements.get('nano-file-menu')) customElements.define('nano-file-menu', FileMenuEl)

test('the File menu lists the shipped examples in an Examples sub-menu, Typing first, and a click asks for that example', async () => {
  const el = document.createElement('nano-file-menu') as FileMenuEl
  document.body.append(el)
  await el.updateComplete
  const buttons = [...el.shadowRoot!.querySelectorAll<HTMLButtonElement>('button[data-example]')]
  expect(buttons.map(b => b.dataset['example'])).toEqual(EXAMPLES.map(([n]) => n))
  expect(buttons[0]!.textContent).toContain('input → debounce → map → log')
  const sub = el.shadowRoot!.querySelector<HTMLButtonElement>('[aria-controls="examples"]')!, list = el.shadowRoot!.querySelector<HTMLElement>('#examples')!
  expect(list.hidden).toBe(true)
  sub.click(); await el.updateComplete
  expect(sub.getAttribute('aria-expanded')).toBe('true'); expect(list.hidden).toBe(false)
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await el.updateComplete
  expect(list.hidden).toBe(true)
  let asked: unknown
  document.addEventListener('file:example', e => { asked = (e as CustomEvent).detail }, { once: true })
  buttons[0]!.click()
  expect(asked).toEqual({ name: 'typing' })
  el.remove()
})
