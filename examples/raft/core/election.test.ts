/** Elections on the seeded simulator: one leader, everyone following it, and a seed always gives the same result. */
import { expect, test } from 'bun:test'
import { leaders, scenarios, simulate } from './sim.ts'
import { initial, step } from './step.ts'

const runs = scenarios()

test('election: sizes 3 and 5, seeds 1–5: exactly one leader within 2000 ms', () => {
  for (const size of [3, 5]) for (let seed = 1; seed <= 5; seed++) {
    const last = runs[`election ${size}/${seed}`].frames.at(-1)!
    expect(last.at).toBe(2000)
    const [leader, ...more] = leaders(last)
    expect(more).toEqual([])
    for (const n of Object.values(last.nodes)) expect([n.leader, n.p.currentTerm]).toEqual([leader.id, leader.p.currentTerm])
  }
})

test('same seed → same leader and term', () => {
  const outcome = (seed: number) => leaders(simulate({ size: 5, seed }).frames.at(-1)!).map(n => [n.id, n.p.currentTerm])
  for (let seed = 1; seed <= 5; seed++) expect(outcome(seed)).toEqual(outcome(seed))
  expect(outcome(1)).toEqual(leaders(runs['election 5/1'].frames.at(-1)!).map(n => [n.id, n.p.currentTerm]))
})

test('a vote is made durable before it is answered', () => {
  const n = initial('n2', ['n1', 'n3'], { currentTerm: 0, votedFor: null, log: [] }, 0, () => 0.5)
  const { effects } = step(n, { kind: 'receive', from: 'n1', rpc: { kind: 'vote', term: 1, lastIndex: 0, lastTerm: 0 } }, 5, () => 0.5)
  expect(effects).toEqual([
    { kind: 'persist', p: { currentTerm: 1, votedFor: 'n1', log: [] } },
    { kind: 'send', to: 'n1', rpc: { kind: 'vote-reply', term: 1, granted: true } }])
})
