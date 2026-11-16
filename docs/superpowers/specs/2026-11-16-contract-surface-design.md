# Nano as a user writes it: one contract, typed dependencies, plain objects

*Proposed 2026-11-16 for the user's review. Builds on the DI spike (`docs/spikes/2026-11-16-di-comparison.md`, items
1–3). Mostly conventions and DRY over what exists; every new public name is listed at the end for approval.*

## The goal, in the user's words

Contract-first, like Elysia/Eden: define the contract once and get the TypeScript types from it. Then it "just works"
as plain TypeScript; on top of that, nano's runtime gives observability, swapping and decorating, and the whole
configuration as data (`nano.json`). The todo list over a key/value store is the case study.

## 1. The contract, written once

```ts
// kv/contract.ts: no implementation code; what other teams import
export namespace KeyValueStoreDef {
  export const ns = Coord.namespace('example.kv')

  export const Path = Schema.define('Path', Type.Array(Type.String()))
  export const Entry = Schema.define('Entry', Type.Object({ key: Path.schema, value: Value.schema }))

  export const api = Interface.define(ns.interface('KeyValueStore'), {
    get: Op.action('get', Path, Value),
    put: Op.action('put', Entry, Type.Null()),                      // a bare schema: no name needed
    delete: Op.action('delete', Path, Type.Null()),
    list: Op.action('list', Type.Object({ prefix: Path.schema }), Type.Array(Entry.schema)),
    changed: Op.event('changed', Type.Object({ key: Path.schema })),
  })
  export type KeyValueStore = Interface.Type<typeof api>          // the plain TS interface, derived (like Static)
  export const impls = { memory: ns.implementation('memory') }
}
```

- **`Interface.Type<typeof api>`** is the plain interface: each action `(input) => Promise<output>`; an input that is
  only `null` is no argument and an output that is only `null` is `void` (today's example `Plain`). It replaces the
  hand-written twin and `Matches`. Events are not methods on it (see "Not in this step").
- **`Op.action`/`Op.event` take a `SchemaDef` or a bare TypeBox schema.** A bare one is defined under
  `<op name>.in` / `<op name>.out` — names only label; hashes depend on the schema alone, so pipes still fit.
- Coordinates come from the namespace, so a contract spells its namespace once.

## 2. Implementations: plain objects, typed dependencies

```ts
const todos = Implementation.define(TodoListDef.impls.kv, {
  provides: [TodoListDef.api],
  dependencies: { store: KeyValueStoreDef.api },
  make: ({ deps }) => todoList(deps.store),     // deps.store: KeyValueStoreDef.KeyValueStore, through the runtime
})
const memory = Implementation.define(KeyValueStoreDef.impls.memory, {
  provides: [KeyValueStoreDef.api],
  make: () => inMemory(),                        // a plain object for its one interface
})
```

- **`ctx.deps`**: one plain object per declared role, typed from the role's interface (Effect's typed requirements, as
  a plain object). Each call goes through `ctx.one(role)` at call time, so a rewired edge is followed, and a `Fail`
  throws an `Error` carrying it (`err.fail`). `make` keeps its signature `(ctx, config)`; `deps` is a new field of `ctx`.
- **`make` may return a plain object** when the implementation provides one interface; nano lifts it (a value is
  `success`, a throw is `threw`). Returning `provide(...)` parts still works, for several interfaces.

## 3. Selectors stay, with honest types

`ctx.one`/`ctx.all` remain the general tool (narrowing by tags, runtime, implementation). Their returns get honest:

| Today | Proposed |
|---|---|
| `one(s)`: a `Selection` with `ok` and optional `fail`; calling a failed one returns its `Fail` | `one(s)`: `NanoResult<Selection<I>>`, so a missing or ambiguous edge is a `Fail` you must look at |
| `all(s)`: `Selection<I>[]` | unchanged: every entry is a real edge, in deployment order |
| `sel.on(op, fn: (data: unknown) => …)` | `on` typed by the op: `fn(data: Static<op output>)`, and only ops of `I` |
| `ctx.publish(op, data: unknown)` | `data` typed by the op's schema |

`Selection<I>` then always has `pod`, `runtime`, `call` (typed `Client<I>`, results as `NanoResult`) and `on`.

## 4. From the host: the same plain object

```ts
const app = (await Application.create(runtimes)).value        // as today (loading nano.json by URL is a later step)
const todos = app.get(TodoListDef.api)                         // TodoListDef.TodoList, plain
await todos.add('milk')                                        // a host call, policed and on the stream
```

- **`app.get(api, { runtime?, pod? })`** returns `Interface.Type<api>` for the one pod providing `api` (narrowed by
  runtime or pod when there are several). None or several is a thrown `Error` with its `Fail`; it resolves on each
  call, so `apply`/`restart` are followed. `app.call(runtime, pod)` stays as the result-returning form.

## How it is proven

`examples/todo` is rewritten as the template (`kv/contract.ts`, `kv/memory.ts`, `todo/contract.ts`, `todo/kv.ts`,
`nano.json`) and its tests show the three benefits in order:
1. **It just works:** `app.get(TodoListDef.api)` does CRUD as plain TypeScript.
2. **The runtime's value:** the stream shows every `todos → store` call with its timing; `apply` swaps the store for a
   second implementation mid-test and the next call reaches it; a subscriber hears `changed`.
3. **Configuration as data:** the running app's `deployment()` round-trips through `nano.json`.

Plus unit tests for `Interface.Type`, bare schemas, `ctx.deps`, plain `make`, the new `one`, typed `on`/`publish`, and
`app.get`. All suites, `tsc`, the structure test and Playwright stay green.

## Not in this step

Events as `Stream`/`AsyncIterable` on the plain side; compiled validators (the spike's cost); `Application.load(url)`
and nano loading `modules`; payloads on the stream; a compiler (code generation from the deployment) as an
alternative to the Proxy, which stays the mechanism for now.

## New public names (for the user's approval)

`Interface.Type`, `ctx.deps`, `app.get`; `Op.action`/`Op.event` accepting bare schemas; `make` returning a plain
object; `one` returning `NanoResult<Selection<I>>` (a change: callers of today's `one` move to checking the result).
The example adapters `handlers`, `plain`, `Plain`, `Matches` move into nano behind these and are not exported.
