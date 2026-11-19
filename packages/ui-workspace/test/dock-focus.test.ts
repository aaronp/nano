// <workspace-dock>: no toolbar of its own; its commands are public; clicking a panel reports its focus as dock:focus;
// save, restore and reset; the status line. Ported from retired/test/dock-focus.test.ts; see dock-setup.ts.
import { expect, test } from 'bun:test'
import { createBus, mount, provideBus, tick } from './dock-setup.ts'

test('the dock has no toolbar', async () => {
  const { dock } = await mount()
  expect(dock.querySelector('.dock-bar')).toBeNull()
  expect(dock.querySelector('[role="toolbar"]')).toBeNull()
})

test('clicking into a panel sends dock:focus with its instance, once', async () => {
  const { dock, focus, panel, down } = await mount()
  dock.addWidget('shown'); await tick()
  down(panel().firstElementChild!); down(panel().firstElementChild!); await tick()
  expect(focus).toEqual([{ system: 'host', instance: 'inst-1', widget: 'ws' }])
})

test('a panel that shows no instance sends dock:focus null but is still marked', async () => {
  const { dock, focus, panel, down } = await mount()
  dock.addWidget('plain'); await tick()
  down(panel()); await tick()
  expect(focus).toEqual([null])
  expect(dock.querySelector('.lm_header')!.classList.contains('lm_focused')).toBe(true)
})

test('closing the focused panel sends dock:focus null', async () => {
  const { dock, focus, panel, down } = await mount()
  dock.addWidget('shown'); await tick()
  down(panel()); await tick()
  ;(dock.querySelector('.lm_close_tab') as HTMLElement).click(); await tick()
  expect(focus).toEqual([{ system: 'host', instance: 'inst-1', widget: 'ws' }, null])
})

test('clicking the dock\'s empty space clears focus', async () => {
  const { dock, focus, panel, down } = await mount()
  dock.addWidget('shown'); await tick()
  down(panel()); await tick()
  down(dock.querySelector('.dock-area')!); await tick()
  expect(focus).toEqual([{ system: 'host', instance: 'inst-1', widget: 'ws' }, null])
  expect(dock.querySelector('.lm_header')!.classList.contains('lm_focused')).toBe(false)
})

test('reset and restore with a panel focused send dock:focus null', async () => {
  const { dock, focus, panel, down } = await mount()
  dock.addWidget('shown'); await tick()
  dock.save()
  down(panel()); await tick()
  ;dock.reset(); await tick()
  expect(focus.at(-1)).toBeNull()
  // the starting layout is empty: restore the saved one, focus its panel, and restore again
  ;dock.restore(); await tick()
  down(panel()); await tick()
  expect(focus.at(-1)).toEqual({ system: 'host', instance: 'inst-1', widget: 'ws' })
  ;dock.restore(); await tick()
  expect(focus.at(-1)).toBeNull()
})

test('setWindowStyle remembers the style and sets chrome', async () => {
  const { dock } = await mount()
  expect(dock.windowStyle).toBe('tabs')
  expect(dock.getAttribute('chrome')).toBe('tabs')
  dock.setWindowStyle('focus')
  expect(dock.windowStyle).toBe('focus')
  expect(dock.getAttribute('chrome')).toBe('focus')
  expect(localStorage.getItem('t.ws.window-style')).toBe('focus')
})

test('say goes to the bus as dock:status', async () => {
  const { bus, dock } = await mount()
  dock.save()
  expect(bus.history().filter(m => m.topic === 'dock:status').map(m => m.payload)).toEqual([{ message: 'Layout saved.' }])
})

test('<status-line> shows the last event until a message comes, then the latest message', async () => {
  const bus = createBus()
  const app = document.createElement('div'); provideBus(app, bus)
  const line = document.createElement('status-line') as HTMLElement & { updateComplete: Promise<boolean> }
  app.append(line); document.body.append(app)
  bus.publish('dock:opened', { widget: 'x' }, 'workspace-dock'); await line.updateComplete
  expect(line.shadowRoot!.textContent).toContain('Last event')
  bus.publish('dock:status', { message: 'Layout saved.' }, 'workspace-dock'); await line.updateComplete
  expect(line.shadowRoot!.textContent!.trim()).toBe('Layout saved.')
  bus.publish('dock:status', { message: 'Layout reset.' }, 'workspace-dock'); await line.updateComplete
  expect(line.shadowRoot!.textContent!.trim()).toBe('Layout reset.')
})

test('the status line keeps the dock\'s last message through other bus traffic', async () => {
  const { bus, dock } = await mount()
  const line = document.createElement('status-line') as HTMLElement & { updateComplete: Promise<unknown> }
  dock.parentElement!.append(line); await tick()
  dock.addWidget('shown'); await tick()
  dock.save()
  bus.publish('dock:saved', {}, 'ws'); bus.publish('route:changed', { path: '/x' }, 'nav')
  await line.updateComplete
  expect(line.shadowRoot!.textContent).toContain('Layout saved.')
})
