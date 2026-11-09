// The Timer: ticks while running and publishes each count; start, stop, reset and a checked interval.
import { expect, test } from 'bun:test'
import { Components, Ops, Registries, Runtimes, type Op } from '@pritzlaff/nano-core'
import { component } from '@pritzlaff/nano-runes'
import { Timer } from '../src'

const tick = (ms: number) => new Promise(r => setTimeout(r, ms))
const Spy = component('test/spy', () => { const got: unknown[] = []; return { get got() { return got }, take: (x: unknown) => { got.push(x) } } })

/** A page with one Timer `t`, calls by op, and what its `tick` published. */
function page() {
  const rt = Runtimes.create(Registries.create('page')), reg = rt.registry
  reg.add('t', Components.instantiate(Timer))
  reg.add('spy', Components.instantiate(Spy))
  reg.subscribe({ source: 't', op: Ops.key(Timer.ops.tick), listener: 'spy', target: Ops.key(Spy.ops.take) })
  const call = (op: Op, arg: unknown = null) => rt.call({ registry: 'page', instance: 'test' }, 't', Ops.key(op), arg) as Promise<any>
  const value = async (op: Op) => (await call(op)).value
  return { rt, reg, call, value, ticks: (reg.get('spy')!.value as { got: unknown[] }).got }
}

test('started, it ticks and publishes each count in order', async () => {
  const { call, value, ticks } = page()
  await call(Timer.ops.setInterval, 20); await call(Timer.ops.start)
  await tick(75)
  expect(await value(Timer.ops.running)).toBe(true)
  const count = await value(Timer.ops.count)
  expect(count).toBeGreaterThanOrEqual(2)
  expect(ticks).toEqual(Array.from({ length: count }, (_, i) => i + 1))
})

test('starting twice runs one clock, and a new interval restarts it', async () => {
  const { call, value } = page()
  await call(Timer.ops.setInterval, 20); await call(Timer.ops.start); await call(Timer.ops.start)
  await tick(75)
  expect(await value(Timer.ops.count)).toBeLessThanOrEqual(4)
  await call(Timer.ops.reset); await call(Timer.ops.setInterval, 200)
  await tick(60)
  expect(await value(Timer.ops.count)).toBe(0)
  expect(await value(Timer.ops.interval)).toBe(200)
})

test('stop holds the count; reset zeroes it and keeps running as it was', async () => {
  const { call, value } = page()
  await call(Timer.ops.setInterval, 20); await call(Timer.ops.start)
  await tick(50); await call(Timer.ops.stop)
  const held = await value(Timer.ops.count)
  await tick(50)
  expect(await value(Timer.ops.count)).toBe(held)
  expect(await value(Timer.ops.running)).toBe(false)
  await call(Timer.ops.reset)
  expect(await value(Timer.ops.count)).toBe(0)
  expect(await value(Timer.ops.running)).toBe(false)
  await call(Timer.ops.start); await call(Timer.ops.reset)
  expect(await value(Timer.ops.running)).toBe(true)
  await call(Timer.ops.stop)
})

test('an interval under 10ms, over 2^31-1ms, or not a number, is refused', async () => {
  const { call, value } = page()
  expect(await call(Timer.ops.setInterval, 5)).toHaveProperty('error')
  expect(await call(Timer.ops.setInterval, 'x')).toHaveProperty('error')
  expect(await call(Timer.ops.setInterval, 2 ** 31)).toHaveProperty('error')   // timers clamp longer delays to ~1ms
  expect(await value(Timer.ops.interval)).toBe(1000)
})

test('a running timer removed from its registry never throws', async () => {
  const { call, reg } = page()
  const errors: unknown[] = [], report = globalThis.reportError
  globalThis.reportError = e => { errors.push(e) }
  try {
    await call(Timer.ops.setInterval, 10); await call(Timer.ops.start)
    reg.remove('t')
    await tick(50)
    expect(errors).toEqual([])
  } finally { globalThis.reportError = report }
})
