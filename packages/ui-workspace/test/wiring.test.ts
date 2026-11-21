// The Desk page: Connections goes back to the last workspace shown and flips its dock.
import { GlobalRegistrator } from '@happy-dom/global-registrator'
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
import { expect, test } from 'bun:test'
import { createBus, provideBus } from '../src/lib/bus.ts'
import { bootWiring } from '../src/boot-wiring.ts'
import { HOST_ENTRIES } from '../src/components/profile-menu.ts'

const tick = () => new Promise(r => setTimeout(r, 5))
const setup = () => {
  document.body.innerHTML = `<div id="shell"><app-route path="/p/workspace"><workspace-dock></workspace-dock></app-route>
    <app-route path="/desk"><a href="#/p/workspace" data-connections hidden>Connections</a><a href="#/p/workspace" data-connections hidden>Connections</a><c-desk></c-desk></app-route></div>`
  const bus = createBus()
  provideBus(document.getElementById('shell')!, bus)
  let flips = 0
  Object.assign(document.querySelector('workspace-dock')!, { connections: () => { flips++ } })
  bootWiring(document, async () => [{ id: '/p/workspace' }, { id: '/lab' }])
  const go = async (path: string) => { bus.publish('route:changed', { path }, 'test'); await tick() }
  return { go, flips: () => flips, link: document.querySelector('a[data-connections]') as HTMLAnchorElement }
}

test('the profile menu lists Desk after Themes, and no Wiring', () => {
  const labels = HOST_ENTRIES.map(e => e.label)
  expect(labels.slice(labels.indexOf('Themes'))).toEqual(['Themes', 'Desk'])
  expect(HOST_ENTRIES.at(-1)).toEqual({ label: 'Desk', href: '#/desk' })
})

test('opening the Desk after a workspace points Connections at that page', async () => {
  const t = setup()
  await t.go('/lab'); await t.go('/settings'); await t.go('/desk')   // /settings is not a screen
  expect(t.link.hidden).toBe(false)
  expect(t.link.getAttribute('href')).toBe('#/lab')
})

const frame = () => new Promise(r => requestAnimationFrame(() => r(null)))

test('Connections flips the dock once, when the target route is shown', async () => {
  const t = setup()
  await t.go('/p/workspace'); await t.go('/desk')
  t.link.click(); t.link.click()   // a double click does not stack
  expect(t.flips()).toBe(0)
  await t.go('/p/workspace'); await frame(); await tick()
  expect(t.flips()).toBe(1)
  await t.go('/desk'); await t.go('/p/workspace'); await frame()
  expect(t.flips()).toBe(1)
})

test('Connections leaves an already-flipped dock alone', async () => {
  const t = setup()
  document.querySelector('app-route[path="/p/workspace"]')!.insertAdjacentHTML('beforeend', '<c-wires></c-wires>')
  Object.assign(document.querySelector('c-wires')!, { flipped: true })
  await t.go('/p/workspace'); await t.go('/desk')
  t.link.click()
  await t.go('/p/workspace'); await frame(); await tick()
  expect(t.flips()).toBe(0)
})

test('a modified click does not arm, and an unrelated navigation spends the arm', async () => {
  const t = setup()
  await t.go('/p/workspace'); await t.go('/desk')
  t.link.dispatchEvent(new MouseEvent('click', { ctrlKey: true, button: 0 }))
  await t.go('/p/workspace'); await frame()
  expect(t.flips()).toBe(0)
  await t.go('/desk'); t.link.click()
  await t.go('/settings'); await t.go('/p/workspace'); await frame()
  expect(t.flips()).toBe(0)
})

test('opening the Desk first hides Connections', async () => {
  const t = setup()
  await t.go('/settings'); await t.go('/desk')
  expect(t.link.hidden).toBe(true)
})

test('the Desk, Messages and Ring page navs are Connections | Desk | Messages | Ring, and there is no Circuit page', async () => {
  document.body.innerHTML = (await Bun.file(new URL('../public/index.html', import.meta.url)).text()).replace(/<script[\s\S]*?<\/script>/g, '')
  const navs = [...document.querySelectorAll('nav.wiring-views')]
  expect(navs.length).toBe(3)
  expect(document.querySelector('app-route[path="/wiring"], c-circuit')).toBeNull()
  for (const n of navs) {
    expect([...n.querySelectorAll('a')].map(a => a.textContent)).toEqual(['Connections', 'Desk', 'Messages', 'Ring'])
    expect(n.querySelector('a:last-child')!.getAttribute('href')).toBe('#/ring')
  }
})

test('arriving at /desk keeps the Connections link', async () => {
  const t = setup()
  await t.go('/p/workspace'); await t.go('/desk')
  const links = [...document.querySelectorAll<HTMLAnchorElement>('a[data-connections]')]
  expect(links.length).toBe(2)
  for (const l of links) { expect(l.hidden).toBe(false); expect(l.getAttribute('href')).toBe('#/p/workspace') }
})

test('Messages and the Ring are not screens: Connections points at the last workspace from there too', async () => {
  const t = setup()
  await t.go('/lab'); await t.go('/messages')
  expect(t.link.hidden).toBe(false)
  expect(t.link.getAttribute('href')).toBe('#/lab')
  await t.go('/ring')
  expect(t.link.getAttribute('href')).toBe('#/lab')
})
