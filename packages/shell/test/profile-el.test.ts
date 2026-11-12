import { expect, test } from 'bun:test'
import { Ops, Registries, Runtimes } from '@pritzlaff/nano-core'
import { provide } from '@pritzlaff/nano-elements'
import { defineShell, Profile } from '../src'
import { tick } from './fixtures'

defineShell()
const rt = Runtimes.create(Registries.create('page')), reg = rt.registry
provide(document, reg)
type El = HTMLElement & { updateComplete: Promise<boolean> }
const settle = async (el: El) => { for (let i = 0; i < 3; i++) { await tick(); await el.updateComplete } }
const set = (id: string, op: any, arg: unknown) => rt.call({ registry: 'page', instance: 't' }, id, Ops.key(op), arg)
const place = async (name: string, user: unknown, entries: unknown[] = []) => {
  document.body.insertAdjacentHTML('beforeend', `<nano-profile name="${name}"></nano-profile>`)
  const el = document.body.lastElementChild as El
  await settle(el); await set(name, Profile.ops.setUser, user); await set(name, Profile.ops.setEntries, entries); await settle(el)
  return el
}
const q = (el: El, s: string) => el.shadowRoot!.querySelector(s) as HTMLElement

test('shows initials without an avatar and the image with one', async () => {
  const el = await place('a', { name: 'Ada Lovelace' })
  expect(q(el, 'button')!.textContent).toContain('AL'); expect(q(el, 'img')).toBeNull()
  await set('a', Profile.ops.setUser, { name: 'Ada', avatar: 'https://x.test/a.png' }); await settle(el)
  expect(q(el, 'img')!.getAttribute('src')).toBe('https://x.test/a.png')
})

test('a javascript: avatar shows initials', async () => {
  const el = await place('b', { name: 'Bob', avatar: 'javascript:alert(1)' })
  expect(q(el, 'img')).toBeNull(); expect(q(el, 'button')!.textContent).toContain('B')
  expect(el.shadowRoot!.innerHTML).not.toContain('javascript:')
})

test('the button opens the menu (aria-expanded true) listing entries as links in order', async () => {
  const el = await place('c', { name: 'Cy' }, [{ label: 'Systems', href: '#/systems' }, { label: 'Themes', href: '#/themes' }])
  const btn = q(el, 'button')
  expect(btn.hasAttribute('aria-haspopup')).toBe(false); expect(btn.getAttribute('aria-controls')).toBe(q(el, 'nav')!.id); expect(btn.getAttribute('aria-expanded')).toBe('false')
  btn.click(); await settle(el)
  expect(btn.getAttribute('aria-expanded')).toBe('true')
  const links = [...el.shadowRoot!.querySelectorAll('nav a')] as HTMLAnchorElement[]
  expect(links.map(a => [a.textContent!.trim(), a.getAttribute('href')])).toEqual([['Systems', '#/systems'], ['Themes', '#/themes']])
})

test('Escape closes and focus returns to the button; a click outside closes', async () => {
  const el = await place('d', { name: 'Di' }, [{ label: 'Systems', href: '#/systems' }])
  const btn = q(el, 'button')
  btn.click(); await settle(el)
  ;(q(el, 'nav a') as HTMLElement).focus()
  q(el, 'nav').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true })); await settle(el)
  expect(btn.getAttribute('aria-expanded')).toBe('false'); expect(el.shadowRoot!.activeElement).toBe(btn)
  btn.click(); await settle(el)
  document.body.dispatchEvent(new MouseEvent('click', { bubbles: true })); await settle(el)
  expect(btn.getAttribute('aria-expanded')).toBe('false')
})

test('Escape with focus on the button closes the menu and keeps focus there', async () => {
  const el = await place('e', { name: 'Ed' }, [{ label: 'Systems', href: '#/systems' }])
  const btn = q(el, 'button'); btn.click(); await settle(el); btn.focus()
  btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true })); await settle(el)
  expect(btn.getAttribute('aria-expanded')).toBe('false'); expect(el.shadowRoot!.activeElement).toBe(btn)
})

test('focus leaving the component closes the menu', async () => {
  const el = await place('f', { name: 'Fy' }, [{ label: 'Systems', href: '#/systems' }])
  const btn = q(el, 'button'); btn.click(); await settle(el)
  btn.dispatchEvent(new FocusEvent('focusout', { bubbles: true, composed: true, relatedTarget: document.body })); await settle(el)
  expect(btn.getAttribute('aria-expanded')).toBe('false')
})

test('focusout with no related target (Safari link mousedown) keeps the menu open', async () => {
  const el = await place('f2', { name: 'Fy' }, [{ label: 'Systems', href: '#/systems' }])
  const btn = q(el, 'button'); btn.click(); await settle(el)
  btn.dispatchEvent(new FocusEvent('focusout', { bubbles: true, composed: true, relatedTarget: null })); await settle(el)
  expect(btn.getAttribute('aria-expanded')).toBe('true')
})
