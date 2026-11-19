// <c-wires>: the connections view; see wires-mount.ts for the stand-in dock.
import './dom.ts'
import { afterEach, expect, test } from 'bun:test'
import { defineWires } from '../../src/wires'
import { onDown, onUp } from '../../src/wires/pointer'
import { Input, k } from './setup.ts'
import { mount } from './wires-mount.ts'

defineWires()
afterEach(() => { document.body.innerHTML = '' })

test('the Routes list shows each route as its chain', async () => {
  const { root, flip } = await mount()
  await flip()
  expect(root.querySelector('aside')!.textContent).toContain('r.submit → d → l.log')
})
test('clicking a jack on the back selects its port, and Detail shows its op, schemas and connections', async () => {
  const { el, root, flip, settle, at } = await mount()
  await flip()
  const jack = at(k('r', Input, 'submit', 'out'))
  onDown(el, jack); await onUp(el, jack); await settle(); await settle()
  expect(el.s.picked).toEqual({ system: 'main', instance: 'r', op: 'nano.ui.Input/submit' })
  expect(el.s.tab).toBe('detail')
  const card = root.querySelector('.detail')!.textContent!
  expect(card).toContain('nano.ui.Input/submit')
  expect(card).toContain('action')
  expect(card).toContain('r.submit → d.push')
})

test('clicking a panel selects its component: coordinates, kind, jacks and connections', async () => {
  const { el, root, flip, settle } = await mount()
  await flip()
  const c = el.model.chassis.find(x => x.instance === 'r')!, mid = { clientX: c.x + c.w / 2, clientY: c.y + c.h / 2 }   // the back is the front mirrored
  onDown(el, mid); await onUp(el, mid); await settle(); await settle()
  expect(el.s.picked).toEqual({ system: 'main', instance: 'r' })
  const card = root.querySelector('.detail')!.textContent!
  expect(card).toContain('main / r')
  expect(card).toContain('nano.ui/input')
  expect(card).toContain('r.submit → d.push')
})

test('the drawer has View and Detail tabs; Detail holds the app\'s tree', async () => {
  const { root, flip, settle } = await mount()
  await flip()
  const tab = (name: string) => [...root.querySelectorAll('[role="tab"]')].find(t => t.textContent!.trim() === name) as HTMLButtonElement
  expect(tab('View').getAttribute('aria-selected')).toBe('true')
  tab('Detail').click(); await settle()
  expect(root.querySelector('.detail')!.textContent).toContain('Click a panel')
  expect(root.querySelector('nano-explorer')).not.toBeNull()
  tab('View').click(); await settle()
  expect(root.querySelector('nano-explorer')).toBeNull()
})
