# @composable/sdk

A small runtime for front-end components that are written, tested and released on their own, then wired
together on a page. A component declares its operations; a scope runs instances and connects them.

## 1. Declare operations

```ts
import Type from 'typebox'
import { Components, ok } from '@composable/sdk'

const C = Components.declare({ author: 'acme', id: 'chart' })
export const push    = C.op('push', 'Add a point', { input: Type.Number() })                       // subscription
export const hovered = C.op('hovered', 'Point under the cursor', { output: Type.Number() })        // publication
export const stats   = C.op('stats', 'Summary', { input: Type.Null(), output: Type.Object({ n: Type.Number() }) }) // action
```

Input and output: an **action** (call it, get a result). Output only: a **publication**. Input only: a
**subscription** (fed by a call, or by wiring a publication into it). Names become `acme/chart/push`.

## 2. Define the component

```ts
export const chart = C.define({
  state: () => ({ points: [] as number[] }),
  handlers: [
    [push, (n, { state }) => { state.points.push(n) }],
    [stats, (_, { state }) => ok({ n: state.points.length })],
  ],
  setup: ({ state, mountContext, appContext, changed }) => {
    // mountContext: react to being mounted. appContext: keep it (timers, UI); each use is a new trigger.
    return () => { /* cleanup on dispose */ }
  },
})
```

Every op with an input needs a handler; handlers return a `Result` (`ok(...)`, `fail(...)`) or nothing.
Plain functions can be lifted instead: `Components.lift(id, { echo: Type.Function([In], Out) }, { echo: ... })`.

## 3. Run and wire instances

```ts
import { Scopes } from '@composable/sdk'

const scope = Scopes.create({ onError: console.error })
const page = scope.context('page')
await scope.add('slider', slider)
await scope.add('chart', chart)
scope.route('slider', valueChanged, 'chart', push)   // publication → subscription
await page.call('chart', stats, null)                // → { type: 'success', data: { n: … } }
```

Inside a component, its context gives `publish`, `subscribe(op, fn, { from })`, `call`, `instances()` and
`watch(fn)`. A handler's `ctx` carries the **correlation** of whatever triggered it, so everything done in
response is traceable and loops are caught; components never handle correlation themselves.

## 4. Compose

```ts
const panel = Components.compose({ id: { author: 'acme', id: 'panel' } }, c => {
  const input = c.use('input', textEmit)
  const table = c.use('table', eventsTable, ctx => ctx.withPublish(Publications.debounce(200)))
  c.route(input(submitted), table(onEvent))
  c.expose(setInput, submitted)
  return { input, table }
})
```

A composite is just another instance: its children live in its own scope, and only exposed ops are visible.
A policy is a composite too: a narrower manifest plus filtered contexts (`withPublish`, `withCall`, `withSubscribe`).

## 5. Observe and control

```ts
scope.observe(t => console.log(t.kind, t.from, t.to, t.op, t.correlation))
scope.mute('chart')                              // refuse its operations and deliveries
Scopes.create({ budget: 1000, burst: 100_000 })  // loop limits: per correlation, per burst
```

## Building

`bun run build` writes `dist/` (ESM + `.d.ts` + a publishable `package.json`); publish from there.
Component packages built with `--bundle` also get `dist/bundle/`, a self-contained copy for loading by URL.
