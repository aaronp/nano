import { expect, test } from 'bun:test'
import { catalog, Debounce, Filter, Input, Log, Map as MapC, Range } from '../src'
import { page, tick } from './fixtures'

test('input: set the kind and value; submit publishes the value', async () => {
  const { add, call, value, spy } = page(); add('in', Input)
  const got = spy('in', Input.ops.submitted)
  expect(await value('in', Input.ops.kind)).toBe('text')
  await call('in', Input.ops.setKind, 'number')
  expect('error' in await call('in', Input.ops.setKind, 'colour')).toBe(true)
  await call('in', Input.ops.setValue, 42)
  await call('in', Input.ops.submit); await tick()
  expect(got).toEqual([42])
})

test('range: set clamps to the bounds, and the value is published', async () => {
  const { add, call, value, spy } = page(); add('r', Range)
  const got = spy('r', Range.ops.value)
  await call('r', Range.ops.setBounds, { min: 0, max: 10, step: 1 })
  await call('r', Range.ops.set, 7); await tick()
  await call('r', Range.ops.set, 99); await tick()
  expect(got).toEqual([10, 7, 10])   // the new bounds clamp the default 50 too
  expect(await value('r', Range.ops.max)).toBe(10)
})

test('log: debug, info and warn add entries; clear empties it', async () => {
  const { add, call, value } = page(); add('log', Log)
  await call('log', Log.ops.debug, 1); await call('log', Log.ops.info, 'two'); await call('log', Log.ops.warn, { three: 3 })
  const entries = await value('log', Log.ops.entries)
  expect(entries.map((e: any) => [e.level, e.value])).toEqual([['debug', 1], ['info', 'two'], ['warn', { three: 3 }]])
  expect(typeof entries[0].time).toBe('number')
  await call('log', Log.ops.clear)
  expect(await value('log', Log.ops.entries)).toEqual([])
})

test('debounce: values within the quiet period come out as one batch', async () => {
  const { add, call, value, spy } = page(); add('d', Debounce)
  const got = spy('d', Debounce.ops.flushed)
  await call('d', Debounce.ops.setQuiet, 20); await call('d', Debounce.ops.setMaxWait, 1000)
  for (const v of [1, 2, 3]) await call('d', Debounce.ops.enqueue, v)
  expect(await value('d', Debounce.ops.pending)).toBe(3)
  await tick(40)
  expect(got).toEqual([[1, 2, 3]])
  expect(await value('d', Debounce.ops.pending)).toBe(0)
})

test('debounce: max wait flushes even while values keep arriving', async () => {
  const { add, call, spy } = page(); add('d', Debounce)
  const got = spy('d', Debounce.ops.flushed)
  await call('d', Debounce.ops.setQuiet, 30); await call('d', Debounce.ops.setMaxWait, 60)
  for (let i = 0; i < 10; i++) { await call('d', Debounce.ops.enqueue, i); await tick(15) }
  expect(got.length).toBeGreaterThanOrEqual(1)
  expect((got[0] as number[])[0]).toBe(0)
})

test('map runs its code and publishes the result; bad code is an error and publishes nothing', async () => {
  const { add, call, spy } = page(); add('m', MapC)
  const got = spy('m', MapC.ops.mapped)
  await call('m', MapC.ops.setCode, 'return x * 2')
  expect(await call('m', MapC.ops.map, 21)).toEqual({ value: 42 })
  await call('m', MapC.ops.setCode, 'throw new Error("nope")')
  expect(await call('m', MapC.ops.map, 1)).toEqual({ error: 'nope' })
  await call('m', MapC.ops.setCode, 'return (')
  expect('error' in await call('m', MapC.ops.map, 1)).toBe(true)
  await tick()
  expect(got).toEqual([42])
})

test('filter publishes only values its code passes', async () => {
  const { add, call, spy } = page(); add('f', Filter)
  const got = spy('f', Filter.ops.passed)
  await call('f', Filter.ops.setCode, 'return x > 10')
  for (const v of [5, 15, 20]) await call('f', Filter.ops.filter, v)
  await tick()
  expect(got).toEqual([15, 20])
})

test('the catalog names every component, with a title and the element that shows it', () => {
  expect(Object.keys(catalog).sort()).toEqual(['debounce', 'filter', 'input', 'log', 'map', 'range'])
  expect(catalog.range).toEqual({ component: Range, title: 'Range', tag: 'c-range' })
  for (const e of Object.values(catalog)) expect(e.tag).toStartWith('c-')
})
