/** Requests, refusals, stops, resumes and restarts on the seeded simulator (see `scenarios` in sim.ts). */
import { expect, test } from 'bun:test'
import { leaders, scenarios, type Frame, type Run } from './sim.ts'
import { initial, step } from './step.ts'
import type { Node } from './types.ts'

const runs = scenarios()
const end = (run: Run) => run.frames.at(-1)!
const nodes = (f: Frame) => Object.values(f.nodes)
const values = (n: Node) => n.p.log.map(e => e.value)
const refusalsAt = (run: Run, at: number) => run.refusals.filter(r => r.at === at)

test('request to the leader commits on a majority; all logs match', () => {
  const last = end(runs.replicate)
  for (const n of nodes(last)) {
    expect(values(n)).toEqual(['a', 'b', 'c'])
    expect(n.commitIndex).toBe(3)
    expect(n.p.log).toEqual(leaders(last)[0].p.log)
  }
})

test("request to a follower: refused 'not leader' naming the leader", () => {
  const leader = leaders(runs.replicate.frames.findLast(f => f.at < 1000)!)[0].id
  const refused = refusalsAt(runs.replicate, 1000)
  expect(refused.map(r => r.to).sort()).toEqual(['n1', 'n2', 'n3'].filter(x => x !== leader))
  for (const r of refused) expect(r.effect).toEqual({ kind: 'refused', reason: 'not leader', leader })
})

test("no leader known: refused 'no leader known'", () => {
  expect(refusalsAt(runs.replicate, 0)).toEqual([{ at: 0, to: 'n1', effect: { kind: 'refused', reason: 'no leader known' } }])
})

test("request to a stopped node: refused 'stopped', ledger unchanged", () => {
  const run = runs.minority, before = run.frames.findLast(f => f.at === 1000)!
  const stopped = nodes(before).filter(n => n.stopped).map(n => n.id)
  expect(stopped.length).toBe(2)
  const refused = refusalsAt(run, 1100).filter(r => stopped.includes(r.to))
  expect(refused.map(r => r.effect)).toEqual(stopped.map(() => ({ kind: 'refused', reason: 'stopped' })))
  const resumed = run.frames.findLast(f => f.at < 1400)!
  for (const id of stopped) expect(resumed.ledgers[id]).toEqual(before.ledgers[id])
})

test('stopped minority: commits continue', () => {
  for (const n of nodes(runs.minority.frames.findLast(f => f.at < 1400)!)) {
    expect(values(n)).toEqual(n.stopped ? [] : ['x'])
    if (!n.stopped) expect(n.commitIndex).toBe(1)
  }
  const last = end(runs.minority)   // back, and one timed out at once with a stale log: it didn't win
  expect(leaders(last).length).toBe(1)
  for (const n of nodes(last)) expect([n.commitIndex, values(n)]).toEqual([1, ['x']])
})

test('stopped majority: no leader, no commit; after resume a leader and commits', () => {
  const run = runs.majority
  const lone = run.frames.findLast(f => f.at < 1300)!
  expect(leaders(lone).map(values)).toEqual([['blocked']])   // accepted, but three of five are down
  for (const f of run.frames.filter(f => f.at > 1000 && f.at < 2000)) {
    if (f.at > 1300) expect(leaders(f)).toEqual([])
    for (const n of nodes(f)) expect(n.commitIndex).toBe(0)
  }
  const last = end(run), [leader] = leaders(last)
  expect(leaders(last).length).toBe(1)
  expect(values(leader)).toContain('after')
  for (const n of nodes(last)) expect([n.commitIndex, n.p.log]).toEqual([leader.p.log.length, leader.p.log])
})

test('stopped leader replaced; after resume its uncommitted entries are overwritten', () => {
  const run = runs.replaced, old = leaders(run.frames.findLast(f => f.at < 1005)!)[0].id
  expect(values(run.frames.findLast(f => f.at < 1900)!.nodes[old])).toEqual(['lost'])
  const last = end(run)
  expect(leaders(last).map(n => n.id)).not.toContain(old)
  for (const n of nodes(last)) expect([n.commitIndex, values(n)]).toEqual([1, ['kept']])
})

test('restart keeps term, vote and log', () => {
  const run = runs.restart, i = run.frames.findIndex(f => f.input.kind === 'restart')
  const before = run.frames[i - 1], after = run.frames[i].nodes.n1
  expect(after.p).toEqual(before.ledgers.n1)
  expect(after.p).toEqual(before.nodes.n1.p)
  expect(values(after)).toEqual(['r'])
  expect([after.role, after.commitIndex, after.leader]).toEqual(['follower', 0, null])
  expect(end(run).nodes.n1.commitIndex).toBe(1)
})

test('Figure 8: a leader commits earlier terms\' entries only by matching one of its own term on a majority', () => {
  const log = [{ index: 1, term: 1, value: 'a', at: 0 }, { index: 2, term: 2, value: 'b', at: 0 }]
  let n: Node = { ...initial('n1', ['n2', 'n3'], { currentTerm: 3, votedFor: 'n1', log }, 0, () => 0), role: 'leader' }
  const reply = (match: number) => step(n, { kind: 'receive', from: 'n2', rpc: { kind: 'append-reply', term: 3, success: true, match } }, 0, () => 0).node
  n = reply(2)
  expect(n.commitIndex).toBe(0)   // n1 and n2 hold entries 1–2, a majority, but from terms 1 and 2
  n = step(n, { kind: 'request', value: 'c' }, 0, () => 0).node
  n = reply(3)
  expect(n.commitIndex).toBe(3)   // entry 3 (term 3) on a majority commits it and everything before
})
