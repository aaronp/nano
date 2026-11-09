# @composable/runes — design

## Intent

Write a component the way you would write a Svelte 5 store: plain state, plain functions, a returned object. The
returned object *is* the component's public surface. Functions become actions, and getters become sources that are
published when their value changes. This is a thin layer over `@composable/core`, which stays as it is apart from
one type fix. Proven by the spike in `packages/core/spike/` (37 lines, slider → debounce → table).

```ts
const Counter = component('acme/counter', () => {
  const s = state({ count: 0 })
  return {
    get count() { return s.count },
    increment: () => { s.count += 1 },
  }
})
```

## Goals

- `component(id, make, schemas?)` returns a core `Component`.
  - Each function member is an action, with op key `<id>/<member>`.
  - Each getter is a source: it is published when its value changes and can be called to read the current value.
- `state(init)` is reactive state. Writes anywhere inside it, including nested ones (`s.list.push(x)`), schedule
  **one** publish per microtask of the getters whose value changed.
- `event(name, schema?)` is a source that is not state, such as a click. Calling it publishes its argument.
- **Typed op references**, e.g. `Counter.ops.count` and `Counter.ops.increment`.
  - Each is the core `Op`, so wiring and calling need no strings: `Ops.key(Counter.ops.count)`.
  - They are available without making an instance.
- **Optional schemas per member**, e.g. `{ set: Type.Number() }`. This is the action's input or the source's
  output, and defaults to `Type.Unknown()`.
- **Example tests** reproduce the spike's stories: the counter, and slider → debounce (with a frequency slider) → table.
- `@composable/core`: `Component<A>` accepts mixed lists without `any` (the spike needed `Component<any>`).

## Non-goals

- A compiler or Bun plugin for real `$state` on `let`. A Proxy is enough for now.
- Decorators.
- Web-component or element adapters. That comes later, built on these components.
- Wiring helpers. The connection editor and workflow come later.

## Anti-goals

- Any change to the core beyond the `Component<A>` type fix.
- A file over ~200 lines; aim for one file of ~50–100 lines.
- Hidden global registries or singletons beyond the "instance being made" pointer `state()` needs.

## Settled by Claude, not by the user (check these)

- **Its own package**, `packages/runes` (`@composable/runes`), depending only on `@composable/core` and `typebox`.
  This keeps the core free of opinions about style. The spike's files are deleted once the package lands.
- **State is deep**, like Svelte's `$state`: nested objects and arrays are proxied too, so `push` is seen.
  - ponytail: re-reads every getter on each flush; track dependencies if components grow large.
- **Shape is fixed at creation.** Ops come from the members of the object `make` returns: getters, and properties
  holding functions.
  - `component` calls `make` once at definition time, with no env, to read those members for `.ops`. `make` must
    therefore be free of side effects until its members run.
  - Each instance calls `make` again for its own state.
- **`state()` must be called while `make` runs.** Called anywhere else, it throws a clear error rather than being
  silently non-reactive.
- **An action's argument** is one value: the member function's first parameter. Return values pass through.
- **`event(schema?)`** is created while `make` runs, like `state`, and is named by its member key
  (`clicked: event()`).
  - It is a source only. Calling it publishes from inside the component, but it is not an action other components
    can call.
- **What a getter publishes is a plain copy, not the live proxy.** Subscribers get no handle onto the component's
  state.
  - "Changed" means the copy's JSON differs from the last one published. This replaces the `Object.is` rule above,
    which a deep state can't use.
  - ponytail: a JSON copy and compare per getter per flush; fine for UI-sized state.
- **Ops are registered once, on the component**, from the definition-time `make` call. A new instance has them at
  creation, listed in `instance-added`. Each op's run dispatches to that instance's own object.
- **Getters are not published on creation.** At that moment nobody can be subscribed yet. A subscriber that joins
  later reads the current value by calling the getter.
- **Core type fix:** `Component<A = any>`. A bare `Component` then accepts any component.
- **CI runs `packages/runes`**, as it does core.

## Left to the builder

- How `ops` is typed (mapped types over the returned object) and how `event` is typed.
- Proxy details, such as caching nested proxies.
