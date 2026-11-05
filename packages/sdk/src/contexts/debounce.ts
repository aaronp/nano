import { ok, type Context } from '../types'

// ponytail: pending timers are not cleared on dispose; add a dispose hook if contexts need teardown.
export function debounce(inner: Context, ms: number): Context {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  return {
    ...inner,
    capabilities: () => inner.capabilities(),
    emit(event, payload, scope) {
      clearTimeout(timers.get(event.name))
      timers.set(event.name, setTimeout(() => { timers.delete(event.name); void inner.emit(event, payload, scope).catch(() => {}) }, ms))
      return Promise.resolve(ok(undefined))
    },
    call: (t, a, i, s) => inner.call(t, a, i, s),
  }
}
