// The Connections view settings: Show Connected | All, and the runtime and pod pills.
import './dom.ts'
import { expect, test } from 'bun:test'
import { viewOf, type ViewSettings } from '../../src/wires/filter.ts'
import { Debounce, deployment, Input, k, Log, MapIface, model } from './setup.ts'

// r → d → l piped in main, r calls d in main; m sits unwired in main and in `side`
const m = (() => {
  const d = deployment()
  d.runtimes['main']!.subscriptions.push({ kind: 'call', from: 'r', to: 'd' })
  d.runtimes['side'] = { pods: ['m'], subscriptions: [] }
  return model(d)
})()
const none = { runtimes: [], pods: [] }
const view = (s: Partial<ViewSettings> = {}) => viewOf(m, { show: 'connected', pills: none, ...s })

test('Connected shows only the jacks a cord touches, and only the modules with one', () => {
  const v = view()
  expect(v.rack.map(r => r.id)).toEqual(['d'])
  expect(v.P[k('r', Input, 'submit', 'out')]).toBeDefined()
  expect(v.P[k('d', Debounce, 'push', 'in')]).toBeDefined()
  expect(v.P[k('l', Log, 'clear', 'in')]).toBeUndefined()
  expect(v.P[k('m', MapIface, 'map', 'in')]).toBeUndefined()
  expect([v.wires.length, v.calls.length]).toEqual([2, 1])
})

test('All shows every jack and module', () => {
  const v = view({ show: 'all' })
  expect(v.rack.map(r => r.id)).toEqual(['d', 'm'])
  expect(Object.keys(v.P)).toEqual(Object.keys(m.P))
})

test('a pod pill keeps the cords touching that pod, and the modules at their other ends', () => {
  const v = view({ pills: { ...none, pods: ['l'] } })
  expect(v.wires.map(w => [v.P[w.from]!.owner, v.P[w.to]!.owner])).toEqual([['d', 'l']])
  expect(v.calls).toEqual([])
  expect(v.rack.map(r => r.id)).toEqual(['d'])
  expect(v.P[k('r', Input, 'submit', 'out')]).toBeUndefined()
})

test('a runtime pill keeps that runtime\'s cords and modules', () => {
  expect(view({ pills: { ...none, runtimes: ['main'] } }).wires.length).toBe(2)
  const v = view({ show: 'all', pills: { ...none, runtimes: ['side'] } })
  expect([v.wires, v.calls, v.rack.map(r => r.id)]).toEqual([[], [], ['m']])
})

test('laid out with only a Connected view, the rack packs to the jacks it shows', async () => {
  const { buildModel, snapshotOf } = await import('../../src/wires/model.ts'), { panels, registry } = await import('./setup.ts')
  const d = deployment(); d.runtimes['main']!.subscriptions.push({ kind: 'call', from: 'r', to: 'd' })
  const input = { snapshot: snapshotOf(d, registry()), panels, W: 1200, H: 600, application: 'ui' }
  const full = buildModel(input), v = viewOf(full, { show: 'connected', pills: none }), packed = buildModel({ ...input, only: v })
  expect(Object.keys(packed.P).sort()).toEqual(Object.keys(v.P).sort())
  expect(packed.rack.map(r => r.id)).toEqual(['d'])
  expect(packed.rack[0]!.w).toBeLessThanOrEqual(full.rack[0]!.w)
})

test('a module action\'s in and out jacks are twins; a chassis jack has none', async () => {
  const { twin } = await import('../../src/wires/jacks.ts'), all = view({ show: 'all' })
  expect(twin(all.P, all.P[k('d', Debounce, 'push', 'in')]!)?.key).toBe(k('d', Debounce, 'push', 'out'))
  expect(twin(all.P, all.P[k('r', Input, 'submit', 'in')]!)).toBeUndefined()
})
