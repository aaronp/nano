// <c-wires>: the connections view; see wires-mount.ts for the stand-in dock.
import './dom.ts'
import { afterEach, expect, test } from 'bun:test'
import { defineWires } from '../../src/wires'
import { onDown, onUp, removeSel, toggleEdit } from '../../src/wires/pointer'
import { box, mount } from './wires-mount.ts'

defineWires()
afterEach(() => { document.body.innerHTML = '' })

test('selecting a rack module and removing it removes the instance; the palette adds new ones', async () => {
  const { el, host, root, flip, settle } = await mount()
  await flip()
  toggleEdit(el)
  await settle()
  const m = el.model.rack.find(r => r.id === 'm')!
  onDown(el, { clientX: m.x + 5, clientY: m.y + 80 })
  await onUp(el, { clientX: m.x + 5, clientY: m.y + 80 })
  expect(el.s.selMod).toBe('m')
  await removeSel(el)
  await settle()
  expect(host.data().pods['m']).toBeUndefined()
  expect(el.model.rack.map(r => r.id)).toEqual(['d'])
  ;(root.querySelector('[data-kind="nano.ui/debounce"]') as HTMLButtonElement).click()
  await settle(); await settle()
  expect(host.data().pods['debounce1']).toBeDefined()
  expect(el.model.rack.map(r => r.id)).toEqual(['d', 'debounce1'])
})

test('dragging a rack module onto the pane asks the workspace to open it', async () => {
  const { el, flip, settle } = await mount()
  await flip()
  toggleEdit(el)
  const opened: unknown[] = []
  document.addEventListener('wires:open-panel', e => opened.push((e as CustomEvent).detail))
  const d = el.model.rack.find(r => r.id === 'd')!
  onDown(el, { clientX: d.x + 5, clientY: d.y + 80 })
  await onUp(el, { clientX: 300, clientY: 200 })
  await settle()
  expect(opened).toEqual([{ kind: 'nano.ui/debounce', name: 'd' }])
})
test('a panel that is not showing (an inactive tab) is not drawn on the pane; its component waits in the rack', async () => {
  const { el, dock, flip } = await mount()
  const hidden = document.createElement('div')
  hidden.className = 'dock-panel'
  hidden.innerHTML = '<x-m></x-m>'
  Object.assign(hidden.querySelector('x-m')!, { target: { pod: 'm' } })
  box(hidden, 0, 0, 0, 0)   // display:none: no size
  dock.append(hidden)
  await flip()
  expect(el.model.chassis.length).toBe(3)
  expect(el.model.chassis.some(c => c.instance === 'm')).toBe(false)
  expect(el.model.rack.map(r => r.id)).toContain('m')
})
// a pod's isolation is its deploy mode; the stand-in host reports one without running a frame
const isolate = (host: { data(): any }, pod: string, isolation: string) => {
  const real = host.data.bind(host)
  host.data = () => { const d = real(); d.pods[pod] = { ...d.pods[pod], isolation }; return d }
}

test('modules carry data-deploy; the toggle marks exactly the non-host ones, and is off by default', async () => {
  const { host, root, flip, settle } = await mount()
  isolate(host, 'd', 'sandbox')
  await flip()
  expect(root.querySelector('[data-module="m"]')).toBeNull()   // Show: Connected hides the unwired m
  ;[...root.querySelectorAll<HTMLElement>('[aria-label="Show"] button')].find(b => b.textContent === 'All')!.click(); await settle()
  expect(root.querySelector('[data-module="d"]')!.getAttribute('data-deploy')).toBe('sandbox')
  expect(root.querySelector('[data-module="m"]')!.getAttribute('data-deploy')).toBe('host')
  const toggle = () => root.querySelector('button.highlight') as HTMLElement
  expect(toggle().textContent).toBe('Highlight sandboxed')
  expect(toggle().getAttribute('aria-pressed')).toBe('false')
  expect(root.querySelectorAll('[data-mark]').length).toBe(0)
  toggle().click(); await settle()
  expect(toggle().getAttribute('aria-pressed')).toBe('true')
  expect([...root.querySelectorAll('[data-mark]')].map(e => e.getAttribute('data-module'))).toEqual(['d'])
})

test('a docked panel\'s chassis carries data-deploy and is marked by the toggle', async () => {
  const { host, root, flip, settle } = await mount()
  isolate(host, 'r', 'isolated-sandbox')
  await flip()
  const chassis = (id: string) => root.querySelector(`[data-chassis="${id}"]`) as HTMLElement
  expect(chassis('panel-0').getAttribute('data-deploy')).toBe('isolated-sandbox')   // r
  expect(chassis('panel-1').getAttribute('data-deploy')).toBe('host')               // l
  expect(chassis('panel-2').hasAttribute('data-deploy')).toBe(false)                // no instance
  expect(root.querySelectorAll('[data-chassis][data-mark]').length).toBe(0)
  ;(root.querySelector('button.highlight') as HTMLElement).click(); await settle()
  expect([...root.querySelectorAll('[data-chassis][data-mark]')].map(e => e.getAttribute('data-chassis'))).toEqual(['panel-0'])
})
