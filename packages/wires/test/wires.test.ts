import { afterEach, expect, test } from 'bun:test'
import { Ops } from '@pritzlaff/nano-core'
import { catalog, Map, Range } from '@composable/bundle'
import { defineWires, type Wires } from '../src'
import { definePlatform, PlatformOps as P } from '@composable/platform'
import { onDown, onMove, onUp, removeSel, toggleEdit } from '../src/pointer'
import { setup, tick } from './setup'

defineWires()
definePlatform()
afterEach(() => { document.body.innerHTML = '' })

const box = (el: HTMLElement, x: number, y: number, w: number, h: number) => {
  for (const [k, v] of Object.entries({ offsetLeft: x, offsetTop: y, offsetWidth: w, offsetHeight: h })) Object.defineProperty(el, k, { value: v, configurable: true })
}

// the host system, and a stand-in dock (1200×600) with panels for r and l, and a Notes panel
async function mount() {
  const t = await setup()
  const el = document.createElement('c-wires') as Wires
  el.runtime = t.host
  el.catalog = catalog
  const dock = document.createElement('div')
  dock.innerHTML = '<div class="bar"><button>⇄ Connections</button></div><div class="dock-panel"><x-r></x-r></div><div class="dock-panel"><x-l></x-l></div><div class="dock-panel"><textarea></textarea></div>'
  box(dock, 0, 0, 1200, 600)
  const ps = [...dock.querySelectorAll<HTMLElement>('.dock-panel')]
  ps.forEach((p, i) => box(p, i * 400, 0, 400, 300))
  Object.assign(dock.querySelector('x-r')!, { model: 'r' })
  Object.assign(dock.querySelector('x-l')!, { model: 'l' })
  el.append(dock)
  document.body.append(el)
  await el.updateComplete
  const settle = async () => { await tick(); await el.updateComplete }
  const root = el.shadowRoot!
  const flip = async () => {
    dock.querySelector('button')!.dispatchEvent(new CustomEvent('dock:connections', { bubbles: true, composed: true }))
    await settle()
    // happy-dom has no layout: the plate is drawn at 1:1 at the page origin
    const plate = root.querySelector('.plate-bg')
    if (plate) plate.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1200, height: 600 }) as DOMRect
  }
  const at = (key: string) => ({ clientX: el.model.P[key]!.x, clientY: el.model.P[key]!.y })
  return { ...t, el, dock, root, settle, flip, at }
}
const k = (instance: string, op: { ns: string; name: string }) => instance + ' ' + Ops.key(op)

test('unflipped it is just the dock; dock:connections flips it to the 3D view and back', async () => {
  const { el, root, flip, settle } = await mount()
  expect(root.querySelector('.stage-bg')).toBeNull()
  expect(root.querySelector('slot')).not.toBeNull()
  await flip()
  expect(el.flipped).toBe(true)
  expect(el.hasAttribute('flipped')).toBe(true)
  expect(root.querySelector('.front slot')).not.toBeNull()
  expect(root.querySelector('aside')!.textContent).toContain('Relay wires')
  expect(root.querySelectorAll('[data-wire]').length).toBe(2)
  expect(root.querySelector('[data-module="d"]')).not.toBeNull()
  expect(root.textContent).toContain('r → l')
  expect(document.head.querySelectorAll('link[data-wires-fonts]').length).toBe(1)
  await flip()
  await new Promise(r => setTimeout(r, 950)); await settle()
  expect(el.flipped).toBe(false)
  expect(root.querySelector('.stage-bg')).toBeNull()
})

test('a delivery in the system pulses the wire of its subscription', async () => {
  const { el, host, s1, flip, settle } = await mount()
  await flip()
  await host.call({ registry: 'host', instance: 'test' }, 'r', Ops.key(Range.ops.set), 42)
  await settle()
  expect(el.s.packets.map(p => [p.wire, p.label])).toEqual([[s1.id, '42']])
  expect(el.s.stats['d']!.in).toBe(1)
})

test('dragging from an out jack to a fitting in jack connects them through the platform', async () => {
  const { el, host, flip, settle, at } = await mount()
  await flip()
  toggleEdit(el)
  onDown(el, at(k('r', Range.ops.value)))
  onMove(el, at(k('m', Map.ops.map)))
  expect(el.s.cord!.err).toBeNull()
  await onUp(el, at(k('m', Map.ops.map)))
  await settle()
  expect(host.registry.snapshot().subscriptions.some(s => s.source === 'r' && s.listener === 'm' && s.target === Ops.key(Map.ops.map))).toBe(true)
  expect(el.model.wires.length).toBe(3)
  expect(el.shadowRoot!.querySelector('[role="status"]')!.textContent).toBe('Patched r.value → m.map')
})

test('a plugged input dropped in space is disconnected', async () => {
  const { el, host, s1, flip, settle, at } = await mount()
  await flip()
  toggleEdit(el)
  onDown(el, at(k('d', { ns: 'composable.bundle/debounce', name: 'enqueue' })))
  expect(el.s.cord!.picked).toBe(s1.id)
  await onUp(el, { clientX: 600, clientY: 400 })
  await settle()
  expect(host.registry.snapshot().subscriptions.some(s => s.id === s1.id)).toBe(false)
})

test('refusals are shown: a misfit cord, and one the platform refuses', async () => {
  const { el, root, flip, settle, at } = await mount()
  await flip()
  toggleEdit(el)
  onDown(el, at(k('l', { ns: 'composable.bundle/log', name: 'entries' })))
  onMove(el, at(k('r', Range.ops.set)))
  await settle()
  expect(root.querySelector('[role="status"]')!.textContent).toBe("l.entries doesn't fit r.set")
  await onUp(el, at(k('r', Range.ops.set)))
  expect(await el.create('nope')).toBeNull()
  await settle()
  expect(root.querySelector('[role="status"]')!.textContent).toContain('no component kind nope')
})

test('selecting a rack module and removing it removes the instance; the palette adds new ones', async () => {
  const { el, host, root, flip, settle } = await mount()
  await flip()
  toggleEdit(el)
  const m = el.model.rack.find(r => r.id === 'm')!
  onDown(el, { clientX: m.x + 5, clientY: m.y + 80 })
  await onUp(el, { clientX: m.x + 5, clientY: m.y + 80 })
  expect(el.s.selMod).toBe('m')
  await removeSel(el)
  await settle()
  expect(host.registry.get('m')).toBeUndefined()
  expect(el.model.rack.map(r => r.id)).toEqual(['d'])
  ;(root.querySelector('[data-kind="filter"]') as HTMLButtonElement).click()
  await settle(); await settle()
  expect(host.registry.get('filter-1')).toBeDefined()
  expect(el.model.rack.map(r => r.id)).toEqual(['d', 'filter-1'])
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
  expect(opened).toEqual([{ kind: 'debounce', name: 'd' }])
})

test('puzzle mode draws the same connections as pieces, and a joint unplugs one', async () => {
  const { el, host, s2, root, flip, settle } = await mount()
  await flip()
  el.setState({ mode: 'puzzle' })
  await settle()
  expect([...root.querySelectorAll('[data-piece]')].map(p => p.getAttribute('data-piece'))).toEqual(['r.value', 'd', 'l.info'])
  expect(root.querySelector('aside')!.textContent).toContain('r.value → d → l.info')
  toggleEdit(el)
  await settle()
  ;(root.querySelector('[aria-label="Unplug the cord into l"]') as HTMLButtonElement).click()
  await settle(); await settle()
  expect(host.registry.snapshot().subscriptions.some(s => s.id === s2.id)).toBe(false)
})

test('puzzle mode: an armed operator is spliced into a chain at a joint', async () => {
  const { el, root, flip, settle } = await mount()
  await flip()
  el.setState({ mode: 'puzzle' })
  toggleEdit(el)
  await settle()
  ;(root.querySelector('[data-kind="map"]') as HTMLButtonElement).click()
  await settle()
  ;(root.querySelector('[aria-label="Insert Map before l"]') as HTMLButtonElement).click()
  for (let i = 0; i < 4; i++) await settle()
  expect(Object.values(el.puzzle.descs)).toEqual(['r.value → d → map-1 → l.info'])
  expect(el.model.wires.map(w => w.to.split(' ')[1])).toEqual(['composable.bundle/debounce/enqueue', 'composable.bundle/map/map', 'composable.bundle/log/info'])
})

test('removed from the page, it stops listening', async () => {
  const { el, host } = await mount()
  el.remove()
  await host.call({ registry: 'host', instance: 'test' }, 'r', Ops.key(Range.ops.set), 7)
  await tick()
  expect(el.s.packets).toEqual([])
})

test('while flat it does no work: no packets pile up, and none fly in when it flips', async () => {
  const { el, host, flip, settle } = await mount()
  await host.call({ registry: 'host', instance: 'test' }, 'r', Ops.key(Range.ops.set), 7)
  await settle()
  expect(el.s.packets).toEqual([])
  await flip()
  expect(el.s.packets).toEqual([])
})

test('a splice that fails partway puts the chain back as it was', async () => {
  const { el, host, flip, settle, s1, root } = await mount()
  await flip()
  toggleEdit(el); el.setState({ mode: 'puzzle' }); await settle()
  el.setState({ armed: 'map' })
  const real = el.connect.bind(el)
  let n = 0
  el.connect = async (a: string, b: string) => (++n === 2 ? { error: 'refused for the test' } : real(a, b))   // the second patch fails
  const { joint } = await import('../src/pointer')
  await joint(el, s1.id); await settle()
  const subs = host.registry.snapshot().subscriptions.filter(s => !s.listener.includes('~view'))
  expect(subs.some(s => s.source === 'r' && s.listener === 'd')).toBe(true)   // the original wire is back
  expect(host.registry.snapshot().instances.some(i => i.id.startsWith('map-'))).toBe(false)   // no orphan
  expect(root.textContent).toContain('refused for the test')
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

test('a panel that is not showing (an inactive tab) is not drawn on the pane; its component waits in the rack', async () => {
  const { el, dock, flip } = await mount()
  const hidden = document.createElement('div')
  hidden.className = 'dock-panel'
  hidden.innerHTML = '<x-m></x-m>'
  Object.assign(hidden.querySelector('x-m')!, { model: 'm' })
  box(hidden, 0, 0, 0, 0)   // display:none: no size
  dock.append(hidden)
  await flip()
  expect(el.model.chassis.length).toBe(3)
  expect(el.model.chassis.some(c => c.instance === 'm')).toBe(false)
  expect(el.model.rack.map(r => r.id)).toContain('m')
})

test('clicking a jack on the back selects its action, and Detail shows its op, schemas and connections', async () => {
  const { el, root, call, flip, settle, at } = await mount()
  await flip()
  const jack = at(k('r', Range.ops.value))
  onDown(el, jack); await onUp(el, jack); await settle(); await settle()
  expect((await call(P.selected, null)).value).toEqual({ system: 'host', instance: 'r', op: Ops.key(Range.ops.value) })
  expect(el.s.tab).toBe('detail')
  const card = root.querySelector('.detail')!.textContent!
  expect(card).toContain(Ops.key(Range.ops.value))
  expect(card).toContain('source')
  expect(card).toContain('"type": "number"')
  expect(card).toContain('r.value → d.enqueue')
  expect(card).toContain(Range.ops.value.description!)   // what it is, then each schema's description and examples
  expect(card).toContain('e.g. 50')
})

test('clicking a panel selects its component: coordinates, kind, jacks and connections', async () => {
  const { el, root, call, flip, settle } = await mount()
  await flip()
  const c = el.model.chassis.find(x => x.instance === 'r')!, mid = { clientX: c.x + c.w / 2, clientY: c.y + c.h / 2 }   // the back is the front mirrored
  onDown(el, mid); await onUp(el, mid); await settle(); await settle()
  expect((await call(P.selected, null)).value).toEqual({ system: 'host', instance: 'r' })
  const card = root.querySelector('.detail')!.textContent!
  expect(card).toContain('host / r')
  expect(card).toContain('range')
  expect(card).toContain('composable.bundle/range')
  expect(card).toContain('r.value → d.enqueue')
})

test('the drawer has View and Detail tabs; Detail holds the system tree, in step with the selection', async () => {
  const { el, root, flip, settle } = await mount()
  await flip()
  const tab = (name: string) => [...root.querySelectorAll('[role="tab"]')].find(t => t.textContent!.trim() === name) as HTMLButtonElement
  expect(tab('View').getAttribute('aria-selected')).toBe('true')
  tab('Detail').click(); await settle()
  expect(root.querySelector('.detail')!.textContent).toContain('Click a panel')
  const tree = root.querySelector('c-platform') as HTMLElement & { updateComplete: Promise<boolean> }
  for (let i = 0; i < 4; i++) { await tree.updateComplete; await settle() }
  const rows = tree.shadowRoot!.querySelector('nano-tree')!.shadowRoot!
  ;(rows.querySelector('[data-id="c:host/d"] > .line') as HTMLElement).click()
  for (let i = 0; i < 3; i++) await settle()
  expect(el.s.picked).toEqual({ system: 'host', instance: 'd' })
  expect(root.querySelector('.detail')!.textContent).toContain('host / d')
  tab('View').click(); await settle()
  expect(root.querySelector('c-platform')).toBeNull()
})

test('over another system: cords connect in that system, through the platform in host, and picks name that system', async () => {
  const t = await setup()
  await t.call(P.createSystem, 'lab')
  for (const [kind, name] of [['range', 'lr'], ['debounce', 'ld']]) await t.call(P.createComponent, { kind, name, system: 'lab' })
  const { runtimeOf } = await import('@composable/platform')
  const lab = runtimeOf(t.host.registry, 'lab')!
  const el = document.createElement('c-wires') as Wires
  Object.assign(el, { runtime: lab, host: t.host, catalog })
  const dock = document.createElement('div')
  box(dock, 0, 0, 1200, 600)
  el.append(dock); document.body.append(el)
  await el.updateComplete
  expect(el.sys).toBe('lab')
  el.flipped = true; await el.updateComplete; await tick(); await el.updateComplete
  const plate = el.shadowRoot!.querySelector('.plate-bg')!
  plate.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1200, height: 600 }) as DOMRect
  const at = (key: string) => ({ clientX: el.model.P[key]!.x, clientY: el.model.P[key]!.y })
  toggleEdit(el)
  onDown(el, at(k('lr', Range.ops.value)))
  onMove(el, at(k('ld', { ns: 'composable.bundle/debounce', name: 'enqueue' })))
  await onUp(el, at(k('ld', { ns: 'composable.bundle/debounce', name: 'enqueue' })))
  expect(lab.registry.snapshot().subscriptions.some(s => s.source === 'lr' && s.listener === 'ld')).toBe(true)
  expect(t.host.registry.snapshot().subscriptions.some(s => s.source === 'lr')).toBe(false)
  toggleEdit(el)
  const jack = at(k('lr', Range.ops.value))
  onDown(el, jack); await onUp(el, jack); await tick(); await el.updateComplete
  expect((await t.call(P.selected, null)).value).toEqual({ system: 'lab', instance: 'lr', op: Ops.key(Range.ops.value) })
  expect(el.s.picked).toEqual({ system: 'lab', instance: 'lr', op: Ops.key(Range.ops.value) })
  expect(el.shadowRoot!.querySelector('.detail')!.textContent).toContain('lab / lr')
})
