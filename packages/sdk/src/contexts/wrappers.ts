import { notAllowed, ok, type CallFn, type Called, type EmitFn, type Emitted, type OnFn, type Result, type Subscribed } from '../types'

type EmitWrap = (e: Emitted, next: EmitFn) => Promise<Result<void>>
type CallWrap = (c: Called, next: CallFn) => Promise<Result<unknown>>
type OnWrap = (s: Subscribed, next: OnFn) => () => void
// A throwing predicate counts as false; a throwing sink is ignored.
const test = <T>(p: (x: T) => boolean, x: T) => { try { return p(x) } catch { return false } }
const quietly = (f: () => void) => { try { f() } catch {} }

/** Wrappers for `ctx.withEmit(...)`. */
export const Emits = {
  map: (f: (e: Emitted) => Emitted): EmitWrap => (e, next) => next(f(e)),
  filter: (p: (e: Emitted) => boolean): EmitWrap => (e, next) => test(p, e) ? next(e) : Promise.resolve(notAllowed('filtered')),
  trace: (sink: (e: Emitted, r: Result<void>) => void): EmitWrap => async (e, next) => {
    const r = await next(e); quietly(() => sink(e, r)); return r
  },
  /** Only the last emit of each event within `ms` goes out; callers get success immediately. */
  debounce: (ms: number): EmitWrap => {
    // ponytail: pending timers are not cleared on dispose; add teardown if contexts get a dispose hook.
    const timers = new Map<string, ReturnType<typeof setTimeout>>()
    return async (e, next) => {
      clearTimeout(timers.get(e.event.name))
      timers.set(e.event.name, setTimeout(() => { timers.delete(e.event.name); void next(e) }, ms))
      return ok(undefined)
    }
  },
}

/** Wrappers for `ctx.withCall(...)`. */
export const Calls = {
  map: (f: (c: Called) => Called): CallWrap => (c, next) => next(f(c)),
  filter: (p: (c: Called) => boolean): CallWrap => (c, next) => test(p, c) ? next(c) : Promise.resolve(notAllowed('filtered')),
  trace: (sink: (c: Called, r: Result<unknown>) => void): CallWrap => async (c, next) => {
    const r = await next(c); quietly(() => sink(c, r)); return r
  },
}

/** Wrappers for `ctx.withOn(...)`: decide what a component may listen to. */
export const Subscriptions = {
  filter: (p: (s: Subscribed) => boolean): OnWrap => (s, next) => test(p, s) ? next(s) : () => {},
}
