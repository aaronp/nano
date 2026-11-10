// Fixes from the kit's review: Escape in a dialog, calendar focus and keyboard, drawer sizing, names for assistive
// tech, and the menu's event name.
import { expect, test } from 'bun:test'
import { kit } from '../src'

type El = HTMLElement & { updateComplete: Promise<boolean>; [k: string]: any }
const tick = () => new Promise(r => setTimeout(r, 0))
const settle = async (...els: El[]) => { for (let i = 0; i < 3; i++) { for (const e of els) await e.updateComplete; await tick() } }
const key = (el: Element, k: string) => { const e = new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true, cancelable: true }); el.dispatchEvent(e); return e }
const mount = async (markup: string) => { document.body.innerHTML = markup; const el = document.body.firstElementChild as El; await settle(el); return el }

test('Escape closing a pop-up is cancelled, so a dialog around it stays open', async () => {
  const s = await mount('<nano-select></nano-select>'); s.options = ['a', 'b']; await settle(s)
  const trigger = s.shadowRoot!.querySelector('[role="combobox"]') as HTMLElement
  trigger.click(); await settle(s)
  expect(key(s.shadowRoot!.querySelector('.pop')!, 'Escape').defaultPrevented).toBe(true)
  await settle(s); expect(trigger.getAttribute('aria-expanded')).toBe('false')
  const p = await mount('<nano-date-picker></nano-date-picker>')
  ;(p.shadowRoot!.querySelector('.trigger') as HTMLElement).click(); await settle(p)
  expect(key(p.shadowRoot!.querySelector('.pop')!, 'Escape').defaultPrevented).toBe(true)
  const m = await mount('<nano-menu><p>x</p></nano-menu>'); m.items = [{ label: 'A' }]; await m.show({ x: 0, y: 0 })
  expect(key(m.shadowRoot!.querySelector('[role="menu"]')!, 'Escape').defaultPrevented).toBe(true)
})

test('calendar: focus() lands on the focusable day; after changing month, the keyboard starts from that month', async () => {
  const c = await mount('<nano-calendar></nano-calendar>'); c.value = '2026-11-10'; await settle(c)
  c.focus()
  expect((c.shadowRoot!.activeElement as HTMLElement | null)?.dataset.date).toBe('2026-11-10')
  ;(c.shadowRoot!.querySelector('[aria-label="Next month"]') as HTMLElement).click(); await settle(c)
  expect((c.shadowRoot!.querySelector('[tabindex="0"]') as HTMLElement).dataset.date).toBe('2026-12-01')
  const picked: string[] = []; c.addEventListener('change', () => picked.push(c.value))
  key(c.shadowRoot!.querySelector('[role="grid"]')!, 'Enter')
  expect(picked).toEqual(['2026-12-01'])
  for (let i = 0; i < 12; i++) (c.shadowRoot!.querySelector('[aria-label="Next month"]') as HTMLElement).click()
  await settle(c)
  expect(c.shadowRoot!.querySelector('[tabindex="0"]')).not.toBeNull()   // a year on, still reachable by Tab
})

test('dialogs and drawers fit the viewport, padding included', () => {
  expect(kit.cssText).toMatch(/dialog\.dialog, dialog\.drawer \{[^}]*box-sizing: border-box/)
  expect(kit.cssText).toMatch(/dialog\.drawer\.bottom \{[^}]*width: 100%/)
})

test('select: its label names the combobox', async () => {
  const s = await mount('<nano-select label="Kind"></nano-select>')
  expect(s.shadowRoot!.querySelector('[role="combobox"]')!.getAttribute('aria-label')).toBe('Kind')
})

test('menu: the active item is announced; picking emits `pick`, not the native `select`', async () => {
  const m = await mount('<nano-menu><p>x</p></nano-menu>'); m.items = [{ label: 'A' }, { label: 'B' }]
  const picked: string[] = []; m.addEventListener('pick', (e) => picked.push((e as CustomEvent).detail.label))
  await m.show({ x: 0, y: 0 })
  const menu = m.shadowRoot!.querySelector('[role="menu"]')!
  key(menu, 'ArrowDown'); await settle(m)
  const active = m.shadowRoot!.querySelector('.active')!
  expect(active.id).toBeTruthy(); expect(menu.getAttribute('aria-activedescendant')).toBe(active.id)
  key(menu, 'Enter'); expect(picked).toEqual(['B'])
})
