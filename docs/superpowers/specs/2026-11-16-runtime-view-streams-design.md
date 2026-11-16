# One delivery primitive; four use cases, each with its own test

*Proposed 2026-11-16 for the user's review. Builds on `2026-11-16-runtime-entry-design.md` and completes the KVS / todo
case study. Items marked **(my call)** were mine; the user can overturn them.*

## The layers (the user's model)

| Layer | Is |
|---|---|
| **Subscription** | data: the deployment's intent to connect a source to a sink (`call` or `pipe`, in `nano.json`) |
| **Connection** | the live record of a Subscription on actual pod instances |
| **Runtime delivery** | the one mechanism that carries data into a pod, which invokes its functions safely |
| **Programmatic subscription** | an API on the `make` context that uses the delivery primitive; not a Subscription and not saved |

## Why

`application/emit.ts` delivers in three ways: pipes go through `act`/`send` and `On` listeners through `send` with a
`work` callback, while the host's `Hear` (added in 387aedb) skips `send`, asking policy itself on every delivery. That
is a parallel mechanism, so it goes.

## The primitive

An **emission** is what a source produces: for an action, `{ input, output }` of each successful call; for an event,
`{ output }` (my call: an event has no input). The low level never drops data.

`deliver(runtime, source, sink)` takes an emission from a source (a pod instance's port) to a sink in one runtime,
through `send`: policed and traced. A sink is one of:
- **a pod's action**, for a pipe Connection. The Connection passes the emission's `output` as the action's input,
  so `fits` and `nano.json` don't change (my call);
- **a listener run inside a pod** (or the host), for a programmatic subscription.

The policy is asked once, when a Connection or listener connects, and again only if `apply` changes the policy. A
listener that is now denied is dropped, and the stream says `denied` (my call).

## The four use cases, one test file each (`packages/nano/test/use-cases/`)

1. **`subscription.test.ts`: a Subscription as a deployment descriptor.** A `pipe` in a `RuntimeDeployment` connects
   two pods. Its Connection exists while both are built, and each emission reaches the target action. `apply` that
   removes the Subscription ends the Connection.
2. **`programmatic.test.ts`: a listener through the context that satisfies a source.** An interface declares
   `items: Op.event(Todo)`, so `Interface.Type` gives `items(): AsyncIterable<Todo>`. The implementation builds it
   from `ctx.one(KeyValueStoreDef.api)` and listens to `put`, getting `{ input, output }`. Nano runs the yielded values
   as the pod's events (hot). A consumer's `for await` sees items added after it starts, and `break` ends the listener.
3. **`lifecycle.test.ts`: a pod hears components mounted and unmounted in its runtime.** When `apply` adds a pod to
   the runtime, a listening pod hears `mounted`; when it removes one, `unmounted`. **This needs new API, see below.**
4. **`observability.test.ts`: the runtime's own stream.** `app.runtime(id).listen(fn)` sees every message in that
   runtime as `sent` (from, to, port), `delivered` and `denied`, plus its lifecycle. It sees nothing from another
   runtime. `app.listen` stays the operator's stream across every runtime.

The todo example then uses 1 and 2 (`frontend` reads `items()` and `backend` holds the store), and its own tests
stay as the end-to-end proof.

## Also in this step

- `Entry` is renamed `RuntimeView`.
- `Hear` is deleted: the host's `subscribe` registers a listener sink with the host as its owner.
- **Whoever holds `app` is the operator:** components get a `RuntimeView` or `deps`, never `app`. Docs only.

## New public names (for the user's approval)

- `RuntimeView` (renaming `Entry`) and `RuntimeView.listen`.
- `Interface.Type` maps an event op to `() => AsyncIterable<T>`; a plain `make` source method that nano publishes.
- `selection.on(op)` with no callback returns an `AsyncIterable` (the programmatic listener as an iterable).
- **Lifecycle for pods (use case 3):** today a pod can only hear its own close (`ctx.addOnCloseListener`). It needs a
  way to hear other pods `mounted`/`unmounted` in its runtime. My proposal is `ctx.onLifecycle(fn)`, given
  `{ type: 'mounted' | 'unmounted', pod, implementation }` for its runtime. The name and shape are yours to decide.
- Emission subscribers get `{ input, output }` (a change: today `on` gets the output alone).

## Not in this step

Cold (per-consumer) sources; backpressure (a slow iterator buffers without a bound for now, marked `ponytail:`);
payloads on the stream; the load policy; a performance spike (after this works end to end).
