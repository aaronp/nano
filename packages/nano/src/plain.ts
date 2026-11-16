/**
 * Plain TypeScript on both sides of nano (not exported from the package): a plain object's methods become an
 * interface's handlers, and a client becomes a plain object again (`Interface.Type`).
 *
 *   provide(KV, handlers(KV, inMemory()))                 // a value is success (nothing is null), a throw is threw
 *   const store = plain<KV>(() => ctx.one(KV))            // await store.get('a'): a Fail throws an Error carrying it
 */
import type { Handlers } from './implementation.ts'
import type { Interface } from './iface.ts'
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
      catch (e) { return failure('threw', e instanceof Error ? e.message : String(e)) }
    }
  }
  return out as Handlers<I>
}

/** A plain object over a client, resolved on every call (so a rewired edge is followed): a `Fail` throws an Error carrying it. */
export function plain<T>(client: () => NanoResult<{ call: object }>): T {
  const thrown = (fail: Fail) => Object.assign(new Error(`${fail.type}: ${fail.reason}`), { fail })
  return new Proxy({}, {
    get: (_, name) => typeof name !== 'string' || name === 'then' ? undefined : async (input?: unknown) => {
      const c = client()
      if (!c.ok) throw thrown(c.fail)
      const r = await (c.value.call as Record<string, Call>)[name]!(input ?? null)
      if (r.ok) return r.value
      throw thrown(r.fail)
    },
  }) as T
}
