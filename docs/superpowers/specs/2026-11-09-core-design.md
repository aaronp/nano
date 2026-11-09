# @composable/core — design

## Intent

Lift ordinary code (a variable and the functions over it, a class, an existing API) into named coordinates that
other code can call, publish from, subscribe to and observe, without the lifted code changing shape. The core is a
handful of single-purpose pieces, each small enough to read in one sitting. Everything else (connections,
workflows, the platform, UIs) is built *on* it, in other packages, as ordinary components.

Success: each area (data, component, registry, runtime, env) has a few operations in one file of ~50–100 lines
(never over ~200; the core as a whole may be larger), each type carries a 1–2 line comment stating its
**purpose and responsibility** (not how it works), and a set of example tests reads as the user guide.

## Goals

- Wrap plain functions: creation (`make`) and invocation (`action`), keyed by named coordinates.
- Store components in 0..n registries; a component learns which registries it is in.
- Invoke by coordinate + parameters through a runtime that can be swapped (in-process, remote, policy-enforcing).
- Every change to a registry is an ordinary event anyone can subscribe to.
- Example tests: counter lift, emits, subscribe/unsubscribe, observing a registry, one component in two
  registries, a policy runtime, a component registering a new op at runtime.

## Non-goals

- Changing `@composable/sdk` or the packages on it. This is **additive**: a new package, old code untouched.
- Decorators (`@component`, `@action`). They are sugar over the builder; later.
- Platform, Connections, Workflow — each its own later package and design (see Follow-ons).
- Views / web components.

## Anti-goals

- A file over ~200 lines (aim for 50–100), or a type whose comment needs a paragraph.
- Conveniences on the handle (`use`, `within`, `withX`), closed error-code enums, a state wrapper (`Model`),
  bindings/dependencies as a second wiring model, loop budgets in the core.
- The core depending on anything it does not need for its own job.

## The pieces

| File | Purpose |
|---|---|
| `data.ts` | Coordinates and plain data: `Op`, `Coord`, `Result`, `Event`, `Subscription`, `Delta`. |
| `component.ts` | `Component<A>`: how to make an `A`, and the actions over it. The builder. |
| `registry.ts` | `Registry`: one place holding instances by id, and subscriptions. Data only, plus change listeners. |
| `runtime.ts` | `Runtime`: invoke an action / publish an event by coordinate, given a registry. Swappable. |
| `env.ts` | `Environment`: a component instance's handles onto the registries it is in. |

### Data (decided)

- `Op = { ns, name, input?, output? }` — a named operation; `input`/`output` are TypeBox schemas, metadata only.
  Input+output = action, output only = source (publishable), input only = sink.
- `Coord = { registry: string, instance: string }` — where an instance lives.
- `Result<A> = { value: A } | { error: string, detail?: unknown }` — open error strings, no enum.
- `Event = { from: Coord, op: string, data: unknown, correlation?: string }` — what `notify` publishes.
- `Subscription = { id, source: string | '*', op: string, listener: string, target: string }` — a named
  connection: when `source` publishes `op`, call `listener`'s `target` action with the data. Plain data.

### Component (decided)

```ts
const counter = Components.create({ ns: 'com.acme', name: 'counter' }, () => new AtomicInteger(0))
  .action(Updated, c => c.get())                         // a source's action reads the current value
  .action(Inc, c => c.incrementAndGet(), { emits: [Updated] })
```

- `action(op, fn, opts?)` adds or replaces and reports `'added' | 'replaced'`. Actions may be added at runtime.
- `fn(instance, arg, env)` returns `A | Promise<A>`; a thrown error becomes `{ error }`.
- `emits`: after the action runs, for each emitted op, run *that op's* action and publish its result. So what is
  published may differ from what the action returned. A source with no action is published only by `env.notify`.
- `make(env?)` runs **once per instance**, not once per registry.

### Registry (decided)

Holds `instanceId → { component, value, env }` and the subscriptions. The same instance can be added to several
registries. It is itself a component (actions `add`, `remove`, `subscribe`, `unsubscribe`, `snapshot`) and emits
deltas from its own coordinate: `instance-added`, `instance-removed`, `op-added`, `op-removed`,
`subscription-opened`, `subscription-closed`. Observing a registry = subscribing to it; there is no separate
`observe`/`updates` API.

### Runtime (decided)

`Runtime = { call(from: Coord, target: string, op: string, arg): Promise<Result>, notify(event: Event): Promise<Result[]> }`.
`notify` delivers to every matching subscription by calling the listener's target action. A policy runtime wraps
another runtime (e.g. "you may only subscribe/unsubscribe yourself": checks `from.instance === listener`).
A remote runtime implements the same two functions over a message channel.

### Environment (decided)

A set of handles, one per registry the instance is in. Handle = `{ coord, notify(op, data, correlation?), call(target, op, arg) }`.
`Environment` gets `added(handle)` / `removed(handle)` as membership changes, fans `notify` out to every handle
(one `Result` per registry), and `register(op)` / `unregister(op)` which surface as `op-added`/`op-removed`.

## Settled by Claude, not by the user (check these)

- **Package:** `packages/core`, `@composable/core`, tests with `bun test`. TypeBox is its only dependency.
- **One runtime serves one registry.** A call's `target` is an instance id in that registry. The core has no
  cross-registry calls or subscriptions: a component reaches several registries by being in each of them, through
  its handles.
- **The registry is an instance inside itself**, under the reserved id `registry`. Its deltas go out through the
  ordinary `notify` path from `{ registry: <id>, instance: 'registry' }`, so policy runtimes see them too.
- **Subscriptions are local to one registry.** `source` is an instance id or `'*'`, and `'*'` also matches the
  registry's own deltas. The `listener` must exist when subscribing; the `source` need not exist yet, so wiring can
  come before components arrive. Removing an instance closes its subscriptions as listener.
- **Environment lifecycle:** `make(env)` may run with no handles yet. The registry calls `env.added` on add and
  `env.removed` on remove. `notify` with no handles returns `[]`.
- **Failures are isolated.** Deliveries run in order. One failing listener does not stop the others; each gets
  its own `Result` in `notify`'s array. An emit that fails does not undo or fail the action that triggered it,
  because the action already happened. The emit's error is reported in the action's result.
- **Typing:** `Op<I, O>` carries TypeBox schemas, and `action` infers `arg` and the return type from them through
  `Static`.

## Builder's calls (decide in the plan)

- Schema validation of `arg`/`data` against `Op` schemas: in the in-process runtime if it fits the line budget,
  otherwise a policy wrapper.
- Delivery order and sync/async details; how `correlation` is propagated through emits.
- Exact names of the builder functions, as long as each has its purpose comment.

## Follow-ons (separate packages, separate designs, built only on core)

- **Platform** — a component over a root registry: `create-registry`, `register-registry`, `list-registries`,
  `registries-of(instance)`; its index is built by subscribing to each registry's deltas.
- **Connections** — a CRUD component managing `Connection` tuples (named pairs of coordinates); told the list of
  existing component coordinates; can add mapping components on the fly.
- **Workflow** — subscribes to the connection list and to registry state; applies connections by calling
  `subscribe`/`unsubscribe`. Indifferent to whether a user or a program drives it.
