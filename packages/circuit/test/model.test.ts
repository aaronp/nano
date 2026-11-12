import { expect, test } from 'bun:test'
import { Ops, type Snapshot } from '@pritzlaff/nano-core'
import type { Kind, Placement, Screen } from '@pritzlaff/nano-app'
import { Type } from 'typebox'
import { buildCircuit } from '../src'

const value = Ops.source('t', 'value', Type.Number()), set = Ops.action('t', 'set', Type.Number(), Type.Void()), info = Ops.sink('t', 'info', Type.String())
const inst = (id: string, ops = [value, set, info], owner?: { kind: string; name: string }) => ({ id, component: 't/thing', ops, ...(owner && { owner }) })
const host: Snapshot = {
  id: 'host',
  instances: [inst('app'), inst('alerts'), inst('r1'), inst('r2'), inst('ex-log'), inst('hidden', [info], { kind: 'view', name: 'c-x' })],
  subscriptions: [
    { id: 's1', source: 'r1', op: 't/value', listener: 'ex-log', target: 't/info' },
    { id: 's2', source: 'r1', op: 't/value', listener: 'r2', target: 't/set' },
    { id: 's3', source: 'r1', op: 't/value', listener: 'hidden', target: 't/info' },
    { id: 's4', source: 'app', op: 't/value', listener: 'r2', target: 't/set' },
  ],
}
const kinds: Kind[] = [{ kind: 'thing', component: 't/thing', title: 'Thing' }]
const screens: Screen[] = [{ id: '/a', title: 'A', system: 'host', layout: {} }, { id: '/b', title: 'B', system: 'host', layout: {} }, { id: '/c', title: 'C', system: 'host', layout: null }]
const pl = (screen: string, instance: string, box?: Placement['box']): Placement => ({ screen, panel: instance, instance, ...(box && { box }) })
const placements = [pl('/a', 'r1'), pl('/a', 'r1x'), pl('/b', 'r1'), pl('/b', 'r2', { x: 0, y: 0, w: 1, h: 0.5 })]
const build = (p = placements) => buildCircuit({ systems: [host], screens, placements: p, kinds })

test('pads from ops', () => {
  const pads = build().side[0]!.items.find(i => i.instance === 'ex-log')!.pads
  expect(pads.map(p => [p.op, p.dir, p.kind, p.type])).toEqual([['t/value', 'out', 'event', 'number'], ['t/set', 'in', 'call', 'number'], ['t/info', 'in', 'event', 'string']])
  expect(pads[0]!.key).toBe('host/ex-log t/value')
})

test('layers follow screen order with boxes, titles and kinds', () => {
  const c = build([pl('/a', 'r1', { x: 0, y: 0, w: 1, h: 1 }), pl('/b', 'r2', { x: 0, y: 0, w: 1, h: 0.5 })])
  expect(c.layers.map(l => [l.screen, l.footprints.map(f => f.instance)])).toEqual([['/a', ['r1']], ['/b', ['r2']], ['/c', []]])
  expect(c.layers[1]!.footprints[0]).toMatchObject({ box: { x: 0, y: 0, w: 1, h: 0.5 }, title: 'Thing', kind: 'thing', system: 'host' })
})

test('an unboxed placement gets a grid box', () => {
  const c = build([pl('/a', 'r1'), pl('/a', 'r2')])
  expect(c.layers[0]!.footprints.map(f => f.box)).toEqual([{ x: 0, y: 0, w: 0.5, h: 1 }, { x: 0.5, y: 0, w: 0.5, h: 1 }])
})

test('shared across two pages', () => {
  const c = build()
  expect(c.layers[0]!.footprints.find(f => f.instance === 'r1')!.shared).toBe(true)
  expect(c.layers[1]!.footprints.find(f => f.instance === 'r1')!.shared).toBe(true)
  expect(c.layers[1]!.footprints.find(f => f.instance === 'r2')!.shared).toBe(false)
})

test('unplaced non-infrastructure instances go to the side', () => {
  const ids = build().side.flatMap(b => b.items.map(i => i.instance))
  expect(ids).toEqual(['ex-log'])
})

test('cables land where their ends are', () => {
  const c = build([pl('/a', 'r1'), pl('/b', 'r2')])
  expect(c.cables.find(x => x.id === 's1')!.to.at).toEqual({ side: 'host' })
  expect(c.cables.find(x => x.id === 's2')).toMatchObject({ from: { at: { layer: '/a' } }, to: { at: { layer: '/b' }, pad: 'host/r2 t/set' }, type: 'number' })
})

test('an infrastructure end drops the cable', () => {
  expect(build().cables.map(c => c.id)).toEqual(['s1', 's2'])
})

test('a null-layout screen is an empty layer', () => {
  expect(build().layers[2]).toMatchObject({ screen: '/c', footprints: [] })
})

test('placed infrastructure is never a footprint', () => {
  const c = build([pl('/a', 'application'), pl('/a', 'r1'), pl('/a', 'hidden')])
  expect(c.layers[0]!.footprints.map(f => f.instance)).toEqual(['r1'])
})

test('a placement missing from the snapshot still yields a bare footprint', () => {
  const f = build([pl('/a', 'ghost')]).layers[0]!.footprints[0]!
  expect([f.instance, f.title, f.pads]).toEqual(['ghost', 'ghost', []])
})
