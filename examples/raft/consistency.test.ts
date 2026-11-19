/**
 * What the history says equals what a rebuilt app holds, and the run was safe. At every boundary of the recorded run
 * (each a quiet point: `at` moves once per host input), folding each node's ledger writes gives what a shadow app
 * replayed to that time reads from the ledger, for five seeds; and the node statuses the host read along the way keep
 * Raft's safety properties.
 */
import { expect, test } from 'bun:test'
import { port, type NanoResult } from '@pritzlaff/nano-core'
import { foldAt, pair, shadowAt } from '@pritzlaff/nano-ui'
import type { LogEntry, Node } from './core/types.ts'
import { ledgerStep } from './fold.ts'
import { RaftNode } from './interfaces.ts'
import { createRaft, ids, recordedRun } from './test-host.ts'

const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
const STATUS = port(RaftNode, RaftNode.ops.status), RESTART = port(RaftNode, RaftNode.ops.restart)

test.each([1, 2, 3, 4, 5])('foldAt(ledgerStep) equals shadowAt\'s Ledger.read for every node at every quiet boundary (seed %d)', async seed => {
  const { app, store } = await recordedRun(seed)
  const boundaries = [...new Set((await store.range()).map(e => e.at))]
  const logs = new Set<string>()
  for (const t of boundaries) {
    const shadow = must(await shadowAt(store, t, createRaft))
    for (const id of ids) {
      const folded = await foldAt(store, t, ledgerStep(`${id}-ledger`))
      if (!shadow.deployment().runtimes[id]) expect(folded).toBeUndefined()
      else expect(must(await shadow.call(id, `${id}-ledger`).read(null))).toEqual(folded!)
      logs.add(JSON.stringify(folded))
    }
    await shadow.close()
  }
  expect(boundaries.length).toBeGreaterThan(25)
  expect(logs.size).toBeGreaterThan(5)   // the ledgers really changed along the way
  for (const id of ids) expect((await foldAt(store, Infinity, ledgerStep(`${id}-ledger`)))!.log.map(e => e.value)).toEqual(['a', 'b', 'c'])
  await app.close()
}, 60_000)

test.each([1, 2, 3, 4, 5])('the safety properties hold on the recorded run (seed %d)', async seed => {
  const { app, store, statuses } = await recordedRun(seed)
  // Each node's state as the host read it (`status` after every advance), in order; a restart resets its commitIndex.
  const leaders = new Map<number, Set<string>>(), commit = new Map<string, number>(), committed: LogEntry[] = []
  const boundaries = new Map<number, Node[]>()
  for (const m of pair(await store.range())) {
    if (m.sent.port === RESTART && m.outcome?.type === 'delivered' && m.outcome.ok) commit.delete(m.sent.to.replace(/-raft$/, ''))
    if (m.sent.port !== STATUS || m.outcome?.type !== 'delivered') continue
    const n = JSON.parse(m.outcome.result) as Node
    boundaries.set(m.at, [...(boundaries.get(m.at) ?? []).filter(x => x.id !== n.id), n])
    if (n.role === 'leader') leaders.set(n.p.currentTerm, (leaders.get(n.p.currentTerm) ?? new Set()).add(n.id))
    expect(n.commitIndex).toBeGreaterThanOrEqual(commit.get(n.id) ?? 0)   // commit monotone
    commit.set(n.id, n.commitIndex)
    for (const e of n.p.log.slice(0, n.commitIndex)) {   // a committed entry never changes, on any node
      committed[e.index - 1] ??= e
      expect(e).toEqual(committed[e.index - 1]!)
    }
  }
  for (const set of leaders.values()) expect(set.size).toBe(1)   // at most one leader per term
  for (const nodes of boundaries.values())   // log matching: an entry with the same index and term, the same prefix
    for (const a of nodes) for (const b of nodes) {
      const same = a.p.log.findLastIndex((e, i) => b.p.log[i]?.term === e.term)
      expect(a.p.log.slice(0, same + 1)).toEqual(b.p.log.slice(0, same + 1))
    }
  expect(boundaries.size).toBeGreaterThan(20)
  expect(leaders.size).toBeGreaterThan(1)   // the leader really changed
  expect((await statuses()).map(n => n.commitIndex)).toEqual([3, 3, 3])
  await app.close()
}, 30_000)
