import { afterEach, expect, test } from 'bun:test'
import { mount } from './mount'

afterEach(() => { document.body.innerHTML = '' })
const cover = (root: ShadowRoot, inst = 'l') => root.querySelector<HTMLElement>(`[data-screen="/a"] .cover[data-cover="${inst}"]`)

test('the slider lifts covers', async () => {
  const { root, settle } = await mount()
  expect(cover(root)!.style.transform).toContain('translateZ(0px)')
  const s = root.querySelector<HTMLInputElement>('input[type=range]')!
  s.value = '100'; s.dispatchEvent(new Event('input', { bubbles: true }))
  await settle()
  expect(cover(root)!.style.transform).toMatch(/translateZ\((?!0px)/)
  expect(cover(root)!.textContent).toContain('Log')
})

test('Lift covers toggles between 0.85 and 0', async () => {
  const { el, root, settle } = await mount()
  const t = root.querySelector<HTMLElement>('button.lift')!
  expect(t.textContent).toContain('Lift covers')
  t.click(); await settle()
  expect(el.s.lift).toBe(0.85)
  expect(root.querySelector('button.lift')!.textContent).toContain('Put covers back')
})

test('Delete hides the selected cover; Put covers back restores it', async () => {
  const { el, root, settle } = await mount()
  cover(root)!.click(); await settle()
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
  await settle()
  expect(cover(root)).toBeNull()
  root.querySelector<HTMLElement>('button.lift')!.click(); await settle()   // lift
  root.querySelector<HTMLElement>('button.lift')!.click(); await settle()   // put back
  expect(cover(root)).not.toBeNull()
})

test('dragging a cover far enough hides it', async () => {
  const { root, settle } = await mount()
  const drag = (dx: number) => {
    cover(root)!.dispatchEvent(new MouseEvent('pointerdown', { clientX: 100, clientY: 100, bubbles: true }))
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 100 + dx, clientY: 100 }))
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: 100 + dx, clientY: 100 }))
  }
  drag(100); await settle()
  expect(cover(root)).not.toBeNull()
  drag(200); await settle()
  expect(cover(root)).toBeNull()
})
