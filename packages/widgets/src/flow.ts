import Type from 'typebox'
import { Components, type Event } from '@composable/sdk'

// ---- slider: a source (and a sink: set-value moves it) ----
const S = Components.declare({ author: 'composable', id: 'slider' }, '0.1.0')
export const valueChanged = S.event('value-changed', 'The slider moved to a new value', Type.Number({ minimum: 0, maximum: 100 }))
export const setValue = S.action('set-value', 'Move the slider', Type.Number({ minimum: 0, maximum: 100 }))
export const slider = S.define({
  state: () => ({ value: 50 }),
  actions: [[setValue, (v, { state, ctx }) => { state.value = v; return ctx.emit(valueChanged, v) }]],
})

// ---- mapper: listens for an event (from anyone), emits fn(value) ----
const M = Components.declare({ author: 'composable', id: 'mapper' }, '0.1.0')
export const mapped = M.event('mapped', 'The input after the mapping function', Type.Number())
export const mapper = (opts: { label: string; from: Event; fn: (x: number) => number }) => M.define({
  state: () => ({ label: opts.label, input: undefined as number | undefined, output: undefined as number | undefined }),
  setup: ({ state, ctx, changed }) => ctx.on(opts.from, (x, d) => {
    state.input = x as number; state.output = opts.fn(state.input); changed()
    void d.ctx.emit(mapped, state.output)
  }),
})

// ---- counter: every N events, emits its own ----
const C = Components.declare({ author: 'composable', id: 'counter' }, '0.1.0')
export const reached = C.event('reached', 'The count reached a multiple of N', Type.Integer())
export const counter = (opts: { every: number; from: Event }) => C.define({
  state: () => ({ n: 0, every: opts.every }),
  setup: ({ state, ctx, changed }) => ctx.on(opts.from, (_x, d) => {
    if (++state.n % state.every === 0) void d.ctx.emit(reached, state.n)
    changed()
  }),
})

// ---- chart: a sink, fed by a route into its declared action ----
const Ch = Components.declare({ author: 'composable', id: 'chart' }, '0.1.0')
export const push = Ch.action('push', 'Add a point to the chart', Type.Number())
export const chart = Ch.define({
  state: () => ({ points: [] as number[] }),
  actions: [[push, (v, { state }) => { state.points = [...state.points, v].slice(-60) }]],
})

// ---- log: watches the environment and listens to every event any instance declares ----
export type LogRow = { at: string; from: string; event: string; payload: unknown; origin: string; depth: number }
const L = Components.declare({ author: 'composable', id: 'log' }, '0.1.0')
export const log = L.define({
  state: () => ({ rows: [] as LogRow[] }),
  setup: ({ state, ctx, changed }) => {
    const offs = new Map<string, () => void>()
    const unwatch = ctx.watch(list => {
      for (const e of list.flatMap(i => i.manifest.emits)) {
        if (offs.has(e.name)) continue
        offs.set(e.name, ctx.on(e as Event, (payload, d) => {
          state.rows = [{
            at: new Date().toLocaleTimeString(), from: d.from, event: e.name.split('/').pop()!, payload,
            origin: d.stack[0].from, depth: d.stack.length,
          }, ...state.rows].slice(0, 30)
          changed()
        }))
      }
    })
    return () => { unwatch(); offs.forEach(off => off()) }
  },
})
