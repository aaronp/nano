import { describe, expect, test } from 'bun:test'
import type { Node } from '../core/types.ts'
import { detailModel, glyphModel, gridModel, ledgerModel, paced } from './model.ts'

const peer = { next: 1, match: 0, granted: false, rpcDue: 0, heartbeatDue: 0 }
const timing = { electionMin: 150, electionMax: 300, heartbeat: 50 }
const node = (o: Partial<Node> = {}): Node => ({ id: 'a', peers: ['b', 'c'], p: { currentTerm: 2, votedFor: 'a', log: [] }, role: 'follower',
  commitIndex: 0, leader: null, electionAlarm: 1300, stopped: false, progress: { b: { ...peer }, c: { ...peer } }, timing, ...o })

describe('glyphModel', () => {
  test('a follower: term, role, no dots lit, arc = time left / electionMax', () => {
    expect(glyphModel(node(), 1150)).toEqual({ term: 2, role: 'follower', stopped: false, arc: 0.5, peers: [{ id: 'b', state: 'idle' }, { id: 'c', state: 'idle' }] })
  })
  test('the arc is 0 at the alarm (and after), 1 at a fresh timeout, never past 1', () => {
    expect(glyphModel(node(), 1300).arc).toBe(0)
    expect(glyphModel(node(), 1400).arc).toBe(0)
    expect(glyphModel(node(), 1000).arc).toBe(1)
    expect(glyphModel(node(), 0).arc).toBe(1)
  })
  test('a candidate: pending while a request is out, granted once voted, idle once refused', () => {
    const c = node({ role: 'candidate', progress: {
      b: { ...peer, rpcDue: 1100 },                        // sent, awaiting
      c: { ...peer, granted: true, rpcDue: 1300 } } })      // answered
    expect(glyphModel(c, 1000).peers).toEqual([{ id: 'b', state: 'pending' }, { id: 'c', state: 'granted' }])
    const refused = node({ role: 'candidate', progress: { b: { ...peer, rpcDue: 1300 }, c: { ...peer } } })
    expect(glyphModel(refused, 1000).peers.map(p => p.state)).toEqual(['idle', 'idle'])
  })
  test('a leader: pending while an append is out; no arc', () => {
    const l = node({ role: 'leader', progress: { b: { ...peer, rpcDue: 1100 }, c: { ...peer, rpcDue: 0 } } })
    expect(glyphModel(l, 1000)).toMatchObject({ role: 'leader', arc: 0, peers: [{ state: 'pending' }, { state: 'idle' }] })
  })
  test('stopped: flagged, no pending dots', () => {
    const s = node({ role: 'leader', stopped: true, progress: { b: { ...peer, rpcDue: 1100 }, c: { ...peer } } })
    expect(glyphModel(s, 1000)).toMatchObject({ stopped: true, peers: [{ state: 'idle' }, { state: 'idle' }] })
  })
})

describe('detailModel', () => {
  test('rows and a peers table, times as signed ms with one decimal', () => {
    const s = node({ role: 'leader', commitIndex: 3, progress: { b: { next: 4, match: 3, granted: false, rpcDue: 1010, heartbeatDue: 990.25 }, c: { ...peer } } })
    expect(detailModel(s, 1000)).toEqual({
      rows: [['state', 'leader'], ['currentTerm', '2'], ['votedFor', 'a'], ['commitIndex', '3'], ['election alarm', '+300.0 ms']],
      peers: [{ peer: 'b', next: 4, match: 3, granted: false, rpcDue: '+10.0 ms', heartbeatDue: '-9.8 ms' },
        { peer: 'c', next: 1, match: 0, granted: false, rpcDue: '-1000.0 ms', heartbeatDue: '-1000.0 ms' }] })
  })
  test('no vote shows a dash; stopped shows as the state', () => {
    const d = detailModel(node({ p: { currentTerm: 0, votedFor: null, log: [] }, stopped: true }), 0)
    expect(d.rows.slice(0, 3)).toEqual([['state', 'stopped'], ['currentTerm', '0'], ['votedFor', '—']])
  })
})

test('ledgerModel: currentTerm and votedFor, then the entries, those up to commitIndex committed', () => {
  const log = [{ index: 1, term: 1, value: 'x', at: 10 }, { index: 2, term: 2, value: { n: 1 }, at: 20.55 }]
  expect(ledgerModel({ currentTerm: 2, votedFor: 'b', log }, 1)).toEqual({ currentTerm: 2, votedFor: 'b', rows: [
    { index: 1, term: 1, value: 'x', at: '10.0', committed: true }, { index: 2, term: 2, value: '{"n":1}', at: '20.6', committed: false }] })
  expect(ledgerModel({ currentTerm: 0, votedFor: null, log: [] }, 0)).toEqual({ currentTerm: 0, votedFor: null, rows: [] })
})

test('gridModel: at least 10 columns, null where there is no entry, committed up to commitIndex; a longer log grows the columns', () => {
  const e = (index: number, term: number) => ({ index, term, value: 'x', at: 0 })
  const empty = gridModel([{ id: 'a', p: { currentTerm: 0, votedFor: null, log: [] }, commitIndex: 0 }])
  expect(empty).toEqual({ columns: 10, rows: [{ id: 'a', cells: Array(10).fill(null) }] })
  const log = Array.from({ length: 12 }, (_, i) => e(i + 1, 2))
  const g = gridModel([{ id: 'a', p: { currentTerm: 2, votedFor: null, log }, commitIndex: 11 }, { id: 'b', p: { currentTerm: 2, votedFor: null, log: [e(1, 1)] }, commitIndex: 0 }])
  expect(g.columns).toBe(12)
  expect(g.rows[0]!.cells[10]).toEqual({ term: 2, committed: true })
  expect(g.rows[0]!.cells[11]).toEqual({ term: 2, committed: false })
  expect(g.rows[1]!.cells).toEqual([{ term: 1, committed: false }, ...Array(11).fill(null)])
})

describe('paced', () => {
  test('the first sample assumes real time; a window of 500 ms or more measures sim ms per real ms', () => {
    let p = paced(undefined, 1000, 0)
    expect(p).toMatchObject({ sim: 1000, wall: 0, rate: 1 })
    p = paced(p, 1100, 100)   // too soon to measure: the rate stays
    expect(p.rate).toBe(1)
    p = paced(p, 3000, 500)   // 2000 sim ms in 500 real ms
    expect(p).toMatchObject({ sim: 3000, wall: 500, rate: 4 })
  })
  test('a gap over 2 s (a pause) starts a new window and keeps the rate', () => {
    let p = paced(paced(undefined, 0, 0), 2000, 1000)
    expect(p.rate).toBe(2)
    p = paced(p, 2010, 9000)
    expect(p).toMatchObject({ sim: 2010, wall: 9000, rate: 2 })
    expect(paced(p, 3010, 9500).rate).toBe(2)   // measured from the restart, not across the pause
  })
})
