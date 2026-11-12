// The Wiring page: it opens on the last workspace shown, and Connections goes back to that workspace's dock.
import { GlobalRegistrator } from '@happy-dom/global-registrator'
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
import { expect, test } from 'bun:test'
import { createBus, provideBus } from '../src/lib/bus.ts'
import { bootWiring } from '../src/boot-wiring.ts'
import { HOST_ENTRIES } from '../src/app/stores.ts'

const tick = () => new Promise(r => setTimeout(r, 5))
const setup = () => {
  document.body.innerHTML = `<div id="shell"><app-route path="/workspace"><workspace-dock></workspace-dock></app-route>
    <app-route path="/wiring"><a href="#/wiring">Circuit</a><a href="#/workspace" data-connections hidden>Connections</a><c-circuit></c-circuit></app-route></div>`
  const bus = createBus()
  provideBus(document.getElementById('shell')!, bus)
  let flips = 0
  Object.assign(document.querySelector('workspace-dock')!, { connections: () => { flips++ } })
  bootWiring(document, async () => [{ id: '/workspace' }, { id: '/lab' }])
  const go = async (path: string) => { bus.publish('route:changed', { path }, 'test'); await tick() }
  return { go, flips: () => flips, circuit: document.querySelector('c-circuit') as any, link: document.querySelector('a[data-connections]') as HTMLAnchorElement }
}

test('the profile menu lists Wiring after Themes', () => {
  const labels = HOST_ENTRIES.map(e => e.label)
  expect(labels.slice(labels.indexOf('Themes'))).toEqual(['Themes', 'Wiring'])
  expect(HOST_ENTRIES.at(-1)).toEqual({ label: 'Wiring', href: '#/wiring' })
})

test('opening Wiring after a workspace focuses that page', async () => {
  const t = setup()
  await t.go('/lab'); await t.go('/settings'); await t.go('/wiring')   // /settings is not a screen
  expect(t.circuit.page).toBe('/lab')
  expect(t.link.hidden).toBe(false)
  expect(t.link.getAttribute('href')).toBe('#/lab')
})

const frame = () => new Promise(r => requestAnimationFrame(() => r(null)))

test('Connections flips the dock once, when the target route is shown', async () => {
  const t = setup()
  await t.go('/workspace'); await t.go('/wiring')
  t.link.click(); t.link.click()   // a double click does not stack
  expect(t.flips()).toBe(0)
  await t.go('/workspace'); await frame(); await tick()
  expect(t.flips()).toBe(1)
  await t.go('/wiring'); await t.go('/workspace'); await frame()
  expect(t.flips()).toBe(1)
})

test('a modified click does not arm, and an unrelated navigation spends the arm', async () => {
  const t = setup()
  await t.go('/workspace'); await t.go('/wiring')
  t.link.dispatchEvent(new MouseEvent('click', { ctrlKey: true, button: 0 }))
  await t.go('/workspace'); await frame()
  expect(t.flips()).toBe(0)
  await t.go('/wiring'); t.link.click()
  await t.go('/settings'); await t.go('/workspace'); await frame()
  expect(t.flips()).toBe(0)
})

test('opening Wiring first focuses the first page and hides Connections', async () => {
  const t = setup()
  await t.go('/settings'); await t.go('/wiring')
  expect(t.circuit.page).toBeNull()
  expect(t.link.hidden).toBe(true)
})
