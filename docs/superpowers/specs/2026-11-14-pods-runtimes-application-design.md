# Nano: pods, runtimes and an application

*Decided with the user on 2026-11-14. Revises `2026-11-14-values-and-application-design.md` (its values, messages,
validation and stream stand unless changed here) and supersedes its single-deployment `Application`, its live
`Runtime` view and its "event" subscriptions. Items marked **(my call)** are flagged in "Open".*

## The idea

Each domain object has its own deployment, the data for what it owns, and its own `create`:

| Level | Data | Assembled | Owns |
|---|---|---|---|
| Pods | `PodDeployment` | `Pods.create(podDeployment, { registry, tags? })` | which components exist (descriptions, not instances); a scoped lookup |
| Runtime | `RuntimeDeployment` | `Runtime.create(id, runtimeDeployment, pods)` | which pods are placed together and how they are wired; the boundary messages are policed and recorded in |
| Application | `AppDeployment` | `Application.create(runtimes, opts)` | the live system: instances, mounting, routing, change, closing |

`Pods` and `Runtime` are cheap and inert: assembling them builds nothing, gives no pod a context and sends nothing.
`Application.create` is the one step that makes it live, so there is no `start()` and no type that changes mode.

```ts
const pods = ok(Pods.create(podDeployment, { registry }))          // [a, b, c, d, e]: descriptions only
const chat = ok(Runtime.create('chat', chatDeployment, ok(pods.select(['a', 'b', 'c']))))
const support = ok(Runtime.create('support', supportDeployment, ok(pods.select(['c', 'd', 'e']))))
const app = ok(await Application.create({ chat, support }, { timeoutMs: 5000 }))   // mounts; 'c' is one instance
// from data in one step (loading a nano.json):
const app2 = ok(await Application.create(ok(assemble(appDeployment, registry)), {}))
```

## Data

```ts
type PodDeployment = Record<PodName, Pod>                     // Pod = { implementation, config?, eager }
type RuntimeDeployment = { pods: PodName[]; subscriptions: Subscription[]; policy?: 'allow-all' }
type AppDeployment = { pods: PodDeployment; runtimes: Record<RuntimeId, RuntimeDeployment>; tags?: Record<PodName, string[]> }
type Subscription =
  | { kind: 'call'; from: PodName; to: PodName }                                   // a call edge
  | { kind: 'pipe'; from: PodName; source: Port; to: PodName; target: Port }       // a pipe
```

`AppDeployment` is the previous `Deployment` with the subscription kind `'event'` renamed `'pipe'`; `nano.json` is an
`AppDeployment`.

### Two kinds of subscription, both designed

- **Call edges** say which pods a pod's code may reach. A handler's `ctx.one(DB)` chooses among its own call edges
  that match the selector. The edge is the swap point: a packaged application ships `app → db`, and a user points
  the edge at their own database without the code changing.
- **Pipes** connect an operation's output to an action's input, outside any component's code. A pipe's **source**
  is an **event** of `from`, or an **action** of `from` (its successful results); its **target** is an action of
  `to` whose input fits the source's data. A packaged application can expose its pieces this way: `save` results
  piped to a logger, selection events to another application, a status pod monitored.

### Validation, per level

- `Pods.create`: names follow the id rule; every implementation is in the registry (`not-found`); every config fits
  its implementation's schema; at most 5000 pods; `tags` (`Record<PodName, string[]>`) name only its pods
  (`invalid-input` otherwise), and `select` keeps the selected pods' tags.
- `Runtime.create`: every placed pod is in the given `Pods` (so a runtime cannot place what it wasn't given); every
  subscription's ends are placed here; no duplicates; ports exist and fit (above); a call edge's target provides an
  interface `from` declares as a dependency, when it declares any; at most 2000 subscriptions.
- `Application.create`: at most 50 runtimes; runtime ids follow the id rule; every runtime's pods come from one
  `Pods` (the same name means the same pod everywhere, `invalid-input` otherwise).
- `assemble(appDeployment, registry)`: `Pods.create` of `pods` with `tags`, then for each runtime `Runtime.create(id, def,
  pods.select(def.pods))`. Pure; the first failure is returned.

## Assembled values

```ts
type Pods = {
  names(): PodName[]                            // in deployment order
  get(name: PodName): Pod | undefined
  select(names: PodName[]): NanoResult<Pods>    // a scope; unknown name → not-found
  deployment(): PodDeployment
}
type Runtime = { readonly id: RuntimeId; readonly pods: Pods; deployment(): RuntimeDeployment }
```

Both are immutable. A `Pods` from `select` is a view of the same descriptions: a pod in two scopes is one pod.

## The live Application

```ts
type Application = {
  call(runtime: RuntimeId, pod: PodName): Client     // host call: a message from 'host' in that runtime
  apply(next: AppDeployment): Promise<NanoResult<void>>
  restart(pod: PodName): Promise<NanoResult<void>>
  deployment(): AppDeployment                        // a copy; save = JSON of it
  listen(fn: (e: AppEvent) => void): () => void      // every event carries `runtime` where it has one
  close(): Promise<NanoResult<void>>
}
```

`Application.create(runtimes: Record<RuntimeId, Runtime>, opts: { policies?: Record<RuntimeId, Policy>; timeoutMs?:
number })`. Everything the previous spec says about creating, building, `restart`, `apply` (with an `AppDeployment`),
`close`, closing an instance and `addOnCloseListener` stands. In particular:

- **Mounting is the factory.** `make(ctx, config)` runs when a pod is first needed, or during `create`/`apply` for an
  eager pod. That is when the pod receives its context, and when the subscriptions it makes in code start.
- A pod's runtimes are worked out from the runtimes it is placed in; a pod placed in no runtime is never built.
- Instances are application-wide: one per pod name.

## The context, selections and subscriptions in code

| Context member | What |
|---|---|
| `self`, `runtimes` | the pod's name; the runtimes it is placed in (read live) |
| `one(selector)` | `Selection`: the single matching call edge from `self` across its runtimes; none → a failed selection (`not-found`), several → a failed selection (`ambiguous`) |
| `all(selector)` | `Selection[]`: every matching call edge, in deployment order (each one ok) |
| `publish(op, data)` | emits an event of `self` |
| `addOnCloseListener(fn)` | runs `fn({ reason })` when this instance closes |

```ts
type Selection<I> = {
  readonly ok: boolean
  readonly fail?: Fail                              // set when not ok
  readonly pod?: PodName                            // set when ok
  readonly runtime?: RuntimeId                      // the runtime of the edge it was selected through
  readonly call: Client<I>                          // calls go through that edge, policed and recorded there
  on(op: Op, fn: (data: unknown) => void): () => void   // hear that pod's event, or its action's results
}
```

A selection is its own result, so a call site can check or not:

```ts
const db = ctx.one(DB)
if (!db.ok) return { ok: false, fail: db.fail! }   // explicit check, or
return db.call.save(x)                            // fluent: on a failed selection every call resolves to its Fail
```

On a failed selection, `call.<op>(…)` resolves to the selection's `Fail` and `on` does nothing and returns a no-op
unsubscribe. Nothing is ever thrown.

- `on` is a subscription made in code. It hears `op` (an event of the selected pod, or one of its actions) for as long
  as the subscribing instance lives: it is removed when that instance closes, or by the function it returns. It is
  not part of any deployment. Each delivery is a message in the selection's runtime, policed and recorded.
- `fn` may be async; it isn't awaited by the emitter. A throwing `fn` is a `failure` on the stream.
- `one`, `all` and the selections read the deployment as it is now; a selection whose edge was removed by `apply`
  gives `not-found` on its next call, and its `on` subscriptions stop.

## Emitting

An **emission** is an event published by a pod, or the successful result of one of its actions, whoever called it.

- An emission is delivered along every pipe from that pod and operation, and to every `on` subscription to it, in
  **every runtime the pod is placed in**, each delivery a separate message policed and recorded in its runtime.
- The caller of an action gets its result as usual and does **not** wait for deliveries. Failed results are not
  emitted.
- Delivery order follows deployment order (runtimes in order, then pipes in order), then `on` subscriptions in the
  order they were made.

## Messages and the stream

Message kinds: a **call** (from the host or through a selection), a **pipe** delivery and an **on** delivery. Every
message travels in exactly one runtime and is policed, checked against schemas, run with the timeout and recorded,
as before. `sent` gains `kind: 'call' | 'pipe' | 'on'`, and `cause` and `correlation`:

- **`correlation`** is the id of the first message of a chain; **`cause`** is the id of the message that led to this
  one. A host call starts a chain (`correlation` = its own id, no `cause`). A pipe or `on` delivery of an action's
  result is caused by that call. An event published from a component's code starts a new chain for now: which
  message a handler is serving can't be known without async context (see "Later").
- **Cycles are allowed.** Pipes may form loops (two components negotiating until one stops, by failing: failed results
  are not piped). The runtime records chains so that a monitor (hops per chain, calls per time window, raising an
  alert) can be added later without changing it.
- *Later, in its own spec:* chains carried implicitly through calls a component's code makes while handling a message
  (async context), so they continue rather than start anew. Events: `built`, `restarted`, `closed`, `applied { added,
removed, changed, rewired }`, `sent { id, runtime, kind, from, to, port, correlation, cause? }`, `delivered`, `denied`, `failure`,
`warning`.

## Behaviours (written as tests first)

1. `Pods.create` is pure data checking: an unknown implementation is `not-found`, a bad config `invalid-input`; nothing
   is built.
2. `pods.select(['a', 'c'])` scopes the lookup: `names()` is `['a', 'c']`; selecting an unknown name is `not-found`.
3. `Runtime.create` refuses a deployment placing a pod outside its `Pods` (`invalid-input`), and nothing is built.
4. A pod selected into two runtimes is one instance after `Application.create` (a counter continues across both).
5. A runtime's code cannot reach a pod outside its scope: no call edge can name it, and `app.call` there is `not-found`.
6. Swapping through an edge: the same `app` code saves to `db1`; after `apply` points `app → db2`, it saves to `db2`.
7. A pipe from an action's result: a host call to `app.save` returns its result, and the logger piped from `save`
   receives it as a separate `pipe` message; a failed `save` pipes nothing.
8. A pipe from an event delivers once per pipe, in every runtime the publisher is placed in.
9. `on` in code: a pod's factory runs `ctx.one(Store).on(Store.ops.saved, fn)`; a later `save` reaches `fn` as an
   `on` message in that runtime.
10. An `on` subscription stops when its instance restarts, and when the function it returned is called.
11. The caller of an action doesn't wait for slow pipe targets.
12. `assemble(appDeployment, registry)` + `Application.create` behaves as before for every earlier behaviour that
    still applies (the earlier suite, ported).
13. `deployment()` is the `AppDeployment` (pods, runtimes, tags); saving and re-assembling it gives an equivalent app.
14. A failed selection: `ctx.one(Missing).call.op(x)` resolves to the `not-found` Fail and `.on` does nothing.
15. A pipe cycle runs until a step fails: `a.save` → `b.check` → `a.save`, `b.check` failing on its third call, gives
    exactly three `b.check` deliveries, each `sent` carrying the host call's id as `correlation` and the previous
    message's id as `cause`.

## Open (my calls, flagged for the user)

- **No live runtime object.** The live system is the `Application`; host calls are `app.call(runtime, pod)` and a
  runtime's slice of the stream is `listen` filtered by `e.runtime`. The assembled `Runtime` is a value. (The previous
  spec's `app.runtime(id)` view is dropped, avoiding a second runtime type.)
- **Pods learn their runtimes from the data** at `Application.create`; `Runtime.create` doesn't write into the pods.
- **`assemble`** is the one-step path from an `AppDeployment` (loading `nano.json`).
- **Emissions reach every runtime the pod is placed in**, for action results as for events.
- **A selection is its own result** (`ok`/`fail`, as `NanoResult`), with `call` and `on` as no-ops on failure.
- **The caller doesn't wait for deliveries; only successful results are emitted.**
- **The subscription kind `'event'` is renamed `'pipe'`.**

## Later (not in this revision)

Subscribing to an action's input; `before`/`after`/`around` advice on actions; more selection verbs beyond `one` and
`all` (`each`, `any` and fallback stay a few lines of ordinary code over `all` for now).
