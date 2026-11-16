# Nano's layers: data model, conventions, sugar

*Proposed 2026-11-16 for the user's review. Design is driven from the top: a working application written the way a user
wants to write it is the acceptance test; each gap it exposes is fixed at the layer that owns it.*

## The three layers

| Layer | Who uses it | What it is | Rule |
|---|---|---|---|
| **3. Sugar** | application authors | `Application.load`, `app.get(api)`, plain objects | each call is a one-line wrapper over layer 2; nothing here holds state or meaning of its own |
| **2. Conventions** | component authors | `Noun.verb` factories, a `ThingDef` namespace per contract, `make` lifting plain TS | builds layer-1 values; adds no concept the data model lacks |
| **1. Data model** | nano itself, tools, the workspace | plain, frozen, JSON-describable values and the one live `Application` | every fact stored once; relationships by coordinate |

The proxy (today) or a compiler (later) is how layer 3's plain objects reach layer 1. It sits behind `resolve`, so
swapping one for the other changes nothing above.

## Layer 1: the domain values and their relationships

| Value | Holds | Refers to |
|---|---|---|
| `Schema` | a TypeBox schema, its content hash, an optional label | – |
| `Op` | kind (action/event), input and output schemas | schemas |
| `Interface` | coordinate; ops **named by key**; each op's coordinate = hash(name, schemas) | namespace, ops |
| `Implementation` | coordinate; interfaces it provides; dependency roles (selectors); config schema; factory | interfaces, namespace |
| `Provider` | an author's namespace, its implementations, metadata | implementations |
| `Registry` | providers, looked up by coordinate | providers |
| `Pod` | an implementation's coordinate, config, eager, isolation | implementation (by coordinate) |
| `Runtime` | id; pods placed; subscriptions (call edges, pipes); policy | pods (by name) |
| `AppDeployment` | pods, runtimes, tags; host data (`modules`, `views`, `layout`) | everything above, as data |
| `Application` | the one live thing: instances, routing, the stream | runtimes |
| `Coord` | typed names: namespace, interface, implementation, port, pod instance | – |

**Data-model fixes (each fact once):**
1. **An op is a signature, unnamed.** It is `{ kind, input, output }`; the interface gives its name by key and computes
   its coordinate then. `get: Op.action(Path, Value)`. Today the name is stored in the op and repeated as the key.
2. **A schema's name is an optional label.** Hashes already ignore it. `Schema.define(Type.Array(Type.String()))`,
   with a label only where it helps a reader or a tool.
3. **Schemas nest directly.** A schema definition can be used inside another TypeBox schema without `.schema`.

## Layer 2: conventions

```ts
export namespace KeyValueStoreDef {
  export const ns = Coord.namespace('example.kv')
  export const Path = Schema.define(Type.Array(Type.String()))
  export type Path = Static<typeof Path>                          // TypeScript's line; the only repeat left
  export const api = ns.interface('KeyValueStore', {
    get: Op.action(Path, Value),
    put: Op.action(Type.Object({ key: Path, value: Value }), Type.Null()),
    changed: Op.event(Type.Object({ key: Path })),
  })
  export type KeyValueStore = Interface.Type<typeof api>
}
```

**A namespace builds** (layer 2 over layer 1's pure coordinates): `ns.interface(name, ops)` is
`Interface.define(ns.interfaceId(name), ops)`; `ns.provider(impls, meta?)` is `Provider.define(ns, impls, meta)`.

**Implementations start from the contract they provide.** The implementation's coordinate is always given: it is in
the *provider's* namespace (`aws.kv/dynamo` implements `example.kv.KeyValueStore`). Two forms, both ending in the same
layer-1 `Implementation.define(coord, { provides, dependencies, config, make })`, which stays as the explicit form:

```ts
// The builder: each step is optional, each narrows the types for the next, and every step offers make().
const memory = KeyValueStoreDef.api.impl(ns.implementationId('memory')).make(() => inMemory())
const todos = TodoListDef.api.impl(acme.implementationId('todos'))
  .needs({ store: KeyValueStoreDef.api })                  // deps typed from here on
  .config(Type.Object({ prefix: Type.String() }))          // config typed from here on
  .make(({ deps, config }) => todoList(deps.store, config.prefix))

// create: everything at once, for when a chain reads worse.
const todos2 = TodoListDef.api.impl(acme.implementationId('todos')).create({
  needs: { store: KeyValueStoreDef.api }, config: Type.Object({ prefix: Type.String() }),
  make: ({ deps, config }) => todoList(deps.store, config.prefix),
})

// Several interfaces: each extra one gets its own plain object from the same build (no method-name clashes).
const adminStore = KeyValueStoreDef.api.impl(acme.implementationId('admin-store'))
  .make(() => store)
  .satisfies(AdminDef.api, () => admin)
```

## Layer 3: sugar

```ts
const app = await Application.load('./nano.json')      // fetch, load `modules`, assemble, create
const todos: TodoList = app.get(TodoListDef.api)       // = app.resolve(TodoListDef.api).getOrThrow()
```

- **`app.resolve(api, where?)`** returns a `Resolution`: what was found (pod, runtime, implementation coordinate) and
  the plain object, or why not (`not-found`, `ambiguous`). `getOrThrow()` gives the plain object or throws an `Error`
  carrying the `Fail`. `app.get` becomes exactly that.
- **`Application.load(url, opts?)`** reads a `nano.json`, imports each `modules` entry, adds the providers to a
  registry, assembles and creates. It fails with the first reason, nothing half-running.

## How it is driven (TDD from the top)

`examples/todo/app.test.ts` is written first, as an application author would, and must pass before any layer is
called done:

```ts
const app = await Application.load(new URL('./nano.json', import.meta.url))
const todos = app.get(TodoListDef.api)
await todos.add('milk')                                   // it just works
expect(app.resolve(TodoListDef.api).pod).toBe('todos')    // and says what it found
```

Each failure is traced to its layer and fixed there: a missing value or relationship is layer 1; awkward
construction is layer 2; noise at the call site is layer 3. Then the runtime benefits (stream, swap, subscribe) and
configuration-as-data are added as further top-level tests, the same way.

## Order

1. Layer 1 fixes (ops named by key, optional schema labels, direct nesting), migrating every caller.
2. The `api.impl` builder and `create` (layer 2).
3. `app.resolve` + `Resolution`; `app.get` on top.
4. `Application.load` (nano loads `modules`).

## New public names (for the user's approval)

`Op.action(input, output)` / `Op.event(data)` without a name (the named forms go); `Schema.define(schema, label?)`;
`api.impl(coord)`, a builder with `needs`, `config`, `make`, `create` and `satisfies`;
`app.resolve` and `Resolution` (with `getOrThrow`); `Application.load`.

## Not in this step

Events on the plain side as streams; payloads on the stream; host-side `on`; compiled validators; a compiler.
