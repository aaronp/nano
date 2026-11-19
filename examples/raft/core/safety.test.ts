/** Raft's safety properties, checked after every event of every scripted run (see `scenarios` in sim.ts). */
import { expect, test } from 'bun:test'
import { scenarios } from './sim.ts'
import type { LogEntry } from './types.ts'

const runs = Object.entries(scenarios())
const same = (a: LogEntry[], b: LogEntry[]) => JSON.stringify(a) === JSON.stringify(b)

test('at most one leader per term', () => {
  const broken: string[] = []
  for (const [name, run] of runs) {
    const led = new Map<number, string>()
    for (const f of run.frames) for (const n of Object.values(f.nodes)) if (n.role === 'leader') {
      const other = led.get(n.p.currentTerm) ?? n.id
      if (other !== n.id) broken.push(`${name} @${f.at}: term ${n.p.currentTerm} led by ${other} and ${n.id}`)
      led.set(n.p.currentTerm, n.id)
    }
  }
  expect(broken).toEqual([])
})

test('log matching: same index and term ⇒ equal prefixes', () => {
  const broken: string[] = []
  for (const [name, run] of runs) for (const f of run.frames) {
    const logs = Object.values(f.nodes).map(n => n.p.log)
    for (const a of logs) for (const b of logs) {
      let i = Math.min(a.length, b.length)
      while (i > 0 && a[i - 1].term !== b[i - 1].term) i--
      if (!same(a.slice(0, i), b.slice(0, i))) broken.push(`${name} @${f.at}: logs differ below index ${i}`)
    }
  }
  expect(broken).toEqual([])
})

test('commitIndex never decreases and committed entries never change', () => {
  const broken: string[] = []
  for (const [name, run] of runs) {
    const commit: Record<string, number> = {}, committed: LogEntry[] = []
    for (const f of run.frames) for (const n of Object.values(f.nodes)) {
      const restarted = f.to === n.id && f.input.kind === 'restart'   // restart drops the volatile commitIndex
      if (!restarted && n.commitIndex < (commit[n.id] ?? 0)) broken.push(`${name} @${f.at}: ${n.id}'s commitIndex went down`)
      commit[n.id] = n.commitIndex
      const mine = n.p.log.slice(0, n.commitIndex)
      if (!same(mine.slice(0, committed.length), committed.slice(0, mine.length))) broken.push(`${name} @${f.at}: ${n.id} committed otherwise`)
      if (mine.length > committed.length) committed.push(...mine.slice(committed.length))
    }
  }
  expect(broken).toEqual([])
})
