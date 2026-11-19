/** The Ring's pure parts: where runtimes and pods sit, where a message's dot is, and whether the views show the past. */
import { expect, test } from 'bun:test'
import type { AppDeployment } from '@pritzlaff/nano-core'
import type { Message } from '../../src/observe/entry.ts'
import { ringDot, ringLayout, ringSource } from '../../src/observe/ring.ts'

const log = { implementation: 'nano.ui/log', eager: false }, map = { implementation: 'nano.ui/map', eager: false }
const size = 600, c = size / 2
const dist = (p: { x: number; y: number }, q = { x: c, y: c }) => Math.hypot(p.x - q.x, p.y - q.y)
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6

const one: AppDeployment = { pods: { a: log, b: log, c: map, d: map }, runtimes: { main: { pods: ['a', 'b', 'c', 'd'], subscriptions: [] } } }
/** Three runtimes, each with its own pod, sharing `msg` and `clock`. */
const three: AppDeployment = {
  pods: { n1: log, n2: log, n3: log, msg: map, clock: map },
  runtimes: Object.fromEntries([1, 2, 3].map(i => [`r${i}`, { pods: [`n${i}`, 'msg', 'clock'], subscriptions: [] }])),
}
const sent = (from: string, to: string, runtime = 'r1'): Message =>
  ({ seq: 1, at: 0, sent: { type: 'sent', id: 'm', runtime, kind: 'call', from, to, port: 'p', correlation: 'm' } })

test('one runtime: pods evenly on one circle', () => {
  const l = ringLayout(one, { size })
  expect(l.runtimes).toEqual([{ id: 'main', x: c, y: c, r: expect.any(Number) }])
  const r = l.runtimes[0]!.r
  expect(l.pods.map(p => p.pod)).toEqual(['a', 'b', 'c', 'd'])
  for (const p of l.pods) { expect(p.runtime).toBe('main'); expect(near(dist(p), r)).toBe(true) }
  const gaps = l.pods.map((p, i) => dist(p, l.pods[(i + 1) % 4]!))
  for (const g of gaps) expect(near(g, gaps[0]!)).toBe(true)
})

test('three runtimes and two shared pods: three clusters, shared pods within 0.25·size of the centre', () => {
  const l = ringLayout(three, { size })
  expect(l.runtimes.map(r => r.id)).toEqual(['r1', 'r2', 'r3'])
  for (const r of l.runtimes) expect(dist(r)).toBeGreaterThan(0.25 * size)
  const shared = l.pods.filter(p => p.runtime === null)
  expect(shared.map(p => p.pod).sort()).toEqual(['clock', 'msg'])
  for (const p of shared) expect(dist(p)).toBeLessThan(0.25 * size)
  for (const i of [1, 2, 3]) {
    const p = l.pods.find(p => p.pod === `n${i}`)!, r = l.runtimes.find(r => r.id === `r${i}`)!
    expect(p.runtime).toBe(`r${i}`)
    expect(dist(p, r)).toBeLessThanOrEqual(r.r + 1e-6)
  }
})

test('show hides pods', () => {
  const l = ringLayout(three, { size, show: (_pod, impl) => impl === 'nano.ui/map' })
  expect(l.pods.map(p => p.pod).sort()).toEqual(['clock', 'msg'])
  expect(l.runtimes.length).toBe(3)
})

test('ringDot interpolates; hidden pod uses its runtime centre; host gives undefined', () => {
  const l = ringLayout(three, { size })
  const at = (pod: string) => l.pods.find(p => p.pod === pod)!
  const a = at('n1'), b = at('msg'), mid = ringDot(l, three, sent('n1', 'msg'), 0.5)!
  expect(ringDot(l, three, sent('n1', 'msg'), 0)).toEqual({ x: a.x, y: a.y })
  expect(near(mid.x, (a.x + b.x) / 2) && near(mid.y, (a.y + b.y) / 2)).toBe(true)

  const hidden = ringLayout(three, { size, show: p => p !== 'n2' }), r2 = hidden.runtimes.find(r => r.id === 'r2')!
  expect(ringDot(hidden, three, sent('n2', 'msg', 'r2'), 0)).toEqual({ x: r2.x, y: r2.y })
  // a hidden shared pod: the centre of the message's runtime
  const noMsg = ringLayout(three, { size, show: p => p !== 'msg' }), r3 = noMsg.runtimes.find(r => r.id === 'r3')!
  expect(ringDot(noMsg, three, sent('n3', 'msg', 'r3'), 1)).toEqual({ x: r3.x, y: r3.y })

  expect(ringDot(l, three, sent('host', 'n1'), 0.5)).toBeUndefined()
  expect(ringDot(l, three, sent('n1', 'gone'), 0.5)).toBeUndefined()
})

test('ringSource: live → live; paused at newest → live; paused earlier → past; not rebuildable → too-long', () => {
  expect(ringSource('live', false, true)).toBe('live')
  expect(ringSource('paused', true, true)).toBe('live')
  expect(ringSource('paused', false, true)).toBe('past')
  expect(ringSource('playing', false, true)).toBe('past')
  expect(ringSource('paused', false, false)).toBe('too-long')
  expect(ringSource('live', false, false)).toBe('live')
})
