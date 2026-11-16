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

The primitive is today's `send` (`application/messages.ts`), not a new function. It takes an emission from a source (a pod
instance's port) to a sink in one runtime, and it is policed and traced. Pipes already use it (`act` → `send`), and so do
`on` listeners (`send` with `work`). A sink is one of:
- **a pod's action**, for a pipe Connection. The Connection passes the emission's `output` as the action's input,
  so `fits` and `nano.json` don't change (my call);
- **a listener run inside a pod** (or the host), for a programmatic subscription.

Two checks, kept apart. **Each message** is still policed by `send` as today, which is the authorisation point.
**Subscribing** (`isAllowed(owner, pod, 'subscribe')`) is asked once, when a listener connects, and again only if
`apply` changes the policy. A listener that is now denied is dropped, and the stream says `denied` (my call). The
live record is today's `live.ons` (`On`, which already holds a build's listeners and drops them at close). Pipes stay
read from the deployment, so no new Connection type is needed in this step.

## The four use cases, one test file each (`packages/nano/test/use-cases/`)

1. **`subscription.test.ts`: a Subscription as a deployment descriptor.** A `pipe` in a `RuntimeDeployment` connects
   two pods. Its Connection exists while both are built, and each emission reaches the target action. `apply` that
   removes the Subscription ends the Connection.
2. **`programmatic.test.ts`: a listener through the context that satisfies a source.** An interface declares
   `items: Op.event(Todo)`, so `Interface.Type` gives `items(): AsyncIterable<Todo>`. The implementation builds it
   from `ctx.one(KeyValueStoreDef.api)` and listens to `put`, getting `{ input, output }`. Nano runs the yielded values
   as the pod's events (hot). A consumer's `for await` sees items added after it starts, and `break` ends the listener.
3. **`lifecycle.test.ts`: a pod reacts to other pods added to or removed from its runtimes.**
   `ctx.addOnPodChangeListener(fn)` is given `{ type: 'added' | 'removed', runtime, pod, implementation }`. It is
   driven by `apply`'s placement changes (the same changes `applied` reports), not by a new stream event. A pod's own
   lifecycle stays `make` plus `ctx.addOnCloseListener`. Asking the policy `isAllowed(pod, other, 'lifecycle')` is a
   separate question from `'subscribe'`. The listener ends when the build closes. An implementation sees these only
   if its `make` passes them on.
4. **`observability.test.ts`: the runtime's own stream.** `app.runtime(id).listen(fn)` is a **filter over the one
   existing stream** (`trace`), not a second stream. It keeps events whose pod is placed in `id`, `sent` with that
   `runtime`, and `delivered`/`denied` whose `id` was sent there. It sees nothing from another runtime. `app.listen`
   stays the operator's stream.

The todo example then uses 1 and 2 (`frontend` reads `items()` and `backend` holds the store), and its own tests
stay as the end-to-end proof.

## Also in this step

- `Entry` is renamed `RuntimeView`.
- `Hear` is deleted: the host's `subscribe` becomes an `On` with the host as its owner, sent through `send`.
- `sent.kind` already has `'on'`, so listener deliveries show up on the stream without changes.
- **Whoever holds `app` is the operator:** components get a `RuntimeView` or `deps`, never `app`. Docs only.

## New public names (for the user's approval)

- `RuntimeView` (renaming `Entry`) and `RuntimeView.listen`.
- `Interface.Type` maps an event op to `() => AsyncIterable<T>`; a plain `make` source method that nano publishes.
- `selection.on(op)` with no callback returns an `AsyncIterable` (the programmatic listener as an iterable).
- `ctx.addOnPodChangeListener(fn)` (approved), with the policy question `'lifecycle'`.
- **Three boundaries, each with its own policy:** lifecycle (`addOnPodChangeListener`), a pod's own traffic
  (`on` over its wired deps) and runtime observability (`RuntimeView.listen`, for the operator only, never on `ctx`).
- Emission subscribers get `{ input, output }` (a change: today `on` gets the output alone).

## Not in this step

Cold (per-consumer) sources; backpressure (a slow iterator buffers without a bound for now, marked `ponytail:`);
payloads on the stream; the load policy; a performance spike (after this works end to end).
