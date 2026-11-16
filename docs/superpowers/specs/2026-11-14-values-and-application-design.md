# Nano: values and a live application

> **Revised (2026-11-14)** by `2026-11-14-pods-runtimes-application-design.md`: per-level deployments (`Pods`,
> `Runtime`, `Application.create(runtimes)`), pipes (from events and action results) and selections. Where they
> differ, that document wins; in particular there is no live `app.runtime(id)` view.
*Decided with the user on 2026-11-14; live runtimes, `app.close()` and close listeners added the same day. Supersedes the model of `2026-11-13-runtime-model-design.md` (its domains,
"How they work together", "The pod is the effect boundary", Application, Provisioning and saving sections) wherever
they disagree. That document stays as history; `design.md` is rewritten from this one.*

## Why

Nano is an event-driven RPC and pub/sub system. The smaller it is, the more powerful and flexible it is: easy to
reason about, few foot-guns around state, and a set of small, observable, queryable data structures with one
responsibility each, loosely coupled and highly cohesive.

The last two revisions spent most of their machinery, and most of their bugs, on three things this revision removes:

- **per-runtime coordinate counters** (`<impl>#<n>`, saved and restored `next`, never-reuse, remembering what was
  unregistered);
- **lazy, on-demand starting** (define, start, definition, a shared pod table, a root runtime, nesting, adoption);
- **pods owning a lifecycle** (instance state, `join`, `starting`, timeouts at creation, swap races, dispose).

## Principles

1. **Values, then one live thing.** Everything is a plain, synchronous value except the `Application`, which is the
   only thing that runs effects. There is no `start()` to remember and no type that behaves differently by mode: you
   get a running `Application` from `Application.create(deployment)`, or you have only values.
2. **State is a closure.** A component's state is whatever its factory closes over (`let n = 0`, a REST client). Nano
   holds no component state, only routing data. Restarting a pod gives a fresh closure.
3. **Lazy by default, like `IO`.** Describing a pod costs nanoseconds; its factory runs when first needed.
4. **Storage and messaging are components.** Key-value stores, CRUD APIs, queues and REST bridges are pods behind
   interfaces, chosen per environment. Flows between them (policies, enrichment, restriction) are compute pods. Nano
   implements none of them; it only routes, polices and records.
5. **The data is the truth.** A `Deployment` value describes the whole system; the application reconciles to it, and
   what it reports is exactly what runs. Every message and change is on one stream.

## Values

| Value | What it is | Identity |
|---|---|---|
| **Schema** | a TypeBox schema with a hash over its canonical form and a JSON codec | its hash |
| **Op** | an **action** (input → output) or an **event** (data out). A former "sink" is an action whose output is `Null` | hash of name and schemas |
| **Interface** | a coordinate plus named ops | `ns/name` |
| **Implementation** | code providing whole interfaces: `{ coord, provides, dependencies?, config?, make }` (below) | `<provider>/<name>` |
| **Provider** | a package of implementations plus metadata | `<author>/<name>` |
| **Registry** | a pool of providers with O(1) lookups and a manifest | — |
| **Pod** | `{ implementation, config, eager }`: a description of one component, no instance | its name in a deployment |
| **Deployment** | the whole system as data (below); `nano.json` is a deployment, serialised | — |
| **Subscription** | an edge inside one runtime of a deployment: a call edge or an event edge between two pod names | its content |
| **Selector** | which subscriptions a call may use: an interface, optionally narrowed by `tags`, `implementation`, `provider` or `runtime` | — |
| **Policy** | `isAllowed(from, to, data)` per runtime | — |

A **port** is an op as offered by an interface and is written readably, `<interface>/<op name>`
(`example.messenger.KeyValueStore/put`); op hashes are used only to check that two ports fit.

### Implementation and its factory

```ts
const counter = Implementation.define('acme/counter', {
  provides: [Counter],
  dependencies: { store: KeyValueStore },          // data: for display and checking wiring
  config: CounterConfig,                           // optional schema; a pod's config must fit it
  make: (ctx, config) => {                         // the factory: runs lazily, once per build
    let n = config.start                           // state is a closure
    return [provide(Counter, {
      inc: async () => success(++n),               // handlers take only their input
      save: async () => {
        const kv = ctx.one(KeyValueStore)           // NanoResult<Client>, read from the deployment now
        return kv.ok ? kv.value.put({ key: 'n', value: String(n) }) : kv
      },
    })]
  },
})
```

- `make(ctx, config)` may be async (a client that authenticates). Handlers take their input only; they reach the
  world through the `ctx` the factory closed over.
- The factory **is** the mount: an eager pod that starts a timer or opens a socket does it in `make`.

### Pod

```ts
Pod.lazy(counter, { config: { start: 0 } })   // built on its first call
Pod.eager(ticker)                             // built as soon as it is in an application
```

A pod is a value: `{ implementation: string, config?: unknown, eager: boolean }`. Two equal values are the same
description. It has no state, methods or instance.

### Deployment

```ts
type Deployment = {
  pods: Record<PodName, Pod>
  runtimes: Record<RuntimeId, {
    pods: PodName[]                       // which pods are placed here; a pod may be in several runtimes
    subscriptions: Subscription[]          // in order; order is what `all` returns
    policy?: 'allow-all'
  }>
  tags?: Record<PodName, string[]>
}
type Subscription =
  | { kind: 'call'; from: PodName; to: PodName }
  | { kind: 'event'; from: PodName; source: Port; to: PodName; target: Port }
```

- A **pod name** is unique in the deployment and the same in every runtime the pod is placed in. Names are chosen
  by whoever writes the deployment (`'db'`, `'send'`); reusing a name for a different pod later is allowed and
  harmless, since removing a pod removes the subscriptions naming it.
- A **runtime** is a named section of the deployment: the pods placed there, the subscriptions between them, its
  policy. It is the boundary a message is policed and recorded by. It is not an object with methods.
- A subscription's two ends must be placed in that runtime. A subscription has no id: it is identified by its
  content, and a runtime holds no duplicates.
- **Valid** means: every runtime's pods are in `pods`; every subscription's ends are placed in its runtime; ports
  exist and fit (an event's source is an event of `from`'s implementation, its target an action of `to`'s taking that
  data; a call's target provides an interface `from` declares as a dependency, when it declares any); every
  implementation is in the registry; every config fits its implementation's schema; limits hold (at most 50
  runtimes, 5000 pods, 2000 subscriptions per runtime). *(Strict validation: my call, see "Open".)*

## The live Application

```ts
const r = await Application.create(deployment, { registry, policies?, timeoutMs? })   // NanoResult<Application>
const app = r.value
const chat = app.runtime('app')              // the live runtime: Runtime | undefined
await chat.call('counter').inc()             // from 'host', policed and recorded by runtime 'app'
await app.apply(next)                        // reconcile to a new deployment value
await app.restart('counter')                 // close its instance; eager pods rebuild now
app.deployment()                             // the current value (save = JSON of it)
app.listen(e => …)                           // the whole stream; returns an unsubscribe
await app.close()                            // NanoResult<void>: close every instance; the application is finished
```

**Data and its materialisation.** A `Deployment` is data; an `Application` is its materialisation. Each
`deployment.runtimes[id]` (data) materialises as a live `Runtime`, `app.runtime(id)`; each `Pod` (data) materialises
as an instance, built lazily or eagerly. Instances are application-wide: a pod placed in three runtimes is one
instance, so building, restarting and closing belong to the application, while a `Runtime` is the boundary messages
travel through.

`Application` has exactly these six members (`runtime`, `apply`, `restart`, `deployment`, `listen`, `close`). `policies` supplies custom `Policy` functions by runtime id (a
deployment can only name `'allow-all'`, the default). `timeoutMs` (default 30 000) bounds each build and each handler.

- **`create`** validates the deployment (an invalid one is a `Fail`, `invalid-input` or `not-found`, and nothing
  runs), then builds every eager pod and resolves once those builds have settled. A failed eager build does not fail
  `create`: it is a `failure` on the stream, and the pod builds again on its first call.
- **Building.** One instance per pod name per application. The factory runs on first need (a call, or eagerness),
  once: concurrent first calls share the same build. A factory that throws, rejects or times out fails the call that
  needed it (`threw` / `timeout`, also a `failure` on the stream) and caches nothing; the next call tries again.
- **`restart(name)`** closes the pod's instance (reason `'restarted'`, below), then rebuilds it at once if it is
  eager. Calls already in flight finish on the instance they started on. Unknown name → `not-found`.
- **`apply(next)`** validates `next`, asks each affected runtime's policy about each added subscription
  (`isAllowed(from, to, 'subscribe')`), and then applies everything or nothing: pods added (eager ones built), pods
  removed (instances closed with reason `'removed'`; their subscriptions are gone because `next` no longer has them),
  pods whose value changed closed with reason `'changed'` and rebuilt from the new value if eager, subscriptions added, removed and reordered. A refusal is `denied` with the
  reason and nothing changes. The changes are one `applied` event.
- **`runtime(id)`** gives the live `Runtime` for a runtime in the current deployment, or `undefined`.
- **`close()`** closes every built instance (reason `'closed'`) and resolves when their close listeners have settled.
  It is idempotent. After it, calls are `not-found`, `apply` and `restart` are `invalid-input` (`application is
  closed`), and nothing is built again.

### The live Runtime

```ts
type Runtime = {
  readonly id: string
  call(pod: string): Client                  // by op name; each call a message from 'host' in this runtime
  listen(fn: (e: AppEvent) => void): () => void   // this runtime's messages only (sent, delivered, denied)
}
```

A `Runtime` is a view of the live application through one runtime: its policy, its slice of the stream, and the
way in for the host. It holds no state of its own. `call` on a pod not placed here, or after the runtime was removed
by `apply` or the application closed, is `not-found`; an unknown op is `unknown-op`.

### Closing an instance

An instance is closed when it is forgotten: on `restart` (`'restarted'`), when `apply` removes its pod
(`'removed'`) or changes its value (`'changed'`), when its build fails (`'closed'`), and on `app.close()`
(`'closed'`). The factory registers what to do through a fixed, discoverable listener on its context:

```ts
make: (ctx, config) => {
  const timer = setInterval(tick, 1000)
  ctx.addOnCloseListener(({ reason }) => clearInterval(timer))
  return [provide(…)]
}
```

- The set of lifecycle events is **fixed**: `addOnCloseListener` is the only one now (opening is the factory
  itself). There is no generic `addEventListener` and no custom events; a new lifecycle event is a spec change, and
  follows the same `addOn<Event>Listener(fn)` pattern with its own event argument.
- The listener gets `{ reason: 'restarted' | 'removed' | 'changed' | 'closed' }`. It may be async; listeners run in
  the order added, each awaited and bounded by `timeoutMs`. One that throws or times out is a `failure` on the
  stream and doesn't stop the others.
- An instance is closed **before** its replacement is built, so a restart that rebinds a port doesn't clash.
- Calls already in flight on a closed instance keep running and are not waited for; they may find their resources
  closed.
- A listener added after its instance was closed runs at once.

### The context a factory gets

The context belongs to the pod, not to a call: handlers close over it, so it must be valid whichever runtime a call
came through.

| Member | What |
|---|---|
| `self` | the pod's name |
| `runtimes` | the runtimes the pod is placed in now (read live) |
| `one(selector)` | `NanoResult<Client>`: the single matching call subscription from `self`, across every runtime the pod is in; none → `not-found`, several → `ambiguous` (a selector's `runtime` narrows) |
| `all(selector)` | `Client[]`: every matching call subscription, in deployment order (runtimes in order, then subscriptions in order); `[]` when none |
| `publish(op, data)` | delivers to every event subscription from `self` with that source, in every runtime the pod is in |
| `addOnCloseListener(fn)` | runs `fn({ reason })` when this instance is closed (see "Closing an instance"); each build has its own context |

`one` and `all` are synchronous: they read the deployment as it is now. A client's calls are asynchronous. Fan-out,
fallback, "any" and "each" are ordinary code over `all`. A component adapts to what is plugged in by testing
`all(S).length` or `one(S).ok`.

### Messages

Every message, whether a host call, a call through a client, or an event delivery, travels in exactly one
runtime: the runtime of the subscription it uses (or the `Runtime` a host call went through). There it is:

1. **policed** by that runtime's policy (`isAllowed(from, to, data)`; a throwing policy denies);
2. **checked** against the op's input schema, then run with the timeout, then its output checked;
3. **recorded** on the stream: `sent`, then exactly one of `delivered` (result, ms) or `denied` (reason).

A handler never throws across this boundary: a throw, a timeout, bad input or bad output is a `Fail` (`threw`,
`timeout`, `invalid-input`, `invalid-output`). Domain failures are values in the op's own output.

### The stream

`built { pod }`, `restarted { pod }`, `closed { pod, reason }`, `applied { added, removed, changed }` (pod names and subscriptions), `sent
{ id, runtime, from, to, port }`, `delivered { id, result, ms }`, `denied { id, reason }`, `failure { pod?, reason }`,
`warning { reason }`. In order, synchronously; a throwing listener is swallowed.

## Behaviours (written as tests first)

1. A pod is a value: `Pod.lazy` and `Pod.eager` are plain data, and a deployment survives a JSON round trip unchanged.
2. `create` builds eager pods before it resolves and lazy pods only on their first call (`built` shows when).
3. Two concurrent first calls build a lazy pod once.
4. A factory that throws fails that call (`threw`) and the next call builds again; a failed eager build doesn't fail
   `create`.
5. `restart` gives a fresh closure (a counter at 2 answers 1 next), and a call in flight finishes on the old instance.
6. A pod placed in two runtimes has one instance; `ctx.runtimes` names both; a host call through each is recorded only
   on its own runtime.
7. Sharing: `send` placed in `messaging`, `chat` and `support`, wired to `db` only in `messaging`. A send from `chat`
   reaches `db`; its database call is recorded in `messaging`; `app.call('chat', 'db')` is `not-found`.
8. ETL: `etl` reads through `foo` and writes through `bar`, each call recorded in its own runtime.
9. Migration: with a `db` wired in `v2` and in `v3`, `one(DB)` is `ambiguous`; `one(Selector.of(DB, { runtime }))` picks one.
10. `publish` delivers once per event subscription, in every runtime the publisher is in.
11. A denying policy: the call fails `denied` and the stream shows `sent` then `denied`.
12. `apply`: an added subscription is usable at once; a removed pod's calls are `not-found`; a pod whose config changed
    answers from a fresh instance; a refused change applies nothing; `deployment()` equals the value applied.
13. A saved deployment creates an equivalent application (same answers to the same calls).
14. Handler misbehaviour: bad input, bad output, a throw and a timeout are each the right `Fail`, and the pod keeps
    serving.
15. An invalid deployment (a runtime placing an unknown pod, a subscription end not placed, ports that don't fit, an
    unknown implementation, a config that doesn't fit) fails `create` and `apply` with the reason.
16. A component adapts: with no store wired, `ctx.all(KeyValueStore)` is `[]` and it falls back.
17. A live runtime: `app.runtime('chat').call('send')` is recorded in `chat`; `app.runtime('chat').listen` sees only
    `chat`'s messages; `app.runtime('nope')` is `undefined`; a call to a pod not placed there is `not-found`.
18. `restart` runs the old instance's close listeners with `'restarted'` before the new instance is built.
19. `apply` closes a removed pod's instance with `'removed'` and a changed one's with `'changed'`; a rewire-only
    `apply` closes nothing.
20. `app.close()` closes every built instance with `'closed'` (lazy pods never built have nothing to close); after
    it, calls are `not-found` and `apply`/`restart` are `invalid-input`; a second `close()` does nothing.
21. A build that throws after adding a close listener runs it with `'closed'`.
22. A close listener that throws or hangs is a `failure` on the stream; the other listeners still run and `close()`
    still resolves.
23. A ticker started in `make` and stopped by its close listener stops ticking after `restart`.
24. Each close is a `closed { pod, reason }` event on the stream.

## Removed

Runtime objects and their methods, the root runtime and nesting, `adopt`, `define`/`start`/`definition`, notes,
coordinates `<impl>#<n>` and counters, instances as a concept, pod state, `join`, `swap`, `dispose`, books,
connections as a term, `EndSelector`, the verbs `optional`, `any`, `first`, `fallback`, `each`, provisioning, the
"sink" op kind, hashed port keys, `ctx.instance`, `ctx.runtime`, `ctx.config`, `hasDependencies`,
`listDependencies`, the handler's `ctx` parameter.

Provisioning may come back later as a pure function over values (`(deployment, registry, pod) → deployment`), never
as runtime behaviour.

## Open (my calls, flagged for the user)

- **The `closed { pod, reason }` stream event** (added with closing) and listeners running in the order added, each
  awaited with the timeout.

- **Strict validation.** An invalid deployment (including an unknown implementation) fails as a whole rather than
  loading what it can with notes. Simpler and nothing half-runs; it means a document from a marketplace with a missing
  provider doesn't load until the provider is added.
- **Builds that call each other.** A factory may call out while building. If two factories call each other while both
  are building, both wait on each other and fail by timeout. Factories should not call during `make` except to start
  work that doesn't wait on the answer.
- **Pods hold the implementation's coordinate**, resolved through the registry at `create`, so a pod value is plain
  JSON.
- **Subscription order across runtimes** for `all`: runtimes in deployment order, then subscriptions in order.

## Guardrails

Unchanged: no source file over 150 lines; no exported type over 10 members; every export in `design.md`; a new
concept, export or option is the user's call. The baseline shrinks with this revision.
