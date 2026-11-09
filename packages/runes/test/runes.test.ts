import { expect, test } from 'bun:test'
import { Type } from 'typebox'
import { Components, Ops, Registries, Runtimes, type Component, type Op } from '@composable/core'
import { component, event, state } from '../src'

const tick = () => new Promise(r => setTimeout(r, 0))

const Counter = component('acme/counter', () => {
  const s = state({ count: 0 })
  return {
    get count() { return s.count },
    increment: () => { s.count += 1 },
  }
})

const Log = component('demo/log', () => {
  const s = state({ lines: [] as unknown[] })
  return { get lines() { return s.lines }, log: (x: unknown) => { s.lines.push(x) } }
})

const page = () => {
  const rt = Runtimes.create(Registries.create('page')), reg = rt.registry
  const add = (id: string, c: Component) => { const i = Components.instantiate(c); reg.add(id, i); return i }
  const wire = (source: string, op: Op, listener: string, target: Op) => reg.subscribe({ source, op: Ops.key(op), listener, target: Ops.key(target) })
  const call = async (id: string, op: Op, arg: unknown = null) => rt.call({ registry: 'page', instance: 'me' }, id, Ops.key(op), arg) as Promise<any>
  return { reg, add, wire, call }
}

test('a counter: increment is an action, count is published when it changes', async () => {
  const { add, wire, call } = page()
  add('counter', Counter); add('log', Log)
  wire('counter', Counter.ops.count, 'log', Log.ops.log)
  await call('counter', Counter.ops.increment); await tick()
  await call('counter', Counter.ops.increment); await tick()
  expect((await call('log', Log.ops.lines)).value).toEqual([1, 2])
})

test('ops are known at definition, and listed when an instance is added', () => {
  expect(Ops.key(Counter.ops.count)).toBe('acme/counter/count')
  const { reg, add } = page()
  add('counter', Counter)
  expect(reg.snapshot().instances.find(i => i.id === 'counter')!.ops.map(o => o.name).sort()).toEqual(['count', 'increment'])
})

const Slider = component('demo/slider', () => {
  const s = state({ value: 0 })
  return { get value() { return s.value }, set: (v: number) => { s.value = v } }
}, { set: Type.Number() })

const Debounce = component('demo/debounce', () => {
  const s = state({ ms: 20, batch: [] as unknown[] })
  let buffer: unknown[] = [], timer: Timer | undefined
  return {
    get batch() { return s.batch },
    every: (ms: number) => { s.ms = ms },
    in: (x: unknown) => { buffer.push(x); clearTimeout(timer); timer = setTimeout(() => { s.batch = buffer; buffer = [] }, s.ms) },
  }
})

const Table = component('demo/table', () => {
  const s = state({ rows: [] as [number, unknown][] })
  return {
    get csv() { return ['time,value', ...s.rows.map(r => r.join(','))].join('\n') },
    rows: (xs: unknown[]) => { for (const x of xs) s.rows.push([0, x]) },
  }
})

test('slider → debounce (frequency from a second slider) → table', async () => {
  const { add, wire, call } = page()
  add('slider', Slider); add('freq', Slider); add('debounce', Debounce); add('table', Table)
  wire('slider', Slider.ops.value, 'debounce', Debounce.ops.in)
  wire('freq', Slider.ops.value, 'debounce', Debounce.ops.every)
  wire('debounce', Debounce.ops.batch, 'table', Table.ops.rows)
  await call('freq', Slider.ops.set, 10); await tick()
  for (const v of [1, 2, 3]) { await call('slider', Slider.ops.set, v); await tick() }
  await Bun.sleep(30)
  await call('slider', Slider.ops.set, 4); await tick()
  await Bun.sleep(30)
  expect((await call('table', Table.ops.csv)).value).toBe('time,value\n0,1\n0,2\n0,3\n0,4')
  expect('error' in await call('slider', Slider.ops.set, 'loud')).toBe(true)   // the schema still guards
})

/** A component that counts what it receives, and keeps the last value. */
const Spy = component('demo/spy', () => {
  let n = 0, last: unknown
  return { get seen() { return n }, get last() { return last }, take: (x: unknown) => { n++; last = x } }
})
const Many = component('demo/many', () => {
  const s = state({ a: 0, b: 0, items: [] as number[] })
  return {
    get a() { return s.a }, get items() { return s.items },
    bump: () => { s.a++; s.a++; s.a++ },
    touchB: () => { s.b++ },
    push: (x: number) => { s.items.push(x) },
  }
})

test('several writes in one tick publish once; a write that leaves a getter unchanged publishes nothing', async () => {
  const { add, wire, call } = page()
  add('m', Many); const spy = add('spy', Spy)
  wire('m', Many.ops.a, 'spy', Spy.ops.take)
  await call('m', Many.ops.bump); await tick()
  expect((spy.value as any).seen).toBe(1)
  expect((spy.value as any).last).toBe(3)
  await call('m', Many.ops.touchB); await tick()
  expect((spy.value as any).seen).toBe(1)
})

test('a deep write publishes, and a listener cannot change state through what it received', async () => {
  const { add, wire, call } = page()
  add('m', Many); const spy = add('spy', Spy)
  wire('m', Many.ops.items, 'spy', Spy.ops.take)
  await call('m', Many.ops.push, 1); await tick()
  expect((spy.value as any).last).toEqual([1]);
  ((spy.value as any).last as number[]).push(99)
  expect((await call('m', Many.ops.items)).value).toEqual([1])
})

const Button = component('demo/button', () => {
  const clicked = event(Type.String())
  return { clicked, press: (who: string) => { clicked(who) } }
})

test('event publishes its argument and is not callable from outside', async () => {
  const { add, wire, call } = page()
  add('b', Button); const spy = add('spy', Spy)
  wire('b', Button.ops.clicked, 'spy', Spy.ops.take)
  await call('b', Button.ops.press, 'ann'); await tick()
  expect((spy.value as any).last).toBe('ann')
  expect('error' in await call('b', Button.ops.clicked, 'bob')).toBe(true)
})

test('nothing is published on creation; state and event outside make throw', async () => {
  const { add, wire } = page()
  const spy = add('spy', Spy)
  wire('c', Counter.ops.count, 'spy', Spy.ops.take)
  add('c', Counter); await tick()
  expect((spy.value as any).seen).toBe(0)
  expect(() => state({ x: 1 })).toThrow()
  expect(() => event()).toThrow()
})

const Fragile = component('demo/fragile', () => {
  const s = state({ xs: [{ n: 1 }], when: new Date(0), tags: new Map([['a', 1]]), x: 0 })
  return {
    get first() { return s.xs[0]!.n },
    get later() { return s.xs.length },
    get writes() { s.x = s.x; return s.x },
    clear: () => { s.xs = [] },
    tag: () => s.tags.get('a'),
    all: () => s.xs,
  }
})

test('a getter that throws during a flush does not stop the other getters', async () => {
  const { add, wire, call } = page()
  add('f', Fragile); const spy = add('spy', Spy)
  wire('f', Fragile.ops.later, 'spy', Spy.ops.take)
  await call('f', Fragile.ops.clear); await tick()
  expect((spy.value as any).last).toBe(0)
})

test('a getter that writes state does not loop forever', async () => {
  const { add, call } = page()
  add('f', Fragile)
  await call('f', Fragile.ops.clear)
  await new Promise(r => setTimeout(r, 5))   // would never fire if flushes re-queued themselves forever
})

test('Map and Date in state are left alone', async () => {
  const { add, call } = page()
  add('f', Fragile)
  expect(await call('f', Fragile.ops.tag)).toEqual({ value: 1 })
})

test('each instance has its own state, even from a shared init', async () => {
  const init = { xs: [] as number[] }
  const Shared = component('demo/shared', () => { const s = state(init); return { get xs() { return s.xs }, push: (x: number) => { s.xs.push(x) } } })
  const { add, call } = page()
  add('a', Shared); add('b', Shared)
  await call('a', Shared.ops.push, 1)
  expect((await call('b', Shared.ops.xs)).value).toEqual([])
})

test('an action returning state returns a copy', async () => {
  const { add, call } = page()
  add('f', Fragile)
  ;((await call('f', Fragile.ops.all)).value as unknown[]).push(99)
  expect((await call('f', Fragile.ops.all)).value).toEqual([{ n: 1 }])
})

test('an id needs a namespace', () => {
  expect(() => component('counter', () => ({}))).toThrow()
})
