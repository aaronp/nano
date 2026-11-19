// <c-wires>: the connections view; see wires-mount.ts for the stand-in dock.
import './dom.ts'
import { afterEach, expect, test } from 'bun:test'
import { defineWires } from '../../src/wires'
import { k, tick } from './setup.ts'
import { mount } from './wires-mount.ts'

defineWires()
afterEach(() => { document.body.innerHTML = '' })

test('unflipped it is just the dock; dock:connections flips it to the 3D view and back', async () => {
  const { el, root, flip, settle } = await mount()
  expect(root.querySelector('.stage-bg')).toBeNull()
  expect(root.querySelector('slot')).not.toBeNull()
  await flip()
  expect(el.flipped).toBe(true)
  expect(el.hasAttribute('flipped')).toBe(true)
  expect(root.querySelector('.front slot')).not.toBeNull()
  expect(root.querySelector('aside')!.textContent).toContain('Behind the pane')
  expect(root.querySelectorAll('[data-wire]').length).toBe(2)
  expect(root.querySelector('[data-module="d"]')).not.toBeNull()
  expect(root.textContent).toContain('r → l')
  expect(document.head.querySelectorAll('link[data-wires-fonts]').length).toBe(1)
  await flip()
  await new Promise(r => setTimeout(r, 950)); await settle()
  expect(el.flipped).toBe(false)
  expect(root.querySelector('.stage-bg')).toBeNull()
})

test('a pipe message pulses its wire', async () => {
  const { el, s1, flip, settle, submit } = await mount()
  await flip()
  await submit(42)
  await settle()
  expect(el.s.packets.map(p => [p.wire, p.label])[0]).toEqual([s1.id, 'push'])
  expect(el.s.stats['d']!.in).toBe(1)
})
test('removed from the page, it stops listening', async () => {
  const { el, submit } = await mount()
  el.remove()
  await submit(7)
  await tick()
  expect(el.s.packets).toEqual([])
})

test('while flat it does no work: no packets pile up, and none fly in when it flips', async () => {
  const { el, submit, flip, settle } = await mount()
  await submit(7)
  await settle()
  expect(el.s.packets).toEqual([])
  await flip()
  expect(el.s.packets).toEqual([])
})

test('opening eases the pane straight back from full size to 90% of the stage, with no turn', async () => {
  const { root, flip } = await mount()
  await flip()
  const world = () => (root.querySelector('.world') as HTMLElement).style
  expect(world().transform).toContain('scale(1)')
  await new Promise(r => setTimeout(r, 80))
  await tick()
  expect(world().transform).toContain('scale(0.9)')
  expect(world().transform).toContain('rotateX(0.00deg) rotateY(0.00deg)')
  expect(world().transition).toContain('cubic-bezier(0.65, 0, 0.35, 1)')
})

test('the edit drawer fades in once the pane has dropped back; Done fades it out and eases the pane back to full size', async () => {
  const { el, root, flip, settle } = await mount()
  await flip()
  const aside = () => (root.querySelector('aside') as HTMLElement).style
  const world = () => (root.querySelector('.world') as HTMLElement).style
  expect(aside().opacity).toBe('0')
  await new Promise(r => setTimeout(r, 80)); await settle()
  expect(aside().opacity).toBe('1')
  expect(aside().transition).toContain('900ms')   // waits for the drop-back
  el.setState({ ry: 180 })
  ;(root.querySelector('[aria-label="Back to the workspace"]') as HTMLButtonElement).click()
  await settle()
  expect(el.flipped).toBe(true)
  expect(aside().opacity).toBe('0')
  expect(world().transform).toContain('scale(1)')
  expect(world().transform).toContain('rotateX(0.00deg) rotateY(360.00deg)')
  await new Promise(r => setTimeout(r, 950)); await settle()
  expect(el.flipped).toBe(false)
})

test('pinch or ctrl/cmd+scroll zooms the view, scrolling pans it, and Fit puts it back', async () => {
  const { el, root, flip, settle } = await mount()
  await flip(); await new Promise(r => setTimeout(r, 80)); await settle()
  const stage = root.querySelector('.stage-bg') as HTMLElement
  const world = () => (root.querySelector('.world') as HTMLElement).style.transform
  // happy-dom's WheelEvent drops the mouse fields (ctrlKey, metaKey, clientX…), so they are set on the event
  const wheel = (init: Record<string, number | boolean>) => {
    const e = new WheelEvent('wheel', { deltaX: Number(init.deltaX ?? 0), deltaY: Number(init.deltaY ?? 0), bubbles: true, cancelable: true })
    for (const k of ['ctrlKey', 'metaKey', 'clientX', 'clientY']) Object.defineProperty(e, k, { value: init[k] ?? (k.endsWith('Key') ? false : 0) })
    stage.dispatchEvent(e)
  }
  wheel({ deltaY: -100, ctrlKey: true, clientX: 600, clientY: 300 })
  await settle()
  expect(el.s.zoom).toBeGreaterThan(1)
  expect(el.s.zoom).toBeLessThanOrEqual(4)
  const [px, py] = [el.s.panX, el.s.panY]   // zooming about the pointer moved it
  wheel({ deltaX: 30, deltaY: 40 })
  await settle()
  expect([el.s.panX - px, el.s.panY - py]).toEqual([-30, -40])
  expect(world()).toContain(`translate(${-170 + el.s.panX}px`)
  expect(world()).toContain(`scale(${+(0.9 * el.s.zoom).toFixed(4)})`)
  for (let i = 0; i < 40; i++) wheel({ deltaY: 500, metaKey: true })
  await settle()
  expect(el.s.zoom).toBe(0.25)
  ;(root.querySelector('[aria-label="Fit the view"]') as HTMLButtonElement).click(); await settle()
  expect([el.s.zoom, el.s.panX, el.s.panY]).toEqual([1, 0, 0])
  ;(root.querySelector('[aria-label="Zoom in"]') as HTMLButtonElement).click(); await settle()
  expect(el.s.zoom).toBeGreaterThan(1)
})

test('every cord glows and shows its direction of flow', async () => {
  const { root, flip } = await mount()
  await flip()
  const cords = [...root.querySelectorAll('[data-wire]')]
  expect(cords.length).toBe(2)
  for (const c of cords) { expect(c.querySelector('.glow')).not.toBeNull(); expect(c.querySelector('.flow')).not.toBeNull() }
})
