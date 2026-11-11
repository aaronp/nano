import './dom'
import { expect, test } from 'bun:test'
import { defineShell } from '../src'
import { tick } from './fixtures'

defineShell()
type El = HTMLElement & { updateComplete: Promise<boolean>; dirty: boolean }
const settle = async (el: El) => { for (let i = 0; i < 3; i++) { await tick(); await el.updateComplete } }
const place = async (dirty = true) => {
  document.body.insertAdjacentHTML('beforeend', '<nano-file-menu></nano-file-menu>')
  const el = document.body.lastElementChild as El; el.dirty = dirty; await settle(el); return el
}
const q = (el: El, s: string) => el.shadowRoot!.querySelector(s) as HTMLButtonElement
const toggle = (el: El) => q(el, 'button')

test('File opens a list of six commands in order', async () => {
  const el = await place(); expect(toggle(el).getAttribute('aria-expanded')).toBe('false')
  toggle(el).click(); await settle(el)
  expect(toggle(el).getAttribute('aria-expanded')).toBe('true'); expect(toggle(el).getAttribute('aria-controls')).toBe(q(el, '#panel').id)
  expect([...el.shadowRoot!.querySelectorAll('#panel button')].map(b => b.textContent!.trim())).toEqual(['New', 'Open…', 'Import…', 'Save', 'Save As…', 'Download'])
})

test('each command dispatches its bubbling composed event and closes', async () => {
  const el = await place(), seen: Event[] = []
  for (const c of ['new', 'open', 'import', 'save', 'save-as', 'download']) {
    document.addEventListener(`file:${c}`, e => seen.push(e), { once: true })
    toggle(el).click(); await settle(el); q(el, `[data-cmd="${c}"]`).click(); await settle(el)
    expect(toggle(el).getAttribute('aria-expanded')).toBe('false')
  }
  expect(seen.map(e => e.type)).toEqual(['file:new', 'file:open', 'file:import', 'file:save', 'file:save-as', 'file:download'])
  expect(seen.every(e => e.bubbles && e.composed)).toBe(true)
})

test('Escape and outside click close; focusout to an outside node closes, to null does not', async () => {
  const el = await place(); toggle(el).click(); await settle(el)
  toggle(el).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true })); await settle(el)
  expect(toggle(el).getAttribute('aria-expanded')).toBe('false')
  toggle(el).click(); await settle(el); document.body.dispatchEvent(new MouseEvent('click', { bubbles: true })); await settle(el)
  expect(toggle(el).getAttribute('aria-expanded')).toBe('false')
  toggle(el).click(); await settle(el)
  toggle(el).dispatchEvent(new FocusEvent('focusout', { bubbles: true, composed: true, relatedTarget: null })); await settle(el)
  expect(toggle(el).getAttribute('aria-expanded')).toBe('true')
  toggle(el).dispatchEvent(new FocusEvent('focusout', { bubbles: true, composed: true, relatedTarget: document.body })); await settle(el)
  expect(toggle(el).getAttribute('aria-expanded')).toBe('false')
})

test('Save is disabled when not dirty', async () => {
  const el = await place(false); const save = () => q(el, '[data-cmd="save"]')
  expect(save().disabled).toBe(true); el.dirty = true; await settle(el); expect(save().disabled).toBe(false)
})
