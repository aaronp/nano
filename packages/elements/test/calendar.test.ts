// <nano-calendar> (a month grid) and <nano-date-picker> (that grid in a pop-up). Dates are ISO YYYY-MM-DD.
import { expect, test } from 'bun:test'
import '../src'

type El = HTMLElement & { updateComplete: Promise<boolean>; [k: string]: any }
const tick = () => new Promise(r => setTimeout(r, 0))
const settle = async (...els: El[]) => { for (let i = 0; i < 3; i++) { for (const e of els) await e.updateComplete; await tick() } }
const key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true }))

const calendar = async (value: string) => {
  document.body.innerHTML = '<nano-calendar></nano-calendar>'
  const c = document.querySelector('nano-calendar') as El
  c.value = value; await settle(c)
  const $ = (s: string) => c.shadowRoot!.querySelector(s) as HTMLElement
  const changes: string[] = []; c.addEventListener('change', () => changes.push(c.value))
  return { c, $, changes }
}

test('calendar: shows the value\'s month, six weeks from Sunday, with the value selected', async () => {
  const { c, $ } = await calendar('2026-11-10')
  expect($('.caption').textContent).toBe('November 2026')
  const days = [...c.shadowRoot!.querySelectorAll('[role="gridcell"] button')] as HTMLElement[]
  expect(days.length).toBe(42)
  expect(days[0]!.dataset.date).toBe('2026-11-01')            // 1 Nov 2026 is a Sunday
  expect(days[41]!.dataset.date).toBe('2026-12-12')
  expect(days[41]!.classList.contains('outside')).toBe(true)
  expect($('[aria-selected="true"]').dataset.date).toBe('2026-11-10')
})

test('calendar: clicking a day picks it; the arrows change month; the keyboard moves and picks', async () => {
  const { c, $, changes } = await calendar('2026-11-10')
  $('[data-date="2026-11-12"]').click(); await settle(c)
  expect(c.value).toBe('2026-11-12')
  $('[aria-label="Next month"]').click(); await settle(c)
  expect($('.caption').textContent).toBe('December 2026')
  $('[aria-label="Previous month"]').click(); $('[aria-label="Previous month"]').click(); await settle(c)
  expect($('.caption').textContent).toBe('October 2026')
  const grid = $('[role="grid"]')
  key(grid, 'ArrowDown'); await settle(c)                     // focus follows the selection: 12 Nov + 7
  expect($('[tabindex="0"]').dataset.date).toBe('2026-11-19')
  expect($('.caption').textContent).toBe('November 2026')
  key(grid, 'ArrowLeft'); key(grid, 'Enter'); await settle(c)
  expect(changes).toEqual(['2026-11-12', '2026-11-18'])
})

test('date picker: shows the date, opens a calendar, closes on a pick', async () => {
  document.body.innerHTML = '<nano-date-picker></nano-date-picker>'
  const p = document.querySelector('nano-date-picker') as El
  await settle(p)
  const trigger = p.shadowRoot!.querySelector('button.trigger') as HTMLElement
  expect(trigger.textContent).toContain('Pick a date')
  p.value = '2026-11-10'; await settle(p)
  expect(trigger.textContent).toContain('Nov 10, 2026')
  trigger.click(); await settle(p)
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  const cal = p.shadowRoot!.querySelector('nano-calendar') as El
  await settle(cal)
  ;(cal.shadowRoot!.querySelector('[data-date="2026-11-20"]') as HTMLElement).click(); await settle(p, cal)
  expect(p.value).toBe('2026-11-20')
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
})
