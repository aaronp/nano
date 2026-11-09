// Map and Filter: a function body over `x`, typed in by the user. Not for untrusted input: it runs as code.
import { component, event, state } from '@composable/runes'

const run = (code: string, x: unknown): unknown => new Function('x', code)(x)   // compile errors throw here too

/** Runs its code on each value and publishes the result as `mapped`. */
export const Map = component('composable.bundle/map', () => {
  const s = state({ code: 'return x' })
  const mapped = event()
  return {
    get code() { return s.code }, mapped,
    setCode: (c: string) => { s.code = c },
    map: (x: unknown) => { const y = run(s.code, x); mapped(y); return y },
  }
})

/** Publishes `x` as `passed` when its code returns truthy for it. */
export const Filter = component('composable.bundle/filter', () => {
  const s = state({ code: 'return true' })
  const passed = event()
  return {
    get code() { return s.code }, passed,
    setCode: (c: string) => { s.code = c },
    filter: (x: unknown) => { const ok = !!run(s.code, x); if (ok) passed(x); return ok },
  }
})
