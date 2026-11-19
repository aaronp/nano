/** A runtime's slice of the application and closing (specs: 2026-11-14-values-and-application-design.md, 2026-11-14-pods-runtimes-application-design.md); fixtures in fixtures/acme-closing.ts. */
import { describe, expect, test } from 'bun:test'
import { Pod, success } from '../src/index.ts'
import { counter, ok, live, one } from './fixtures/acme-closing.ts'

describe("a runtime's slice", () => {
  // Revised behaviour 17: no live runtime object; app.call and listen filtered by runtime.
  test('given two runtimes, when the host calls through one, then only that runtime records it, and unknown runtimes or unplaced pods are not-found', async () => {
    const { app, events } = await live({ pods: { c: Pod.lazy(counter), d: Pod.lazy(counter) },
      runtimes: { chat: { pods: ['c'], subscriptions: [] }, other: { pods: ['c', 'd'], subscriptions: [] } } })
    expect(await app.call('chat', 'c').inc(null)).toEqual(success(1))
    expect(events.filter(e => 'runtime' in e && e.runtime === 'chat').map(e => e.type)).toEqual(['sent'])
    expect(events.filter(e => e.type === 'sent').map(e => `${e.runtime}:${e.kind}:${e.from}->${e.to}`)).toEqual(['chat:call:host->c'])
    expect(events.filter(e => 'runtime' in e && e.runtime === 'other')).toEqual([])
    expect(await app.call('nope', 'c').inc(null)).toMatchObject({ ok: false, fail: { type: 'not-found' } })
    expect(await app.call('chat', 'd').inc(null)).toMatchObject({ ok: false, fail: { type: 'not-found' } })
  })
})
