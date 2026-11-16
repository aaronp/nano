import { describe, expect, test } from 'bun:test'
import { Implementation } from '../src/implementation.ts'
import { Pod } from '../src/pod.ts'

const counter = Implementation.define('acme/counter', { provides: [], make: () => [] })
const ticker = Implementation.define('acme/ticker', { provides: [], make: () => [] })

describe('pod', () => {
  test('lazy and eager pods are plain data that survive a JSON round trip', () => {
    const d = { pods: { c: Pod.lazy(counter, { config: { start: 1 } }), t: Pod.eager(ticker) } }
    expect(d.pods.c).toEqual({ implementation: 'acme/counter', config: { start: 1 }, eager: false })
    expect(d.pods.t).toEqual({ implementation: 'acme/ticker', eager: true })
    expect(JSON.parse(JSON.stringify(d))).toEqual(d)
  })
  test('a pod without config has no config key', () => {
    expect('config' in Pod.lazy(counter)).toBe(false)
  })
})
