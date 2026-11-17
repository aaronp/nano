import './dom.ts'
import { expect, test } from 'bun:test'
import { buildPuzzle, checkConnect } from '../../src/wires'
import { Debounce, deployment, Input, k, Log, MapIface, model, p1, p2 } from './setup.ts'
import { wireId } from '../../src/wires/model.ts'
import { Pod } from '@pritzlaff/nano-core'
import { input } from '@pritzlaff/nano-ui'

test('panels become mirrored chassis with jacks: outs along the top, ins along the bottom', () => {
  const m = model(deployment())
  expect(m.chassis.map(c => [c.label, c.x, c.instance])).toEqual([['r', 800, 'r'], ['l', 400, 'l'], ['textarea', 0, null]])
  const out = m.P[k('r', Input, 'submit', 'out')]!, inn = m.P[k('r', Input, 'submit', 'in')]!
  expect([out.dir, out.kind, out.y]).toEqual(['out', 'chassis', 56])
  expect([inn.dir, inn.y]).toEqual(['in', 260])
  // an action is an in jack and, for its result, an out jack
  expect(Object.values(m.P).filter(p => p.owner === 'l').map(p => [p.label, p.dir])).toEqual([['log', 'out'], ['entries', 'out'], ['clear', 'out'], ['log', 'in'], ['entries', 'in'], ['clear', 'in']])
})

test('the rack holds pods with no panel, but not the host\'s own pod', () => {
  const d = deployment()
  d.pods['ui'] = Pod.eager(input); d.runtimes['main']!.pods.push('ui')
  const m = model(d, { d: 'nano.ui/debounce', m: 'nano.ui/map' }, { 'nano.ui/debounce': 'debounce', 'nano.ui/map': 'map' })
  expect(m.rack.map(r => [r.id, r.sub, r.block])).toEqual([['d', 'debounce', false], ['m', 'map', false]])
  expect(m.rack[0]!.y).toBe(660)
  expect(m.P[k('d', Debounce, 'push', 'in')]!.kind).toBe('module')
})

test('pipes are wires, grouped into named, coloured routes', () => {
  const d = deployment()
  expect(model(d).wires).toEqual([
    { id: wireId('main', p1), route: wireId('main', p1), from: k('r', Input, 'submit', 'out'), to: k('d', Debounce, 'push', 'in') },
    { id: wireId('main', p2), route: wireId('main', p1), from: k('d', Debounce, 'flushed', 'out'), to: k('l', Log, 'log', 'in') },
  ])
  expect(model(d).routes).toEqual([{ id: wireId('main', p1), name: 'r → l', color: '#7EE787' }])
  d.pods['i'] = Pod.eager(input); d.runtimes['main']!.pods.push('i')
  d.runtimes['main']!.subscriptions.push({ kind: 'pipe', from: 'i', source: p1.source, to: 'm', target: 'nano.ui.Map/map' })
  d.runtimes['main']!.subscriptions.push({ kind: 'call', from: 'i', to: 'm' })   // a call edge draws no wire
  expect(model(d).routes.map(r => [r.name, r.color])).toEqual([['r → l', '#7EE787'], ['i → m', '#F5A524']])
})

test('checkConnect: out into in, not into itself, not twice', () => {
  const m = model(deployment())
  expect(checkConnect(m, k('m', MapIface, 'map', 'in'), k('r', Input, 'submit', 'out'))).toEqual({ from: k('r', Input, 'submit', 'out'), to: k('m', MapIface, 'map', 'in') })
  expect(checkConnect(m, k('r', Input, 'submit', 'out'), k('l', Log, 'entries', 'out'))).toEqual({ error: 'Both jacks emit events — patch an output into an input' })
  expect(checkConnect(m, k('l', Log, 'log', 'out'), k('l', Log, 'clear', 'in'))).toEqual({ error: "l can't patch into itself" })
  expect(checkConnect(m, k('r', Input, 'submit', 'out'), k('d', Debounce, 'push', 'in'))).toEqual({ error: 'Those jacks are already connected' })
})

test('the puzzle lays a route out as a chain, and a fork where one output feeds two inputs', () => {
  const d = deployment()
  let pz = buildPuzzle(model(d))
  expect(pz.pieces.map(p => [p.kind, p.label])).toEqual([['port', 'r.submit'], ['op', 'd'], ['port', 'l.log']])
  expect(Object.values(pz.descs)).toEqual(['r.submit → d → l.log'])
  d.runtimes['main']!.subscriptions.push({ kind: 'pipe', from: 'd', source: p2.source, to: 'm', target: 'nano.ui.Map/map' })
  pz = buildPuzzle(model(d))
  expect(Object.values(pz.descs)).toEqual(['r.submit → d → fork(l.log | m)'])
  expect(pz.pieces.find(p => p.kind === 'fork')!.tabs).toEqual([20, 66])
})

test('a call edge goes from the bottom of the caller\'s box to each Op jack of the callee it may call, apart from the wires', () => {
  const d = deployment()
  d.runtimes['main']!.subscriptions.push({ kind: 'call', from: 'r', to: 'd' })   // r needs nothing named: every op of d
  const m = model(d), r = m.chassis.find(c => c.instance === 'r')!
  const ends = Object.values(m.P).filter(p => p.owner === 'd' && (p.op.kind === 'action' ? p.dir === 'in' : p.dir === 'out')).map(p => ({ x: p.x, y: p.y }))
  expect(ends.length).toBeGreaterThan(0)
  expect(m.calls).toEqual([{ id: 'main|r|d', from: 'r', to: 'd', a: { x: r.x + r.w / 2, y: r.y + r.h }, b: ends }])
  expect(m.wires.length).toBe(2)
})
