// <workspace-dock>: no toolbar of its own; its commands are public; clicking a panel reports its focus as dock:focus.
import { GlobalRegistrator } from '@happy-dom/global-registrator'
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
import { afterEach, expect, mock, test } from 'bun:test'

// bun runs golden-layout's CommonJS build, which needs tslib (not installed); the browser bundle uses its ES build
const esm = Bun.resolveSync('golden-layout/dist/esm/index.js', import.meta.dir)
mock.module('golden-layout', () => import(esm))
mock.module('golden-layout/dist/css/goldenlayout-base.css', () => ({ default: '' }))

const { createBus, provideBus } = await import('../src/lib/bus.ts')
await import('../src/components/workspace-dock.ts')
await import('../src/widgets/widgets.ts')
type Dock = HTMLElement & { addWidget(id: string): void; windowStyle: string; setWindowStyle(s: string): void; save(): void }
const tick = () => new Promise(r => setTimeout(r, 0))
// a placed element stand-in: it knows its instance once connected
customElements.define('x-shown', class extends HTMLElement { model?: string; connectedCallback() { this.model = 'inst-1' } })

afterEach(() => { document.body.innerHTML = ''; localStorage.clear() })

const mount = async () => {
  const bus = createBus()
  const app = document.createElement('div')
  provideBus(app, bus)
  app.innerHTML = `<workspace-dock id="ws" storage-key="t.ws" open="">
    <template data-widget="shown" data-title="Shown"><x-shown></x-shown></template>
    <template data-widget="plain" data-title="Plain"><div>plain</div></template></workspace-dock>`
  document.body.append(app)
  const dock = app.querySelector('workspace-dock') as Dock
  const focus: unknown[] = []
  dock.addEventListener('dock:focus', (e) => focus.push((e as CustomEvent).detail))
  const panel = (i = 0) => dock.querySelectorAll<HTMLElement>('.dock-panel')[i]!
  const down = (el: Element) => el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  return { bus, dock, focus, panel, down }
}

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
  ;(dock as Dock & { reset(): void }).reset(); await tick()
  expect(focus.at(-1)).toBeNull()
  // the starting layout is empty: restore the saved one, focus its panel, and restore again
  ;(dock as Dock & { restore(): void }).restore(); await tick()
  down(panel()); await tick()
  expect(focus.at(-1)).toEqual({ system: 'host', instance: 'inst-1', widget: 'ws' })
  ;(dock as Dock & { restore(): void }).restore(); await tick()
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

// adding splits the focused panel (else the largest): a new column beside a wide one, a new row below a tall one
const rect = (w: number, h: number) => ({ width: w, height: h, x: 0, y: 0, top: 0, left: 0, right: w, bottom: h, toJSON() {} }) as DOMRect
const sized = (size: (el: Element) => DOMRect) => {
  const orig = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function (this: Element) { return size(this) }
  return () => { Element.prototype.getBoundingClientRect = orig }
}

test('adding beside a wide focused panel makes a column; below a tall one, a row', async () => {
  const { dock, panel, down } = await mount()
  dock.addWidget('plain'); await tick()
  let restore = sized(() => rect(800, 400))
  down(panel(0)); dock.addWidget('plain'); await tick()
  restore()
  expect(dock.querySelectorAll('.lm_row > .lm_stack').length).toBe(2)
  restore = sized(() => rect(400, 800))
  down(panel(1)); dock.addWidget('plain'); await tick()
  restore()
  expect(dock.querySelectorAll('.lm_row > .lm_column > .lm_stack').length).toBe(2)
  expect(dock.querySelectorAll('.dock-panel').length).toBe(3)
})

test('with no panel focused, adding splits the largest', async () => {
  const { dock, panel } = await mount()
  const wide = sized(() => rect(800, 400))
  dock.addWidget('plain'); dock.addWidget('plain'); dock.addWidget('plain'); await tick()
  wide()
  expect(dock.querySelectorAll('.lm_row > .lm_stack').length).toBe(3)
  const big = panel(1)
  const restore = sized((el) => el.contains(big) && el.classList.contains('lm_stack') ? rect(400, 900) : rect(100, 100))
  dock.addWidget('plain'); await tick()
  restore()
  expect(big.closest('.lm_column')).not.toBeNull()
  expect(big.closest('.lm_column')!.querySelectorAll('.lm_stack').length).toBe(2)
})
