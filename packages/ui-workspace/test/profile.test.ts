// <nano-profile>: the avatar opens the host's pages as links; Escape and a click outside close it.
import { GlobalRegistrator } from '@happy-dom/global-registrator'
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
import { expect, test } from 'bun:test'
const { HOST_ENTRIES } = await import('../src/components/profile-menu.ts')

type El = HTMLElement & { updateComplete: Promise<boolean> }
const settle = async (el: El) => { for (let i = 0; i < 3; i++) { await new Promise(r => setTimeout(r, 1)); await el.updateComplete } }

test('the avatar opens the menu listing the host pages in order; Escape and a click outside close it', async () => {
  document.body.innerHTML = '<nano-profile name="profile"></nano-profile>'
  const el = document.querySelector('nano-profile') as El
  await settle(el)
  const btn = el.shadowRoot!.querySelector('button')!
  expect(btn.textContent!.trim()).toBe('Y'); expect(btn.getAttribute('aria-expanded')).toBe('false')
  btn.click(); await settle(el)
  expect(btn.getAttribute('aria-expanded')).toBe('true')
  const links = [...el.shadowRoot!.querySelectorAll('nav a')].map(a => [a.textContent, a.getAttribute('href')])
  expect(links).toEqual(HOST_ENTRIES.map(e => [e.label, e.href]))
  btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true })); await settle(el)
  expect(btn.getAttribute('aria-expanded')).toBe('false')
  btn.click(); await settle(el)
  document.body.dispatchEvent(new MouseEvent('click', { bubbles: true })); await settle(el)
  expect(btn.getAttribute('aria-expanded')).toBe('false')
})
