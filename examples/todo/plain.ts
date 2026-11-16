/**
 * Plain TypeScript on both sides of nano: a plain object's methods become an interface's handlers, and a nano client
 * becomes a plain object again. Neither side imports nano's result type.
 *
 *   provide(KeyValueStore, handlers(KeyValueStore, inMemory()))
 *   const store = plain<KeyValueStore>(() => app.call('main', 'store'))   // await store.get(['a'])
 */
import type { Static, TSchema } from 'typebox'
import { failure, success, type Fail, type Handlers, type Interface, type NanoResult } from '@pritzlaff/nano-core'

type Call = (input: unknown) => Promise<NanoResult<unknown>>
type Of<D> = NonNullable<D> extends { schema: infer S extends TSchema } ? Static<S> : never
type Ops<I extends Interface> = I['ops']
type In<I extends Interface, K extends keyof Ops<I>> = Of<Ops<I>[K]['input']>
type Out<I extends Interface, K extends keyof Ops<I>> = Of<Ops<I>[K]['output']>

/** The plain object an interface's actions describe. An input that is only `null` is no argument, and an output that
 *  is only `null` is `void` (the adapters supply and drop the `null`). */
export type Plain<I extends Interface> = {
  [K in keyof Ops<I> as Ops<I>[K]['kind'] extends 'event' ? never : K]:
    (...args: [In<I, K>] extends [null] ? [] : [input: In<I, K>]) => Promise<[Out<I, K>] extends [null] ? void : Out<I, K>>
}

/** `true` only when the plain interface `P` and the nano interface `I` have the same actions with the same types:
 *  `true satisfies Matches<TodoList, typeof TodoList>` stops the build when the two drift apart. */
export type Matches<P, I extends Interface> =
  [keyof P] extends [keyof Plain<I>] ? [keyof Plain<I>] extends [keyof P] ? [P] extends [Plain<I>] ? [Plain<I>] extends [P] ? true : false : false : false : false

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
export function plain<T extends object>(client: () => object): T {
  return new Proxy({}, {
    get: (_, name) => typeof name !== 'string' || name === 'then' ? undefined : async (input?: unknown) => {
      const r = await (client() as Record<string, Call>)[name]!(input ?? null)
      if (r.ok) return r.value
      throw Object.assign(new Error(`${r.fail.type}: ${r.fail.reason}`), { fail: r.fail as Fail })
    },
  }) as T
}
