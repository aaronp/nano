import { describe, expect, test } from 'bun:test'
import { Type } from 'typebox'
import { defineSchema } from '../src/schema.ts'
import { op } from '../src/op.ts'
import { iface, portKey } from '../src/iface.ts'
import { success } from '../src/result.ts'
import type { NanoContext } from '../src/context.ts'
import { implementation, provide } from '../src/implementation.ts'
import { provider } from '../src/provider.ts'
import { createRegistry } from '../src/registry.ts'

const Str = defineSchema('Str', Type.String())
const Num = defineSchema('Num', Type.Number())
const db = iface('acme/db', { get: op.action('get', Str, Num), put: op.sink('put', Str), changed: op.source('changed', Str) })
const log = iface('acme/log', { write: op.sink('write', Str) })
const ctx: NanoContext = { instance: 'acme/mem/db#1', runtime: 'r1', config: undefined }

const memDb = implementation('acme/mem/db', {
  provides: [db],
  dependencies: { log },
  make: () => [provide(db, { get: async (_c, s) => success(s.length), put: async () => success(undefined) })],
})
const memLog = implementation('acme/mem/log', { provides: [log], make: () => [provide(log, { write: async () => success(undefined) })] })
const mem = provider('acme/mem', [memDb, memLog], { author: 'acme' })

describe('implementations', () => {
  test('make maps handlers by op coord', async () => {
    const handlers = await memDb.make(ctx)
    expect([...handlers.keys()].sort()).toEqual([portKey('acme/db', db.ops.get.coord), portKey('acme/db', db.ops.put.coord)].sort())
    expect(await handlers.get(portKey('acme/db', db.ops.get.coord))!(ctx, 'abc')).toEqual(success(3))
  })
  test('a missing handler throws `<coord>: missing <iface>/<op>`', async () => {
    const half = implementation('acme/mem/half', {
      provides: [db],
      // @ts-expect-error put is required
      make: () => [provide(db, { get: async () => success(1) })],
    })
    await expect(half.make(ctx)).rejects.toThrow('acme/mem/half: missing acme/db/put')
  })
  test('two interfaces sharing an identical op get distinct handlers, one per port', async () => {
    const audit = iface('acme/audit', { write: op.sink('write', Str) })
    expect(audit.ops.write.coord).toBe(log.ops.write.coord)
    const seen: string[] = []
    const both = implementation('acme/mem/both', {
      provides: [log, audit],
      make: () => [
        provide(log, { write: async (_c, s) => (seen.push(`log ${s}`), success(undefined)) }),
        provide(audit, { write: async (_c, s) => (seen.push(`audit ${s}`), success(undefined)) }),
      ],
    })
    const handlers = await both.make(ctx)
    await handlers.get(portKey('acme/log', log.ops.write.coord))!(ctx, 'a')
    await handlers.get(portKey('acme/audit', audit.ops.write.coord))!(ctx, 'b')
    expect(seen).toEqual(['log a', 'audit b'])
  })
  test("one interface's handler does not satisfy another's", async () => {
    const audit = iface('acme/audit', { write: op.sink('write', Str) })
    const one = implementation('acme/mem/one', { provides: [log, audit], make: () => [provide(log, { write: async () => success(undefined) })] })
    await expect(one.make(ctx)).rejects.toThrow('acme/mem/one: missing acme/audit/write')
  })
  test('a part for an interface not in provides throws', async () => {
    const stray = implementation('acme/mem/stray', { provides: [], make: () => [provide(log, { write: async () => success(undefined) })] })
    await expect(stray.make(ctx)).rejects.toThrow('acme/mem/stray: acme/log is not provided')
  })
  test('a bad implementation coordinate throws', () => {
    for (const c of ['acme', 'acme/', 'acme/mem/', '/db', 'acme//db'])
      expect(() => implementation(c, { provides: [], make: () => [] })).toThrow(`bad implementation coordinate ${c}`)
  })
  test('an interface provided twice throws', async () => {
    const twice = implementation('acme/mem/twice', { provides: [log], make: () => [provide(log, { write: async () => success(undefined) }), provide(log, { write: async () => success(undefined) })] })
    await expect(twice.make(ctx)).rejects.toThrow('acme/mem/twice: acme/log is provided twice')
  })
  test('handlers are typed from the op schemas', () => {
    // @ts-expect-error get returns a number, not a string
    provide(db, { get: async (_c, s: string) => success(s), put: async () => success(undefined) })
    // @ts-expect-error sources have no handler
    provide(db, { get: async () => success(1), put: async () => success(undefined), changed: async () => success('x') })
  })
  test('the provider is everything before the last slash', () => expect(memDb.provider).toBe('acme/mem'))
})

describe('registry', () => {
  test("a provider's implementations, interfaces and ops are found by coord", () => {
    const r = createRegistry()
    expect(r.add(mem)).toEqual(success(undefined))
    expect(r.provider('acme/mem')).toBe(mem)
    expect(r.implementation('acme/mem/db')).toBe(memDb)
    expect(r.interface('acme/log')).toBe(log)
    expect(r.op(db.ops.changed.coord)).toBe(db.ops.changed)
    expect(r.implementation('acme/mem/nope')).toBeUndefined()
  })
  test('implementationsOf an interface', () => {
    const r = createRegistry()
    r.add(mem)
    expect(r.implementationsOf('acme/db')).toEqual([memDb])
    expect(r.implementationsOf('acme/none')).toEqual([])
  })
  test('the manifest is plain, sorted data (`structuredClone` equals it)', () => {
    const r = createRegistry()
    r.add(mem)
    const m = r.manifest()
    expect(structuredClone(m)).toEqual(m)
    expect(m.providers).toEqual([{ coord: 'acme/mem', implementations: ['acme/mem/db', 'acme/mem/log'] }])
    expect(m.implementations.map(i => i.coord)).toEqual(['acme/mem/db', 'acme/mem/log'])
    expect(m.implementations[0]!.dependencies).toEqual({ log: { implements: 'acme/log' } })
    expect(m.interfaces.map(i => i.coord)).toEqual(['acme/db', 'acme/log'])
    expect(m.interfaces[1]!.ops).toEqual([{ name: 'write', kind: 'sink', coord: log.ops.write.coord, input: Str.hash }])
  })
  test('adding a clashing provider fails and adds nothing', () => {
    const r = createRegistry()
    r.add(mem)
    expect(r.add(mem)).toEqual({ ok: false, fail: { type: 'exists', reason: 'provider acme/mem is already registered' } })

    const other = iface('acme/other', { write: op.sink('write', Str) })
    const dup = provider('acme/mem2', [
      implementation('acme/mem2/other', { provides: [other], make: () => [] }),
      implementation('acme/mem2/db', { provides: [iface('acme/db', { get: db.ops.get })], make: () => [] }),
    ])
    expect(r.add(dup)).toEqual({ ok: false, fail: { type: 'exists', reason: 'interface acme/db differs' } })
    expect(r.interface('acme/other')).toBeUndefined()
    expect(r.provider('acme/mem2')).toBeUndefined()
    expect(r.implementation('acme/mem2/other')).toBeUndefined()
  })
  test('an implementation outside its provider\'s namespace throws', () => {
    expect(() => provider('acme/sql', [memDb])).toThrow('acme/mem/db is not under acme/sql')
  })
  test('an implementation listed twice throws', () => {
    expect(() => provider('acme/mem', [memDb, memDb])).toThrow('acme/mem/db is listed twice')
  })
})
