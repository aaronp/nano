/**
 * Plain TypeScript on both sides of nano (not exported from the package): a plain object's methods become an
 * interface's handlers, and a client becomes a plain object again (`Interface.Type`).
 *
 *   provide(KV, handlers(KV, inMemory()))                 // a value is success (nothing is null), a throw is threw
 *   const store = plain<KV>(KV, () => ctx.one(KV))        // await store.get('a'): a Fail throws an Error carrying it
 */
import type { Handlers } from './implementation.ts'
import type { Interface } from './iface.ts'
import type { Op } from './op.ts'
import { failure, success, type Fail, type NanoResult } from './result.ts'

type Call = (input: unknown) => Promise<NanoResult<unknown>>

/** Each action of `i` calls the method of the same name: its value is `success` (nothing is `null`), a throw is `threw`. */
export function handlers<I extends Interface>(i: I, obj: object): Handlers<I> {
  const methods = obj as Record<string, (input: unknown) => unknown>
  const out: Record<string, Call> = {}
  for (const o of Object.values(i.ops)) {
    if (o.kind !== 'action' || typeof methods[o.name] !== 'function') continue
    out[o.name] = async input => {
      try { return success((await methods[o.name]!.call(obj, input)) ?? null) }
      catch (e) {   // a Fail thrown by a plain caller below (err.fail) passes through as it is
        const fail = (e as { fail?: Fail } | null)?.fail
        return fail ? { ok: false, fail } : failure('threw', e instanceof Error ? e.message : String(e))
      }
    }
  }
  return out as Handlers<I>
}

/** What `plain` reads at each use: the client's calls, and its emissions of an op (`on`, or the host's `subscribe`). */
type Source = { call: object; on(op: Op): AsyncIterable<{ output: unknown }> }

/** An `Error` carrying `fail` (`err.fail`): how nano throws a `Fail` wherever it throws one. */
export const thrown = (fail: Fail) => Object.assign(new Error(`${fail.type}: ${fail.reason}`), { fail })

/** A plain object over a client, resolved on every call (so a rewired edge is followed): a `Fail` throws an Error carrying
 *  it. An event of `i` is a method giving the `output`s emitted from the call on (it connects at the call; see iterate.ts). */
export function plain<T>(i: Interface | undefined, client: () => NanoResult<Source>): T {
  return new Proxy({}, {
    get: (_, name) => {
      if (typeof name !== 'string' || name === 'then') return undefined
      const ev = i?.ops[name]?.kind === 'event' ? i.ops[name] : undefined
      if (ev) return () => {   // connected now, at the call: see iterate.ts
        const c = client()
        if (!c.ok) throw thrown(c.fail)
        const emissions = c.value.on(ev)
        return { async *[Symbol.asyncIterator]() { for await (const e of emissions) yield e.output } }
      }
      return async (input?: unknown) => {
        const c = client()
        if (!c.ok) throw thrown(c.fail)
        const r = await (c.value.call as Record<string, Call>)[name]!(input ?? null)
        if (r.ok) return r.value
        throw thrown(r.fail)
      }
    },
  }) as T
}
