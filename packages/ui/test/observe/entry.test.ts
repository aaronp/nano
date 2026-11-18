import { expect, test } from 'bun:test'
import { CAP, pair, snap, truncated, type Entry, type Recorded } from '../../src/observe/entry.ts'

test('snap never throws and marks what JSON cannot carry', () => {
  expect(snap(undefined)).toBe('undefined')
  expect(snap({ f() {} })).toBe('{"f":"[function]"}')
  const c: Record<string, unknown> = {}; c.self = c
  expect(snap(c)).toContain('[cycle]')
  expect(snap(10n)).toBe('"10n"')
})

test('snap caps long text and truncated says so', () => {
  const s = snap('x'.repeat(70000))
  expect(s.length).toBeLessThanOrEqual(CAP + 12)
  expect(truncated(s)).toBe(true)
  expect(truncated(snap('short'))).toBe(false)
})

const e = (seq: number, event: Recorded): Entry => ({ seq, at: seq, event })
const sent = (id: string): Recorded => ({ type: 'sent', id, runtime: 'r', kind: 'call', from: 'host', to: 'a.b', port: 'p', correlation: id })

test('pair joins sent with delivered or denied, keeps in-flight, skips orphans', () => {
  const ms = pair([
    e(1, sent('m1')), e(2, sent('m2')), e(3, sent('m3')),
    e(4, { type: 'delivered', id: 'm1', ok: true, result: '1', ms: 2 }),
    e(5, { type: 'denied', id: 'm3', reason: 'no' }),
    e(6, { type: 'delivered', id: 'gone', ok: true, result: '1', ms: 2 }),
  ])
  expect(ms.map(m => m.sent.id)).toEqual(['m1', 'm2', 'm3'])
  expect(ms[0]!.outcome?.type).toBe('delivered')
  expect(ms[1]!.outcome).toBeUndefined()
  expect(ms[2]!.outcome?.type).toBe('denied')
})

test('snap keeps shared references and marks only true cycles', () => {
  const x = { n: 1 }
  expect(snap({ a: x, b: x })).toBe(JSON.stringify({ a: x, b: x }))
  expect(snap([x, x])).toBe(JSON.stringify([x, x]))
  const c: Record<string, unknown> = { k: x }; c.self = { deep: c }
  expect(snap(c)).toBe('{"k":{"n":1},"self":{"deep":"[cycle]"}}')
})
