import './dom.ts'
import { afterEach, expect, test } from 'bun:test'
import { defineWires, type Wires } from '../../src/wires'
import { onDown, onMove, onUp, removeSel, toggleEdit } from '../../src/wires/pointer'
import { Debounce, Input, k, Log, MapIface, setup, tick } from './setup.ts'

defineWires()
afterEach(() => { document.body.innerHTML = '' })

const box = (el: HTMLElement, x: number, y: number, w: number, h: number) => {
  for (const [k, v] of Object.entries({ offsetLeft: x, offsetTop: y, offsetWidth: w, offsetHeight: h })) Object.defineProperty(el, k, { value: v, configurable: true })
}

// the host's app, and a stand-in dock (1200×600) with panels for r and l (their views' targets name the pod), and a Notes panel
async function mount() {
  const t = await setup()
  const el = document.createElement('c-wires') as Wires
  el.host = t.host
  const dock = document.createElement('div')
  dock.innerHTML = '<div class="bar"><button>⇄ Connections</button></div><div class="dock-panel"><x-r></x-r></div><div class="dock-panel"><x-l></x-l></div><div class="dock-panel"><textarea></textarea></div>'
  box(dock, 0, 0, 1200, 600)
  const ps = [...dock.querySelectorAll<HTMLElement>('.dock-panel')]
  ps.forEach((p, i) => box(p, i * 400, 0, 400, 300))
  Object.assign(dock.querySelector('x-r')!, { target: { pod: 'r' } })
  Object.assign(dock.querySelector('x-l')!, { target: { pod: 'l' } })
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
  const pipes = () => t.host.data().runtimes['main']!.subscriptions
  const submit = (v: unknown) => (t.app.call('main', 'r') as unknown as { submit(v: unknown): Promise<unknown> }).submit(v)
  return { ...t, el, dock, root, settle, flip, at, pipes, submit }
}

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

test('a pipe message pulses its wire', async () => {
  const { el, s1, flip, settle, submit } = await mount()
  await flip()
  await submit(42)
  await settle()
  expect(el.s.packets.map(p => [p.wire, p.label])[0]).toEqual([s1.id, 'push'])
  expect(el.s.stats['d']!.in).toBe(1)
})

test('dragging from an out jack to a fitting in jack connects them: a pipe is applied', async () => {
  const { el, pipes, flip, settle, at } = await mount()
  await flip()
  toggleEdit(el)
  onDown(el, at(k('r', Input, 'submit', 'out')))
  onMove(el, at(k('m', MapIface, 'map', 'in')))
  expect(el.s.cord!.err).toBeNull()
  await onUp(el, at(k('m', MapIface, 'map', 'in')))
  await settle()
  expect(pipes().some(s => s.from === 'r' && s.to === 'm' && s.kind === 'pipe' && s.target === 'nano.ui.Map/map')).toBe(true)
  expect(el.model.wires.length).toBe(3)
  expect(el.shadowRoot!.querySelector('[role="status"]')!.textContent).toBe('Patched r.submit → m.map')
})

test('a plugged input dropped in space is disconnected', async () => {
  const { el, pipes, s1, flip, settle, at } = await mount()
  await flip()
  toggleEdit(el)
  onDown(el, at(k('d', Debounce, 'push', 'in')))
  expect(el.s.cord!.picked).toBe(s1.id)
  await onUp(el, { clientX: 600, clientY: 400 })
  await settle()
  expect(pipes().some(s => s.from === 'r' && s.to === 'd')).toBe(false)
})

test('refusals are shown: a misfit cord, and one the app refuses', async () => {
  const { el, root, flip, settle, at } = await mount()
  await flip()
  toggleEdit(el)
  onDown(el, at(k('l', Log, 'entries', 'out')))
  onMove(el, at(k('r', Input, 'submit', 'out')))
  await settle()
  expect(root.querySelector('[role="status"]')!.textContent).toBe('Both jacks emit events — patch an output into an input')
  await onUp(el, at(k('r', Input, 'submit', 'out')))
  expect(await el.create('nope/nope')).toBeNull()
  await settle()
  expect(root.querySelector('[role="status"]')!.textContent).toContain('nope')
})

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

test('puzzle mode draws the same connections as pieces, and a joint unplugs one', async () => {
  const { el, pipes, root, flip, settle } = await mount()
  await flip()
  el.setState({ mode: 'puzzle' })
  await settle()
  expect([...root.querySelectorAll('[data-piece]')].map(p => p.getAttribute('data-piece'))).toEqual(['r.submit', 'd', 'l.log'])
  expect(root.querySelector('aside')!.textContent).toContain('r.submit → d → l.log')
  toggleEdit(el)
  await settle()
  ;(root.querySelector('[aria-label="Unplug the cord into l"]') as HTMLButtonElement).click()
  await settle(); await settle()
  expect(pipes().some(s => s.from === 'd' && s.to === 'l')).toBe(false)
})

test('puzzle mode: an armed operator is spliced into a chain at a joint', async () => {
  const { el, root, flip, settle } = await mount()
  await flip()
  el.setState({ mode: 'puzzle' })
  toggleEdit(el)
  await settle()
  ;(root.querySelector('[data-kind="nano.ui/map"]') as HTMLButtonElement).click()
  await settle()
  ;(root.querySelector('[aria-label="Insert map before l"]') as HTMLButtonElement).click()
  for (let i = 0; i < 4; i++) await settle()
  expect(Object.values(el.puzzle.descs)).toEqual(['r.submit → d → map1 → l.log'])
  expect(el.model.wires.map(w => w.to.split(' ')[1])).toEqual(['nano.ui.Debounce/push:in', 'nano.ui.Map/map:in', 'nano.ui.Log/log:in'])
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

test('a splice that fails partway puts the chain back as it was', async () => {
  const { el, host, pipes, flip, settle, s1, root } = await mount()
  await flip()
  toggleEdit(el); el.setState({ mode: 'puzzle' }); await settle()
  el.setState({ armed: 'nano.ui/map' })
  const real = el.connect.bind(el)
  let n = 0
  el.connect = async (a: string, b: string) => (++n === 2 ? { error: 'refused for the test' } : real(a, b))   // the second patch fails
  const { joint } = await import('../../src/wires/pointer')
  await joint(el, s1.id); await settle()
  expect(pipes().some(s => s.from === 'r' && s.to === 'd')).toBe(true)   // the original wire is back
  expect(Object.keys(host.data().pods).some(p => p.startsWith('map') && p !== 'm')).toBe(false)   // no orphan
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
  Object.assign(hidden.querySelector('x-m')!, { target: { pod: 'm' } })
  box(hidden, 0, 0, 0, 0)   // display:none: no size
  dock.append(hidden)
  await flip()
  expect(el.model.chassis.length).toBe(3)
  expect(el.model.chassis.some(c => c.instance === 'm')).toBe(false)
  expect(el.model.rack.map(r => r.id)).toContain('m')
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

test('a cord between pods in different runtimes is refused', async () => {
  const { el, host, root, flip, settle, at } = await mount()
  const d = host.data()
  d.runtimes['main']!.pods = d.runtimes['main']!.pods.filter(p => p !== 'm')
  d.runtimes['lab'] = { pods: ['m'], subscriptions: [] }
  expect((await host.apply(d)).ok).toBe(true)
  await flip()
  toggleEdit(el)
  onDown(el, at(k('r', Input, 'submit', 'out')))
  onMove(el, at(k('m', MapIface, 'map', 'in')))
  await onUp(el, at(k('m', MapIface, 'map', 'in')))
  await settle()
  expect(root.querySelector('[role="status"]')!.textContent).toBe('r and m are not in one runtime')
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
