// Map and Filter: a function body over `x`, typed in by the user. Not for untrusted input: it runs as code.
import { Type } from 'typebox'
import { component, event, state } from '@pritzlaff/nano-runes'

const value = (description: string) => Type.Unknown({ description, examples: [42, 'hello'] })
const code = (example: string) => Type.String({ description: 'A function body over x', examples: [example] })
const config = (example: string) => Type.Object({ code: code(example) }, { description: 'The settings: the code', examples: [{ code: example }] })
const run = (code: string, x: unknown): unknown => new Function('x', code)(x)   // compile errors throw here too

/** Runs its code on each value and publishes the result as `mapped`. */
export const Map = component('composable.bundle/map', () => {
  const s = state({ code: 'return x' })
  const mapped = event()
  return {
    get code() { return s.code }, mapped,
    get config() { return { code: s.code } },
    configure: (c: { code: string }) => { s.code = c.code },
    setCode: (c: string) => { s.code = c },
    map: (x: unknown) => { const y = run(s.code, x); mapped(y); return y },
  }
}, {
  code: code('return x * 2'), mapped: value('Each result, as it is made'),
  config: config('return x * 2'),
  configure: { in: config('return x * 2'), description: 'Replaces the settings (the code)' },
  setCode: { in: code('return x * 2'), description: 'Changes the code' },
  map: { in: value('The value, as x'), out: value('The result'), description: 'Runs the code on a value, publishes the result as mapped, and returns it' },
}, { description: 'Runs its code on each value and publishes the result' })

/** Publishes `x` as `passed` when its code returns truthy for it. */
export const Filter = component('composable.bundle/filter', () => {
  const s = state({ code: 'return true' })
  const passed = event()
  return {
    get code() { return s.code }, passed,
    get config() { return { code: s.code } },
    configure: (c: { code: string }) => { s.code = c.code },
    setCode: (c: string) => { s.code = c },
    filter: (x: unknown) => { const ok = !!run(s.code, x); if (ok) passed(x); return ok },
  }
}, {
  code: code('return x > 0'), passed: value('Each value the code passed'),
  config: config('return x > 0'),
  configure: { in: config('return x > 0'), description: 'Replaces the settings (the code)' },
  setCode: { in: code('return x > 0'), description: 'Changes the code' },
  filter: { in: value('The value, as x'), out: Type.Boolean({ description: 'Whether it passed' }), description: 'Publishes the value as passed when the code returns truthy for it' },
}, { description: 'Passes on the values its code returns truthy for' })
