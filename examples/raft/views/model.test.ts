import { describe, expect, test } from 'bun:test'
import type { Node } from '../core/types.ts'
import { detailModel, glyphModel, ledgerModel } from './model.ts'

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
