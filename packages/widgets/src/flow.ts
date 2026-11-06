import Type from 'typebox'
import { Components, roleOf, type Op } from '@composable/sdk'

// ---- slider: publishes its value; set-value moves it ----
const S = Components.declare({ author: 'composable', id: 'slider' })
export const valueChanged = S.op('value-changed', 'The slider moved to a new value', { output: Type.Number({ minimum: 0, maximum: 100 }) })
export const setValue = S.op('set-value', 'Move the slider', { input: Type.Number({ minimum: 0, maximum: 100 }) })
export const slider = S.define({
  state: () => ({ value: 50 }),
  handlers: [[setValue, (v, { state, ctx }) => { state.value = v; return ctx.publish(valueChanged, v) }]],
})

// ---- mapper: consumes a number, publishes fn(number) ----
const M = Components.declare({ author: 'composable', id: 'mapper' })
export const mapIn = M.op('in', 'A number to map', { input: Type.Number() })
export const mapped = M.op('mapped', 'The input after the mapping function', { output: Type.Number() })
export const mapper = (opts: { label: string; fn: (x: number) => number }) => M.define({
  state: () => ({ label: opts.label, input: undefined as number | undefined, output: undefined as number | undefined }),
  handlers: [[mapIn, (x, { state, ctx }) => { state.input = x; state.output = opts.fn(x); return ctx.publish(mapped, state.output) }]],
})

// ---- counter: counts what it consumes; every N, publishes ----
const C = Components.declare({ author: 'composable', id: 'counter' })
export const count = C.op('count', 'Anything to count', { input: Type.Unknown() })
export const reached = C.op('reached', 'The count reached a multiple of N', { output: Type.Integer() })
export const counter = (opts: { every: number }) => C.define({
  state: () => ({ n: 0, every: opts.every }),
  handlers: [[count, (_x, { state, ctx }) => { if (++state.n % state.every === 0) return ctx.publish(reached, state.n) }]],
})

// ---- chart: consumes points ----
const Ch = Components.declare({ author: 'composable', id: 'chart' })
export const push = Ch.op('push', 'Add a point to the chart', { input: Type.Number() })
export const chart = Ch.define({
  state: () => ({ points: [] as number[] }),
  handlers: [[push, (v, { state }) => { state.points = [...state.points, v].slice(-60) }]],
})

// ---- log: an observer; watches the instances and subscribes to every publication they declare ----
export type LogRow = { at: string; from: string; op: string; payload: unknown; origin: string; depth: number }
const L = Components.declare({ author: 'composable', id: 'log' })
export const log = L.define({
  state: () => ({ rows: [] as LogRow[] }),
  setup: ({ state, ctx, changed }) => {
    const offs = new Map<string, () => void>()
    const unwatch = ctx.watch(list => {
      for (const op of list.flatMap(i => i.manifest.ops).filter(o => roleOf(o) === 'publication')) {
        if (offs.has(op.name)) continue
        offs.set(op.name, ctx.subscribe(undefined, op as Op, (payload, d) => {
          state.rows = [{
            at: new Date().toLocaleTimeString(), from: d.from, op: op.name.split('/').pop()!, payload,
            origin: d.stack[0].from, depth: d.stack.length,
          }, ...state.rows].slice(0, 30)
          changed()
        }))
      }
    })
    return () => { unwatch(); offs.forEach(off => off()) }
  },
})
