# @composable/runes

Write a component as plain state and functions; get an ordinary `@composable/core` Component.

```ts
const Counter = component('acme/counter', () => {
  const s = state({ count: 0 })
  return {
    get count() { return s.count },    // a source: published when it changes, readable by calling it
    increment: () => { s.count += 1 },  // an action: acme/counter/increment
  }
})

reg.subscribe({ source: 'counter', op: Ops.key(Counter.ops.count), listener: 'log', target: Ops.key(Log.ops.log) })
```

- **`state(init)`:** reactive state. A write at any depth schedules one publish per microtask of the getters whose
  JSON changed. Subscribers receive copies, never the live state.
- **`event(schema?)`:** a source that isn't state, such as a click. Calling it publishes its argument. It is
  named by its member key.
- **`component(id, make, schemas?)`:** functions become actions, getters become sources and events become sources.
  `schemas` optionally types any member, and the runtime validates against it. `make` runs once when the
  component is defined, to read its shape, and once per instance. `.ops` holds typed references to every op.

`state` and `event` must be called while `make` runs. Called anywhere else, they throw.
