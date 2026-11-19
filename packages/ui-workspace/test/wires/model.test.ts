import './dom.ts'
import { expect, test } from 'bun:test'
import { checkConnect } from '../../src/wires'
import { routeChains } from '../../src/wires/routes.ts'
import { Debounce, deployment, Input, k, Log, MapIface, model, p1, p2, panels, registry } from './setup.ts'
import { buildModel, snapshotOf, wireId } from '../../src/wires/model.ts'
import { Pod } from '@pritzlaff/nano-core'
import { input } from '@pritzlaff/nano-ui'

test('panels become mirrored chassis with jacks: outs along the top, ins along the bottom', () => {
  const m = model(deployment())
  expect(m.chassis.map(c => [c.label, c.x, c.instance])).toEqual([['r', 800, 'r'], ['l', 400, 'l'], ['textarea', 0, null]])
  const out = m.P[k('r', Input, 'submit', 'out')]!, inn = m.P[k('r', Input, 'submit', 'in')]!
  expect([out.dir, out.kind, out.y]).toEqual(['out', 'chassis', 70])
  expect([inn.dir, inn.y]).toEqual(['in', 220])
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
    { id: wireId('main', p1), runtime: 'main', route: wireId('main', p1), from: k('r', Input, 'submit', 'out'), to: k('d', Debounce, 'push', 'in') },
    { id: wireId('main', p2), runtime: 'main', route: wireId('main', p1), from: k('d', Debounce, 'flushed', 'out'), to: k('l', Log, 'log', 'in') },
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

test('routeChains matches the chain the puzzle gave, with a fork where one output feeds two inputs', () => {
  const d = deployment()
  expect(Object.values(routeChains(model(d)))).toEqual(['r.submit → d → l.log'])   // values buildPuzzle(...).descs gave at 3739c79
  d.runtimes['main']!.subscriptions.push({ kind: 'pipe', from: 'd', source: p2.source, to: 'm', target: 'nano.ui.Map/map' })
  expect(Object.values(routeChains(model(d)))).toEqual(['r.submit → d → fork(l.log | m)'])
})

test('a call edge goes from the bottom of the caller\'s box to each Op jack of the callee it may call, apart from the wires', () => {
  const d = deployment()
  d.runtimes['main']!.subscriptions.push({ kind: 'call', from: 'r', to: 'd' })   // r needs nothing named: every op of d
  const m = model(d), r = m.chassis.find(c => c.instance === 'r')!
  const jacks = Object.values(m.P).filter(p => p.owner === 'd' && (p.op.kind === 'action' ? p.dir === 'in' : p.dir === 'out')), ends = jacks.map(p => ({ x: p.x, y: p.y }))
  expect(ends.length).toBeGreaterThan(0)
  expect(m.calls).toEqual([{ id: 'main|r|d', runtime: 'main', from: 'r', to: 'd', jacks: jacks.map(p => p.key), a: { x: r.x + r.w / 2, y: r.y + r.h }, b: ends }])
  expect(m.wires.length).toBe(2)
})

test('every action is an input jack and an output jack; every event is an output jack only, on panel backs and rack modules alike', () => {
  const m = model(deployment(), { d: 'nano.ui/debounce' })
  const dirs = (owner: string, op: string) => Object.values(m.P).filter(p => p.owner === owner && p.label === op).map(p => p.dir).sort()
  expect([dirs('r', 'submit'), dirs('d', 'push'), dirs('d', 'flushed')]).toEqual([['in', 'out'], ['in', 'out'], ['out']])
  expect([m.P[k('r', Input, 'submit', 'in')]!.kind, m.P[k('d', Debounce, 'push', 'in')]!.kind]).toEqual(['chassis', 'module'])
  // on a module an action's two jacks sit side by side
  const pin = m.P[k('d', Debounce, 'push', 'in')]!, pout = m.P[k('d', Debounce, 'push', 'out')]!
  expect(pout.x - pin.x).toBe(Math.round(pin.slot))
})

test('an op-level call draws from the caller\'s op to the callee\'s; seen but not declared is marked so; old edges are as before', () => {
  const d = deployment()
  d.runtimes['main']!.subscriptions.push({ kind: 'call', from: 'r', to: 'd' })
  const source = k('r', Input, 'submit', 'out').slice(2, -4), target = k('d', Debounce, 'push', 'in').slice(2, -3)
  const call = { runtime: 'main', from: 'r', to: 'd', source, target, declared: false, seen: true }
  const m = buildModel({ snapshot: snapshotOf(d, registry(), [call]), panels, W: 1200, H: 600, application: 'ui' })
  const a = m.P[k('r', Input, 'submit', 'out')]!, b = m.P[k('d', Debounce, 'push', 'in')]!   // the caller's output, the callee's input
  expect(m.calls[0]!.ops).toEqual([{ a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y }, declared: false, seen: true }])
  expect(m.calls[0]!.b).toEqual([])   // no pod-level line once every pair has a source
  expect(model(d).calls[0]!.ops).toBeUndefined()
})

test('an edge whose pairs name no jack here keeps the pod-level cord', () => {
  const d = deployment()
  d.runtimes['main']!.subscriptions.push({ kind: 'call', from: 'r', to: 'd' })
  const call = { runtime: 'main', from: 'r', to: 'd', source: 'acme.Gone/op', target: 'acme.Gone/other', declared: true, seen: false }
  const m = buildModel({ snapshot: snapshotOf(d, registry(), [call]), panels, W: 1200, H: 600, application: 'ui' })
  expect(m.calls).toEqual(model(d).calls)
  expect(m.calls[0]!.b.length).toBeGreaterThan(0)
})

test('a not-declared op cord carries a visible "not declared" label; a declared one does not', async () => {
  const { render } = await import('lit'), { opCord } = await import('../../src/wires/calls.ts')
  const draw = (declared: boolean) => { const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as unknown as HTMLElement
    render(opCord({ a: { x: 0, y: 0 }, b: { x: 100, y: 40 }, declared, seen: true }), el); return el }
  expect(draw(false).querySelector('[data-not-declared]')?.textContent).toBe('not declared')
  expect(draw(true).querySelector('[data-not-declared]')).toBeNull()
})
