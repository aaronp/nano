import { expect, test } from 'bun:test'
import type { Entry, MessageStore } from '../../src/recorder/entry.ts'

const sent = (seq: number, to = 'a.b', input = 'x'): Entry => ({
  seq, at: seq,
  event: { type: 'sent', id: `m${seq}`, runtime: 'r', kind: 'call', from: 'host', to, port: 'p', correlation: `m${seq}`, input },
})

/** Registers the tests every MessageStore must pass. */
export function storeContract(make: (max: number) => MessageStore): void {
  test('appends come back in seq order from range', async () => {
    const s = make(100)
    for (const n of [1, 2, 3]) s.append(sent(n))
    expect((await s.range()).map(e => e.seq)).toEqual([1, 2, 3])
  })
  test('range(3, 5) is inclusive', async () => {
    const s = make(100)
    for (let n = 1; n <= 7; n++) s.append(sent(n))
    expect((await s.range(3, 5)).map(e => e.seq)).toEqual([3, 4, 5])
  })
  test('search finds by pod name and by value text, case-insensitively', async () => {
    const s = make(100)
    s.append(sent(1, 'Cart.add', 'apple'))
    s.append(sent(2, 'user.get', 'Banana'))
    expect((await s.search('CART')).map(e => e.seq)).toEqual([1])
    expect((await s.search('banana')).map(e => e.seq)).toEqual([2])
  })
  test('search with limit 0 or below finds nothing', async () => {
    const s = make(100)
    s.append(sent(1))
    expect(await s.search('a.b', 0)).toEqual([])
    expect(await s.search('a.b', -1)).toEqual([])
  })
  test('when full, the oldest is dropped and oldest() moves on', async () => {
    const s = make(3)
    for (let n = 1; n <= 5; n++) s.append(sent(n))
    expect(await s.oldest()).toBe(3)
    expect(await s.size()).toBe(3)
  })
  test('clear empties it', async () => {
    const s = make(100)
    s.append(sent(1))
    await s.clear()
    expect(await s.size()).toBe(0)
    expect(await s.oldest()).toBeUndefined()
  })
  test('flush resolves', async () => {
    await make(100).flush()
  })
}
