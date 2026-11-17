import { describe, expect, test } from 'bun:test'
import { Type } from 'typebox'
import { Schema } from '../src/schema.ts'
import { Op } from '../src/op.ts'
import { Interface, port } from '../src/iface.ts'
import { success } from '../src/result.ts'
import type { NanoContext } from '../src/context.ts'
import { Implementation, provide } from '../src/implementation.ts'
import { Provider } from '../src/provider.ts'
import { Registry } from '../src/registry.ts'

const Str = Schema.define(Type.String(), 'Str')
const Nothing = Schema.define(Type.Null(), 'Nothing')
const Num = Schema.define(Type.Number(), 'Num')
const db = Interface.define('acme/db', { get: Op.action(Str, Num), put: Op.action(Str, Nothing), changed: Op.event(Str) })
const log = Interface.define('acme/log', { write: Op.action(Str, Nothing) })
const ctx = { self: 'db', runtimes: [] } as unknown as NanoContext // makes here never call out

const memDb = Implementation.define('acme/mem/db', {
  provides: [db],
  dependencies: { log },
  make: () => [provide(db, { get: async s => success(s.length), put: async () => success(null) })],
})
const memLog = Implementation.define('acme/mem/log', { provides: [log], make: () => [provide(log, { write: async () => success(null) })] })
const mem = Provider.define('acme/mem', [memDb, memLog], { author: 'acme' })

describe('implementations', () => {
  test('make keys handlers by port: interface coord and op name', async () => {
    const { handlers } = await memDb.make(ctx, undefined)
    expect([...handlers.keys()].sort()).toEqual(['acme/db/get', 'acme/db/put'].sort())
    expect(await handlers.get(port(db, db.ops.get))!('abc')).toEqual(success(3))
  })
  test('a missing handler throws `<coord>: missing <iface>/<op>`', async () => {
    const half = Implementation.define('acme/mem/half', {
      provides: [db],
      // @ts-expect-error put is required
      make: () => [provide(db, { get: async () => success(1) })],
    })
    await expect(half.make(ctx, undefined)).rejects.toThrow('acme/mem/half: missing acme/db/put')
  })
  test('two interfaces sharing an identical op get distinct handlers, one per port', async () => {
    const audit = Interface.define('acme/audit', { write: Op.action(Str, Nothing) })
    expect(audit.ops.write.coord).toBe(log.ops.write.coord)
    const seen: string[] = []
    const both = Implementation.define('acme/mem/both', {
      provides: [log, audit],
      make: () => [
        provide(log, { write: async s => (seen.push(`log ${s}`), success(null)) }),
        provide(audit, { write: async s => (seen.push(`audit ${s}`), success(null)) }),
      ],
    })
    const { handlers } = await both.make(ctx, undefined)
    await handlers.get(port(log, log.ops.write))!('a')
    await handlers.get(port(audit, audit.ops.write))!('b')
    expect(seen).toEqual(['log a', 'audit b'])
  })
  test("one interface's handler does not satisfy another's", async () => {
    const audit = Interface.define('acme/audit', { write: Op.action(Str, Nothing) })
    const one = Implementation.define('acme/mem/one', { provides: [log, audit], make: () => [provide(log, { write: async () => success(null) })] })
    await expect(one.make(ctx, undefined)).rejects.toThrow('acme/mem/one: missing acme/audit/write')
  })
  test('a part for an interface not in provides throws', async () => {
    const stray = Implementation.define('acme/mem/stray', { provides: [], make: () => [provide(log, { write: async () => success(null) })] })
    await expect(stray.make(ctx, undefined)).rejects.toThrow('acme/mem/stray: acme/log is not provided')
  })
  test('a bad implementation coordinate throws', () => {
    for (const c of ['acme', 'acme/', 'acme/mem/', '/db', 'acme//db'])
      expect(() => Implementation.define(c, { provides: [], make: () => [] })).toThrow(`bad implementation coordinate ${c}`)
  })
  test('an interface provided twice throws', async () => {
    const twice = Implementation.define('acme/mem/twice', { provides: [log], make: () => [provide(log, { write: async () => success(null) }), provide(log, { write: async () => success(null) })] })
    await expect(twice.make(ctx, undefined)).rejects.toThrow('acme/mem/twice: acme/log is provided twice')
  })
  test('handlers are typed from the op schemas', () => {
    // @ts-expect-error get returns a number, not a string
    provide(db, { get: async (s: string) => success(s), put: async () => success(null) })
    // @ts-expect-error events have no handler
    provide(db, { get: async () => success(1), put: async () => success(null), changed: async () => success('x') })
  })
  test('the provider is everything before the last slash', () => expect(memDb.provider).toBe('acme/mem'))
})

describe('registry', () => {
  test("a provider's implementations, interfaces and ops are found by coord", () => {
    const r = Registry.create()
    expect(r.add(mem)).toEqual(success(undefined))
    expect(r.provider('acme/mem')).toBe(mem)
    expect(r.implementation('acme/mem/db')).toBe(memDb)
    expect(r.interface('acme/log')).toBe(log)
    expect(r.op(db.ops.changed.coord)).toBe(db.ops.changed)
    expect(r.implementation('acme/mem/nope')).toBeUndefined()
  })
  test('implementationsOf an interface', () => {
    const r = Registry.create()
    r.add(mem)
    expect(r.implementationsOf('acme/db')).toEqual([memDb])
    expect(r.implementationsOf('acme/none')).toEqual([])
  })
  test('the manifest is plain, sorted data (`structuredClone` equals it)', () => {
    const r = Registry.create()
    r.add(mem)
    const m = r.manifest()
    expect(structuredClone(m)).toEqual(m)
    expect(m.providers).toEqual([{ coord: 'acme/mem', implementations: ['acme/mem/db', 'acme/mem/log'] }])
    expect(m.implementations.map(i => i.coord)).toEqual(['acme/mem/db', 'acme/mem/log'])
    expect(m.implementations[0]!.dependencies).toEqual({ log: { implements: 'acme/log' } })
    expect(m.interfaces.map(i => i.coord)).toEqual(['acme/db', 'acme/log'])
    expect(m.interfaces[1]!.ops).toEqual([{ name: 'write', kind: 'action', coord: log.ops.write.coord, input: Str.hash, output: Nothing.hash }])
  })
  test('adding a clashing provider fails and adds nothing', () => {
    const r = Registry.create()
    r.add(mem)
    expect(r.add(mem)).toEqual({ ok: false, fail: { type: 'invalid-input', reason: 'provider acme/mem is already registered' } })

    const other = Interface.define('acme/other', { write: Op.action(Str, Nothing) })
    const dup = Provider.define('acme/mem2', [
      Implementation.define('acme/mem2/other', { provides: [other], make: () => [] }),
      Implementation.define('acme/mem2/db', { provides: [Interface.define('acme/db', { get: db.ops.get })], make: () => [] }),
    ])
    expect(r.add(dup)).toEqual({ ok: false, fail: { type: 'invalid-input', reason: 'interface acme/db differs' } })
    expect(r.interface('acme/other')).toBeUndefined()
    expect(r.provider('acme/mem2')).toBeUndefined()
    expect(r.implementation('acme/mem2/other')).toBeUndefined()
  })
  test('an implementation outside its provider\'s namespace throws', () => {
    expect(() => Provider.define('acme/sql', [memDb])).toThrow('acme/mem/db is not under acme/sql')
  })
  test('an implementation listed twice throws', () => {
    expect(() => Provider.define('acme/mem', [memDb, memDb])).toThrow('acme/mem/db is listed twice')
  })
})
