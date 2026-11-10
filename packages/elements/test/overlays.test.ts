// <nano-menu> (a context menu), <nano-hover-card>, toast() with <nano-toaster>, and <nano-code-block>.
import { expect, test } from 'bun:test'
import { toast } from '../src'

type El = HTMLElement & { updateComplete: Promise<boolean>; [k: string]: any }
const wait = (ms = 0) => new Promise(r => setTimeout(r, ms))
const settle = async (...els: El[]) => { for (let i = 0; i < 3; i++) { for (const e of els) await e.updateComplete; await wait() } }
const key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true }))

test('menu: right-click opens it at the pointer; arrows skip separators and disabled items; Enter picks and closes', async () => {
  document.body.innerHTML = '<nano-menu><div id="area">Right-click here</div></nano-menu>'
  const m = document.querySelector('nano-menu') as El
  m.items = [{ label: 'Rename', shortcut: '⌘R' }, { label: 'Duplicate', disabled: true }, { separator: true }, { label: 'Delete', danger: true }]
  await settle(m)
  const picked: string[] = []; m.addEventListener('pick', (e) => picked.push((e as CustomEvent).detail.label))
  document.getElementById('area')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, composed: true, cancelable: true, clientX: 40, clientY: 50 }))
  await settle(m)
  expect(m.open).toBe(true)
  const menu = m.shadowRoot!.querySelector('[role="menu"]') as HTMLElement
  expect([...menu.querySelectorAll('[role="menuitem"]')].map(i => i.textContent!.trim().replace(/\s+/g, ' '))).toEqual(['Rename⌘R', 'Duplicate', 'Delete'])
  expect(menu.querySelector('[role="separator"]')).not.toBeNull()
  key(menu, 'ArrowDown'); await settle(m)
  expect(menu.querySelector('.active')!.textContent).toContain('Delete')
  key(menu, 'Enter'); await settle(m)
  expect(picked).toEqual(['Delete'])
  expect(m.open).toBe(false)
})

test('hover card: opens after its delay when the pointer rests on the trigger, closes when it leaves', async () => {
  document.body.innerHTML = '<nano-hover-card open-delay="0" close-delay="0"><a href="#">@nano</a><div slot="card">The card</div></nano-hover-card>'
  const h = document.querySelector('nano-hover-card') as El
  await settle(h)
  const trigger = h.shadowRoot!.querySelector('.trigger')!
  trigger.dispatchEvent(new Event('pointerenter')); await wait(5); await settle(h)
  expect(h.hasAttribute('open')).toBe(true)
  trigger.dispatchEvent(new Event('pointerleave')); await wait(5); await settle(h)
  expect(h.hasAttribute('open')).toBe(false)
})

test('toast: shows in one toaster, in its variant; leaves after its duration, or when closed', async () => {
  document.body.innerHTML = ''
  toast('Saved', { description: '3 connections made', variant: 'good', duration: 20 })
  toast('Stays', { duration: 0 })
  const t = document.querySelector('nano-toaster') as El
  expect(document.querySelectorAll('nano-toaster').length).toBe(1)
  await settle(t)
  const toasts = () => [...t.shadowRoot!.querySelectorAll('.toast')] as HTMLElement[]
  expect(toasts().map(x => x.querySelector('.title')!.textContent)).toEqual(['Saved', 'Stays'])
  expect(toasts()[0]!.classList.contains('good')).toBe(true)
  expect(t.shadowRoot!.querySelector('[aria-live="polite"]')).not.toBeNull()
  await wait(40); await settle(t)
  expect(toasts().map(x => x.querySelector('.title')!.textContent)).toEqual(['Stays'])
  ;(toasts()[0]!.querySelector('[aria-label="Close"]') as HTMLElement).click(); await settle(t)
  expect(toasts().length).toBe(0)
})

test('code block: shows the code and its language, and copies it', async () => {
  let copied = ''
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (s: string) => { copied = s } } })
  document.body.innerHTML = '<nano-code-block language="ts"></nano-code-block>'
  const c = document.querySelector('nano-code-block') as El
  c.code = 'const x = 1\n'; await settle(c)
  expect(c.shadowRoot!.querySelector('pre.code')!.textContent).toBe('const x = 1\n')
  expect(c.shadowRoot!.querySelector('.lang')!.textContent).toBe('ts')
  ;(c.shadowRoot!.querySelector('[aria-label="Copy"]') as HTMLElement).click(); await settle(c)
  expect(copied).toBe('const x = 1\n')
  expect(c.shadowRoot!.querySelector('[aria-label="Copy"]')!.textContent).toContain('Copied')
})
