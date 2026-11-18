import { expect, test } from 'bun:test'
import { Pod, type AppDeployment } from '@pritzlaff/nano-core'
import { log } from '@pritzlaff/nano-ui'
import { deskModel, rankOf } from '../../src/desk/model.ts'
import { deployment, k, Debounce, Log, registry } from '../wires/setup.ts'

const all = { show: 'all' as const, pills: { runtimes: [], pods: [] } }
const desk = (d: AppDeployment, show: 'all' | 'connected' = 'all') => deskModel(d, registry(), [], { ...all, show }, 'ui')
const cols = (m: ReturnType<typeof desk>, rt: string) => m.runtimes.find(r => r.id === rt)!.columns

test('one column per pod per runtime', () => {
  const c = cols(desk(deployment()), 'main')
  expect(c.map(x => x.pod)).toEqual(['r', 'd', 'l', 'm'])
  const d = c[1]!
  expect(d.ins).toContain(k('d', Debounce, 'push', 'in'))
  expect(d.outs).toContain(k('d', Debounce, 'push', 'out'))
  expect(d.outs).toContain(k('d', Debounce, 'flushed', 'out'))
})

test('connected hides untouched jacks and pods', () => {
  const c = cols(desk(deployment(), 'connected'), 'main')
  expect(c.map(x => x.pod)).toEqual(['r', 'd', 'l'])
  expect(c.find(x => x.pod === 'l')!.ins).toEqual([k('l', Log, 'log', 'in')])
})

test('a pod in two runtimes has a column in each, and a pipe only in its own runtime', () => {
  const d = deployment()
  d.runtimes.side = { pods: ['l'], subscriptions: [] }
  const m = desk(d)
  expect(cols(m, 'side').map(x => x.pod)).toEqual(['l'])
  expect(m.pipes.every(p => p.runtime === 'main')).toBe(true)
})

const rooms = (calls: [string, string][]): AppDeployment => ({
  pods: { alice: Pod.eager(log), store: Pod.eager(log) },
  runtimes: {
    room: { pods: ['alice'], subscriptions: [] },
    backend: { pods: ['store'], subscriptions: calls.map(([from, to]) => ({ kind: 'call' as const, from, to })) },
  },
})

test('rank puts callers left', () => {
  expect(rankOf(rooms([['alice', 'store']]))).toEqual({ room: 0, backend: 1 })
})

test("a call cycle doesn't hang", () => {
  const d = rooms([['alice', 'store']])
  d.runtimes.room!.subscriptions.push({ kind: 'call', from: 'store', to: 'alice' })
  const r = rankOf(d)
  expect(Number.isFinite(r.room) && Number.isFinite(r.backend)).toBe(true)
})
