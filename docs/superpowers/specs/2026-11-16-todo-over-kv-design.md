# Step A: a todo list over a key/value store, written to interfaces

*Agreed with the user on 2026-11-16. Items marked **(my call)** were mine; the user can overturn them. This replaces
the store contract in `2026-11-15-kv-store-example-design.md` (paths and JSON instead of string keys and versions);
that spec's viewer is step D.*

## Why

Show nano's promise in its smallest form: plain TypeScript interfaces, plain TypeScript implementations, and nano in
between. A test holds a `TodoList` and calls it like any object; every call goes through a nano application, and the
todo implementation reaches its store only through the runtime.

## What gets built (`examples/todo/`, shaped like `examples/slice`; nothing added to nano-core)

- `kv.ts`: `Path = string[]`, JSON values, the plain `interface KeyValueStore { get, put, delete, list({ prefix }) }`
  and the nano interface of the same name (`example.kv.KeyValueStore`); `inMemory()`, a plain object; the provider
  `example.kv` with `example.kv/memory`.
  - `list` is ordered by path. `get` answers `null` for a missing key. No versions or conflicts **(my call)**.
- `todo.ts`: `Todo = { id, title, done }`, the plain `interface TodoList { add, list, update, remove }` and the nano
  interface `example.todo.TodoList`; `todoList(store)`, plain domain code over any `KeyValueStore`, each todo at
  `['todos', id]`; the provider `example.todo` with `example.todo/kv`, which depends on a `KeyValueStore`.
- `plain.ts`: two small adapters, the best of the old runes idea carried forward:
  - `handlers(iface, obj)`: a plain object's methods as nano handlers (a value is `success`, a throw is `threw`).
  - `plain(() => client)`: a nano `Client` as a plain object (a `Fail` throws an `Error` carrying it). It resolves
    the client on every call, so a rewired call edge is followed.
  They stay in the example **(my call)**; whether they move into nano is the user's call.
- `nano.json`: runtime `main` with pods `store` and `todos` and one call edge `todos → store`.

## How it is proven (`cd examples && bun test --isolate`)

- `inMemory` directly, with no nano: put, get, list by prefix in path order, delete, values copied.
- `TodoList` through the application, as plain TypeScript: add, list, update, update of a missing id, remove.
- The stream records `todos` calling `store`, so the store is reached through the runtime.
- A `Fail` reaches the caller as a thrown `Error` carrying it; a throwing plain method is a `threw` result.

## Not in this step

The interface proxy for web components (B), a component that ships its subscriptions (C), a web component that is a
store and the IndexedDB implementation (D) **(my call: Bun has no IndexedDB)**, the workspace.
