# @pritzlaff/nano-runes

Write a component as plain state and functions; get an ordinary `@pritzlaff/nano-core` Component.

```ts
const Counter = component('acme/counter', () => {
  const s = state({ count: 0 })
  return {
    get count() { return s.count },    // a source: published when it changes, readable by calling it
    increment: () => { s.count += 1 },  // an action: acme/counter/increment
  }
}, {
  count: Type.Integer({ description: 'How many so far', examples: [0, 3] }),
  increment: { description: 'Adds one' },             // an action: { in?, out?, description }
}, { description: 'Counts up' })

reg.subscribe({ source: 'counter', op: Ops.key(Counter.ops.count), listener: 'log', target: Ops.key(Log.ops.log) })
```

- **`state(init)`:** reactive state. A write at any depth schedules one publish per microtask of the getters whose
  JSON changed. Subscribers receive copies, never the live state.
- **`event(schema?)`:** a source that isn't state, such as a click. Calling it publishes its argument. It is
  named by its member key.
- **`component(id, make, schemas, opts?)`:** functions become actions, getters become sources and events become
  sources. `schemas` has an entry for **every** member:
  - a getter or event: its schema, whose `description` (and `examples`) describe the op;
  - an action: `{ in?, out?, description }`. No `in`: it takes anything and ignores it. No `out`: it returns nothing.

  A schema that disagrees with the code is a compile error: a getter's values must fit its schema, and an action's
  `in` must fit its parameter. `opts.description` says what the component is for. `make` runs once when the
  component is defined, to read its shape, and once per instance. `.ops` holds typed references to every op, each
  with its `description`.

`state` and `event` must be called while `make` runs. Called anywhere else, they throw. State is JSON-shaped data:
arrays and plain objects are tracked (and copied per instance); a Map, Set or Date inside is stored but its changes are not seen.
