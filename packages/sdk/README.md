# @composable/sdk

A small runtime for components that are written, tested and released on their own, then registered in Systems and
connected. A component declares its operations; a System holds instances and carries calls and notifications
between them. There is no global System: sandboxes, bridges and Systems of Systems are just more Systems.

## 1. Declare operations (coordinates)

```ts
import Type from 'typebox'
import { Components, ok } from '@composable/sdk'

const C = Components.declare({ author: 'acme', id: 'chart' })
export const push    = C.op('push', 'Add a point', { input: Type.Number() })                        // sink
export const hovered = C.op('hovered', 'Point under the cursor', { output: Type.Number() })         // source
export const stats   = C.op('stats', 'Summary', { input: Type.Null(), output: Type.Object({ n: Type.Number() }) }) // action
```

Names become `acme/chart/push`. Types are TypeBox schemas; `typeHash(schema)` is a type's content-addressed id (a
SAID, as in kerits), and a type with `$id` is named (a brand).

## 2. Define (or lift) the component

```ts
export const chart = C.define({
  state: () => ({ points: [] as number[] }),
  handlers: [
    [push, (n, { state }) => { state.points.push(n) }],
    [stats, (_, { state }) => ok({ n: state.points.length })],
  ],
  added: (system, { state }) => { /* joined a System: subscribe there; return a cleanup */ },
  updated: (delta, { system }) => { /* that System changed: added / removed / manifest */ },
})
```

A handler's `system` is the handle of the System the call came through (it carries the call's correlation).
Plain code can be lifted instead: `Components.lift(id, { echo: Type.Function([In], Out) }, { echo: ... })`.

## 3. Create, register, connect

```ts
import { Systems, unwrap } from '@composable/sdk'

const system = Systems.create()
const c = chart.create()                       // the owner creates (and later disposes) the instance
system.register('chart', c)                    // ...and registers it (a Result); the same instance may join other Systems
system.subscribe({ source: 'slider', op: valueChanged.name, listener: 'chart', target: push.name })   // an output feeds an op
const page = unwrap(system.register('page', Components.party()))   // hosts take the handle with unwrap
await page.call('chart', stats, null)          // → { type: 'success', data: { n: … } }
```

`system.subscribe` returns a Result holding the subscription; `system.unsubscribe(id)` closes it. Subscriptions are System
data: `snapshot().subscriptions`, with `subscription-opened` / `subscription-closed` deltas in `updates`.

A component acts only through the handles it is given (`onAddedToSystem`): `notify`, `call`, `subscribe`, `use`.
Being in two Systems, it decides where its notifications go. Handles given for a call carry its correlation, so
loops are caught (a budget per correlation); a handle kept for later starts a new correlation per operation.

## 4. Dependencies

A component can declare an op it needs from another; something binds it, and handlers call it through `deps`:

```ts
const enrich = C.dependency('enrich', 'look up a date of birth', { op: { name: 'enrich', input: Name, output: Born } })
const toUser = C.op('to-user', 'Person → User', { input: Person, output: User, requires: [enrich] })
system.bind('map', 'enrich', 'dob', dob.ops.lookup.name)   // a Result; `unbind('map', 'enrich')` undoes it
```

## 5. Compose

```ts
const panel = Components.compose({ id: { author: 'acme', id: 'panel' } }, c => {
  const input = c.use('input', textEmit)
  const table = c.use('table', eventsTable, h => h.withNotify(Notifications.debounce(200)))
  c.route(input(submitted), table(onEvent))
  c.expose(setInput, submitted)
  return { input, table }
})
```

`c.pipe(name, description, steps)` makes a chain one action; a composite that declares pipes and calls no `expose()` offers only its pipe ops (no child ops, no forwarded child sources), and `expose()` adds child ops on top.
A composite owns a System of its own; only exposed ops are visible outside. Wrappers (`withNotify`, `withCall`,
`withSubscribe`) intercept a handle: that is how muting, filtering or a policy is built, outside the core.

## 6. Systems as components

`Systems.component(system, { catalog })` exposes a System through ops (`instances`, `changed`, `definitions`,
`create`, `remove`, `subscribe`, `unsubscribe`, `subscriptions`, `subscriptions-changed`, `bind`, `unbind`,
`bindings`). Register it in the same System, or another (a System of Systems). Pickers, editors and policies are just
components that use it. `Systems.restrict(system, as)` is a view that answers `not-allowed` for anything involving
another instance.
`system.observe(trace => …)` sees every operation.

## Building

`bun run build` writes `dist/` (ESM + `.d.ts` + a publishable `package.json`); publish from there.
