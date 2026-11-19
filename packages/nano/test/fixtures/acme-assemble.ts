/** Shared fixtures of the assemble tests: Acme implementations, a registry and builders for pods, runtimes and pipes. */
import { expect } from 'bun:test'
import { Type } from 'typebox'
import { Schema } from '../../src/schema.ts'
import { Op } from '../../src/op.ts'
import { Interface } from '../../src/iface.ts'
import { success, type NanoResult } from '../../src/result.ts'
import { Implementation, provide } from '../../src/implementation.ts'
import { Provider } from '../../src/provider.ts'
import { Registry } from '../../src/registry.ts'
import { Pods } from '../../src/pods.ts'
import { Runtime } from '../../src/runtime.ts'

export const Str = Schema.define(Type.String(), 'Str')
export const Num = Schema.define(Type.Integer(), 'Num')
export const Nothing = Schema.define(Type.Null(), 'Nothing')
export const Counter = Interface.define('acme.Counter', { inc: Op.action(Nothing, Num) })
export const KV = Interface.define('acme.KV', { put: Op.action(Str, Nothing) })
export const Ticks = Interface.define('acme.Ticks', { tick: Op.event(Num), said: Op.event(Str) })
export const Log = Interface.define('acme.Log', { record: Op.action(Num, Nothing) })

export const counter = Implementation.define('acme/counter', { provides: [Counter], make: () => [provide(Counter, { inc: async () => success(1) })] })
export const kv = Implementation.define('acme/kv', { provides: [KV], make: () => [provide(KV, { put: async () => success(null) })] })
export const sender = Implementation.define('acme/sender', { provides: [], dependencies: { store: KV }, make: () => [] })
export const ticker = Implementation.define('acme/ticker', { provides: [Ticks], make: () => [] })
export const log = Implementation.define('acme/log', { provides: [Log], make: () => [provide(Log, { record: async () => success(null) })] })
export const sized = Implementation.define('acme/sized', { provides: [], config: Num, make: () => [] })
export const registry = Registry.create()
registry.add(Provider.define('acme', [counter, kv, sender, ticker, log, sized]))

export const ok = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
export const fails = (r: NanoResult<unknown>, type: string, offender: string) => {
  expect(r).toMatchObject({ ok: false, fail: { type } })
  if (!r.ok) expect(r.fail.reason).toContain(offender)
}
export const pods = (d: unknown) => Pods.create(d, { registry })
/** Runtime `r` placing every pod of `d`, wired by `subscriptions`. */
export const runtime = (d: Record<string, unknown>, subscriptions: unknown[] = []) =>
  Runtime.create('r', { pods: Object.keys(d), subscriptions }, ok(pods(d)))
export const pipe = (from: string, source: string, to: string, target: string) => ({ kind: 'pipe', from, source, to, target })
export const ev = (source: string, target: string) => pipe('t', source, 'l', target)
