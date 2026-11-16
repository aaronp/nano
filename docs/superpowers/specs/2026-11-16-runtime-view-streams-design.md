# Runtimes own their streams; subscriptions are iterables; sources are methods

*Proposed 2026-11-16 for the user's review. Builds on `2026-11-16-runtime-entry-design.md`. This completes the
KVS / todo case study.*

## Decisions already made (by the user)

1. **Each runtime has its own stream.** `app.runtime(id).listen(fn)` is the `AppEvent` stream of that runtime only. The
   `Application` is a collection of runtimes: what duplicates a runtime's behaviour moves into it. `app.listen`
   stays as the operator's stream (every runtime), and the single-runtime shorthand is unchanged.
2. **Policy is checked once per subscription**, when it connects (`isAllowed(from, pod, 'subscribe')`), not on each
   delivery. A later `apply` that changes the policy re-checks live subscriptions; a denied one is dropped and the
   stream says `denied`. (A performance spike comes after this works end to end.)
3. **Whoever holds `app` is the operator.** Components and UIs are handed a `RuntimeView` or their `deps`, never
   `app`. This is a docs convention, not code.
4. **`Entry` is renamed `RuntimeView`.**

## 5. `on` with no callback is an `AsyncIterable`

`selection.on(op)` (in a pod) and `runtimeView.subscribe(op)` (from the host) with no `fn` return an
`AsyncIterable` of the same deliveries, in the same runtime, under the same policy. `break` (or `return()`) unsubscribes,
and so does the build closing. This is an overload of what exists, not a new concept.

## 6. A source is a method on the plain object

`Interface.Type` maps an event op to `() => AsyncIterable<T>`:

```ts
export const api = ns.interface('TodoList', { add: …, list: …, items: Op.event(Todo) })
// TodoList: { add(text): Promise<Todo>; list(): Promise<Todo[]>; items(): AsyncIterable<Todo> }
```

- **Implementation side:** when a plain `make` returns an object whose source method yields, nano runs it once per
  build (from when the pod is built until it closes) and publishes each yielded value as that pod's event: policed,
  on the stream, and delivered along pipes. **Hot**: every consumer sees what happens after it subscribes. Anyone who
  needs what already exists calls `list()` first.
- **Consumer side:** `frontend.get(TodoListDef.api).items()` is `subscribe(items)` with no callback.

The todo example's `items()` is a generator over `one(KeyValueStoreDef.api).on('put')` that keeps `todos` keys. The
store stays plain CRUD.

## Proven by

`examples/todo`: a frontend consumer iterating `items()` sees todos added after it starts, and not ones added
earlier; `break` unsubscribes (the stream shows no further deliveries to it); the backend's stream doesn't show
frontend events and the frontend's doesn't show backend ones. Unit tests: `on`/`subscribe` without a callback, the
policy asked once per subscription (counted), re-checked on `apply`, and the source runner stopped at close. All
suites, `tsc`, the structure test and Playwright stay green.

## New public names (for the user's approval)

`RuntimeView` (renaming `Entry`); `RuntimeView.listen`; the no-callback overloads of `on` and `subscribe`;
`Interface.Type` mapping events to `() => AsyncIterable<T>`; a plain `make` source method that nano publishes.

## Not in this step

Cold (per-consumer) sources; backpressure (a slow iterator buffers, unbounded for now; marked `ponytail:`);
payloads on the stream; the load policy.
