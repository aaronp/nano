import { expect, test } from 'bun:test'
import type { AppDeployment } from '@pritzlaff/nano-core'
import type { Recorded } from '../../src/observe/entry.ts'
import { foldAt } from '../../src/observe/fold.ts'
import { memoryStore } from '../../src/observe/memory-store.ts'

/** A store filled by hand: a clean start at 0, then `log` calls at 1, 2, 3 (the second fails), an apply at 4, and one more call at 4. */
function logged() {
  const store = memoryStore()
  let seq = 0
  const add = (at: number, event: Recorded) => store.append({ seq: ++seq, at, event })
  const d = (n: number): AppDeployment => ({ pods: { log: { implementation: 'nano.ui/log', eager: false, config: n } }, runtimes: {} })
  const call = (at: number, id: string, ok: boolean) => {
    add(at, { type: 'sent', id, runtime: 'main', kind: 'call', from: 'host', to: 'log', port: 'nano.ui.Log/log', correlation: id, input: `"${id}"` })
    add(at, { type: 'delivered', id, ok, result: ok ? 'null' : '{"type":"invalid-input"}', ms: 0 })
  }
  add(0, { type: 'deployment', deployment: d(0), clean: true })
  call(1, 'a', true); call(2, 'b', false); call(3, 'c', true)
  add(4, { type: 'deployment', deployment: d(1) })
  call(4, 'd', true)
  return store
}

const succeeded = { initial: 0, step: (n: number, m: { outcome?: Recorded }) => n + (m.outcome?.type === 'delivered' && m.outcome.ok ? 1 : 0) }

test('foldAt over a log pod counts only successful messages, at or before t', async () => {
  const store = logged()
  expect(await foldAt(store, -1, succeeded)).toBe(0)
  expect(await foldAt(store, 2, succeeded)).toBe(1)
  expect(await foldAt(store, 3, succeeded)).toBe(2)
  expect(await foldAt(store, Infinity, succeeded)).toBe(3)
})

test('foldAt hands step the deployments in seq order among the messages', async () => {
  const seen: string[] = []
  await foldAt(logged(), Infinity, {
    initial: null,
    step: (s, m) => { seen.push(m.sent.id); return s },
    deployment: (s, d) => { seen.push(`d${d.pods['log']!.config}`); return s },
  })
  expect(seen).toEqual(['d0', 'a', 'b', 'c', 'd1', 'd'])
})
