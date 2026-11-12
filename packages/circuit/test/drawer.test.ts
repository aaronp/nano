import { afterEach, expect, test } from 'bun:test'
import { ApplicationOps as P } from '@pritzlaff/nano-app'
import { mount } from './mount'

afterEach(() => { document.body.innerHTML = '' })

test('selecting a pad opens the drawer with its type', async () => {
  const { root, settle } = await mount()
  expect(root.querySelector('aside')!.hasAttribute('hidden')).toBe(true)
  root.querySelector<HTMLElement>('button.pad[aria-label="r.value, Number, out"]')!.click(); await settle()
  const d = root.querySelector('aside[aria-label="Details"]')!
  expect(d.textContent).toContain('r.value')
  expect(d.textContent).toContain('Number')
  expect(d.querySelector('pre')!.textContent).toContain('"type"')
  d.querySelector<HTMLElement>('button[aria-label="Close details"]')!.click(); await settle()
  expect(root.querySelector('aside')!.hasAttribute('hidden')).toBe(true)
})

test('a tab and a cable open the drawer; Escape closes it', async () => {
  const { el, root, settle } = await mount()
  root.querySelector<HTMLElement>('button.tab[data-tab="d"]')!.click(); await settle()
  expect(root.querySelector('aside')!.textContent).toContain('d')
  root.querySelector<HTMLElement>('g[data-cable-hit]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); await settle()
  expect(root.querySelector('aside')!.textContent).toContain('→')
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await settle()
  expect(root.querySelector('aside')!.hasAttribute('hidden')).toBe(true)
})

test("Follow cable focuses the other end's page", async () => {
  const { call, el, root, settle } = await mount()
  await call(P.setScreen, { id: '/a', title: 'Alpha', system: 'host', layout: [{ panel: 'r', instance: 'r' }, { panel: 'd', instance: 'd' }] })
  await settle()
  expect(el.page).toBe('/a')
  root.querySelector<HTMLElement>('button.pad[aria-label="d.flushed, Any, out"], button.pad[data-pad$="flushed"]')!.click(); await settle()
  ;[...root.querySelectorAll<HTMLElement>('aside button')].find(b => b.textContent === 'Follow cable')!.click(); await settle()
  expect(el.page).toBe('/b')
})
