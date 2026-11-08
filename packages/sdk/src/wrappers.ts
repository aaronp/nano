import { notAllowed, ok, type CallFn, type Called, type NotifyFn, type Notified, type Result, type SubscribeFn, type Subscribed } from './types'

type NotifyWrap = (n: Notified, next: NotifyFn) => Promise<Result<void>>
type CallWrap = (c: Called, next: CallFn) => Promise<Result<unknown>>
type SubscribeWrap = (s: Subscribed, next: SubscribeFn) => () => void
// A throwing predicate counts as false; a throwing sink is ignored.
const test = <T>(p: (x: T) => boolean, x: T) => { try { return p(x) } catch { return false } }
const quietly = (f: () => void) => { try { f() } catch {} }

/** Wrappers for `ctx.withNotify(...)`. */
export const Notifications = {
  map: (f: (e: Notified) => Notified): NotifyWrap => (e, next) => next(f(e)),
  filter: (p: (e: Notified) => boolean): NotifyWrap => (e, next) => test(p, e) ? next(e) : Promise.resolve(notAllowed('filtered')),
  trace: (sink: (e: Notified, r: Result<void>) => void): NotifyWrap => async (e, next) => {
    const r = await next(e); quietly(() => sink(e, r)); return r
  },
  /** Only the last notification of each op within `ms` goes out; callers get success immediately. */
  debounce: (ms: number): NotifyWrap => {
    // ponytail: pending timers are not cleared on dispose; add teardown if contexts get a dispose hook.
    const timers = new Map<string, ReturnType<typeof setTimeout>>()
    return async (e, next) => {
      clearTimeout(timers.get(e.op.name))
      timers.set(e.op.name, setTimeout(() => { timers.delete(e.op.name); void next(e) }, ms))
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

/** Wrappers for `ctx.withSubscribe(...)`: decide what a component may listen to. */
export const Subscriptions = {
  filter: (p: (s: Subscribed) => boolean): SubscribeWrap => (s, next) => test(p, s) ? next(s) : () => {},
}
