# @pritzlaff/nano-core

Lift ordinary code into named coordinates that can be called, published from, subscribed to and observed.

| File | Purpose |
|---|---|
| `src/data.ts` | Names and plain data: `Op`, `Coord`, `Result`, `Event`, `Subscription`, `Delta`. |
| `src/component.ts` | Wraps plain code: how to make a value, and the actions over it. |
| `src/env.ts` | An instance's view of the registries it is in: one handle each, and its own ops. |
| `src/registry.ts` | One place holding instances and subscriptions; reports every change as a `Delta`. |
| `src/runtime.ts` | Calls and publishes by name over one registry; wrap it with a `Policy` to change the rules. |

## A counter

```ts
let counter = 0
const increment = () => { counter = counter + 1 }

const Updated = Ops.source('com.acme', 'counter-updated', Type.Number())
const Inc = Ops.sink('com.acme', 'inc', Type.Null())

const Counter = Components.create({ ns: 'com.acme', name: 'counter' }, () => ({ get: () => counter, increment }))
Counter.action(Updated, c => c.get())                             // a source's action reads the current value
Counter.action(Inc, c => { c.increment() }, { emits: [Updated] }) // after inc, publish what Updated reads

const rt = Runtimes.create(Registries.create('r'))
rt.registry.add('counter', Components.instantiate(Counter))
await rt.call({ registry: 'r', instance: 'me' }, 'counter', Ops.key(Inc), null)
```

The registry is in itself as the instance `registry`. Its changes (`instance-added`, `op-added`,
`subscription-opened`, …) are events from it, so watching a registry is subscribing to it, and changing one
is calling it. `test/examples.test.ts` walks through watching, subscribing at runtime, one instance in two
registries, a "subscribe only yourself" policy, and adding ops at runtime.
