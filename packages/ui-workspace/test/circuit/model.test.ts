import { expect, test } from 'bun:test'
import { buildCircuit, dockPlacements, type Placement, type Screen } from '../../src/circuit'
import { wireId } from '../../src/wires/model'
import { deployment, p1, p2, registry } from '../wires/setup'

// r → d → l and m unpiped, in runtime main, with the host's own pod ui in it too
const d = deployment()
d.pods['ui'] = d.pods['m']!
d.runtimes['main']!.pods.push('ui')
d.runtimes['main']!.subscriptions.push({ kind: 'pipe', from: 'ui', source: 'nano.ui.Input/submit', to: 'l', target: 'nano.ui.Log/log' })
const screens: Screen[] = [{ id: '/a', title: 'A' }, { id: '/b', title: 'B' }, { id: '/c', title: 'C' }]
const pl = (screen: string, instance: string, box?: Placement['box']): Placement => ({ screen, instance, ...(box && { box }) })
const placements = [pl('/a', 'r'), pl('/a', 'rx'), pl('/b', 'r'), pl('/b', 'd', { x: 0, y: 0, w: 1, h: 0.5 })]
const build = (p = placements) => buildCircuit({ deployment: d, registry: registry(), screens, placements: p })

test('pads from ops: an action is an in pad and, for its result, an out pad; an event an out pad', () => {
  const pads = build([]).side[0]!.items.find(i => i.instance === 'd')!.pads
  expect(pads.map(p => [p.op, p.dir, p.kind, p.type])).toEqual([
    ['nano.ui.Debounce/push:in', 'in', 'call', 'any'], ['nano.ui.Debounce/push:out', 'out', 'call', 'any'], ['nano.ui.Debounce/flushed:out', 'out', 'event', 'any']])
  expect(pads[0]!.key).toBe('main/d nano.ui.Debounce/push:in')
})

test('layers follow screen order with boxes, titles and kinds', () => {
  const c = build([pl('/a', 'r', { x: 0, y: 0, w: 1, h: 1 }), pl('/b', 'd', { x: 0, y: 0, w: 1, h: 0.5 })])
  expect(c.layers.map(l => [l.screen, l.footprints.map(f => f.instance)])).toEqual([['/a', ['r']], ['/b', ['d']], ['/c', []]])
  expect(c.layers[1]!.footprints[0]).toMatchObject({ box: { x: 0, y: 0, w: 1, h: 0.5 }, title: 'debounce', kind: 'nano.ui/debounce', system: 'main' })
})

test('an unboxed placement gets a grid box', () => {
  const c = build([pl('/a', 'r'), pl('/a', 'd')])
  expect(c.layers[0]!.footprints.map(f => f.box)).toEqual([{ x: 0, y: 0, w: 0.5, h: 1 }, { x: 0.5, y: 0, w: 0.5, h: 1 }])
})

test('shared across two pages', () => {
  const c = build()
  expect(c.layers[0]!.footprints.find(f => f.instance === 'r')!.shared).toBe(true)
  expect(c.layers[1]!.footprints.find(f => f.instance === 'd')!.shared).toBe(false)
})

test("unplaced pods go to the side, by runtime; the host's own never", () => {
  expect(build().side.map(b => [b.system, b.items.map(i => i.instance)])).toEqual([['main', ['l', 'm']]])
})

test('cables are pipes, landing where their ends are', () => {
  const c = build([pl('/a', 'r'), pl('/b', 'd')])
  expect(c.cables.map(x => x.id)).toEqual([wireId('main', p1), wireId('main', p2)])   // not ui's
  expect(c.cables[1]!.to.at).toEqual({ side: 'main' })
  expect(c.cables[0]).toMatchObject({ from: { at: { layer: '/a' } }, to: { at: { layer: '/b' }, pad: 'main/d nano.ui.Debounce/push:in' }, type: 'any' })
})

test("a placement of a pod that is not the app's is never a footprint", () => {
  expect(build([pl('/a', 'ui'), pl('/a', 'r'), pl('/a', 'ghost'), pl('/z', 'd')]).layers[0]!.footprints.map(f => f.instance)).toEqual(['r'])
})

test('a pad carries its op schema', () => {
  const pads = build().side[0]!.items.find(i => i.instance === 'l')!.pads
  expect(pads.every(p => p.schema !== undefined)).toBe(true)
})

test("a dock's layout tree places its pods: rows and columns split by size, a stack is a tab group", () => {
  const c = (name?: string) => ({ type: 'component', componentState: name ? { widget: 'x', name } : { widget: 'notes' } })
  const root = { type: 'row', content: [
    { type: 'stack', size: 50, content: [c('r')] },
    { type: 'column', size: 50, content: [{ type: 'stack', size: 1, activeItemIndex: 1, content: [c('d'), c('l')] }, { type: 'stack', size: 3, content: [c()] }] },
  ] }
  expect(dockPlacements('/w', root)).toEqual([
    { screen: '/w', instance: 'r', box: { x: 0, y: 0, w: 0.5, h: 1 } },
    { screen: '/w', instance: 'd', box: { x: 0.5, y: 0, w: 0.5, h: 0.25 }, tab: { group: 'g1', active: false } },
    { screen: '/w', instance: 'l', box: { x: 0.5, y: 0, w: 0.5, h: 0.25 }, tab: { group: 'g1', active: true } },
  ])
})
