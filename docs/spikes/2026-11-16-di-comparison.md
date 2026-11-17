# Spike: contract-first DI and an observable runtime, four ways

*2026-11-16. The same nine-step scenario (`spikes/di/SCENARIO.md`) built four times; code and per-candidate reports in
`spikes/di/<candidate>/` (untracked, throwaway). Scores are each builder's own, 1–5, with evidence in its report.*

The scenario: a `KeyValueStore` contract with a `changed` event; two implementations; a `TodoList` that gets the
store as a typed dependency; wiring as JSON; every call observed; a subscriber; a live swap by changing data; TodoList +
store packaged as one bigger component; a new store loaded by URL.

## Scores against the user's criteria

| Criterion | nano today | plain TS (no framework) | Effect 4.1 | InversifyJS 8.3 |
|---|---|---|---|---|
| 1. Type safety, write to interfaces | 4 | 4 | **5** | 2 |
| 2. Minimal framework, easy to reason about | 4 | **5** | 2 | 2 |
| 3. Dynamic deployment, subscriptions, observability | **4** | **4** | 3 | 2 |
| 4. Package tiny components, import/deploy | 3 | 3 | 3 | 3 |
| 5. Performant, lightweight | 3 | 4 unchecked / 2 checked | 2 | 3 |
| 6. Composable | 4 | 4 | **5** | 4 |
| 7. Avoids foot-guns (data, messages, isolation) | **4** | 3 | 2 | 2 |
| 8. Few moving parts, single responsibilities | 4 | **5** | 3 | 2 |

| Measure | nano today | plain TS | Effect | Inversify |
|---|---|---|---|---|
| Lines written (non-test) | ~212 | 71 mechanism + 91 | 154 | 148 (~100 working around it) |
| Concepts to learn | ~11 | 4 | ~10, each large | ~10 |
| Browser bundle, gzip | 51.6 KB | 40.7 KB (mechanism ~3 KB; rest TypeBox) | 149 KB | 26.7 KB (no runtime checks) |
| Call through runtime vs direct | ~8× | 17× checked, **1.1× unchecked** | ~8–10× | ~2.6× (no checks) |
| Wiring as data, live swap | built in | ~71 lines | hand-written | hand-written |

## What the four agree on

- **Depend on none of them.** Every builder said no, including Effect and Inversify about themselves: steps 4, 7
  and 9 (wiring as data, live swap, loading by URL) were hand-written in both, and that's the part nano exists for.
- **Live swap means resolving through a stable handle on every call.** All four converged on it (Effect's
  "switchboard", Inversify's re-resolving facade, plain's Proxy). nano already routes by pod name and `plain()`
  resolves per call, so this confirms the model rather than changing it.
- **Wiring must be data the running system can hand back.** Only nano does this natively. Effect layers and Inversify
  containers are code and can't be read back.
- **The call cost is the checking, not the routing.** Plain TS is 1.1× without TypeBox's interpreted `Value.Check` and
  17× with it. nano's 8× is mostly the same checks.

## What to copy into nano

1. **The type comes from the contract, written once** (Elysia/Eden, TypeBox `Static`): `Interface.Type<typeof api>`
   in place of a hand-written twin. Let `Op.action` take a bare TypeBox schema, so trivial ones (`Nothing`, `Title`)
   need no name.
2. **Dependencies in the types** (Effect's `Layer<Provides, Err, Requires>`): an implementation's declared roles reach
   `make` as typed plain objects (`make: ({ store }) => todoList(store)`), so a missing or wrong dependency is a
   compile error, and nobody writes `ctx.one(...)` or `plain(...)`.
3. **Plain objects in, plain objects out**: `make` returns a plain object, lifted by nano (today's example
   `handlers`); callers get plain objects (`plain`). A typed `app.call` and a typed event publish.
4. **Observation**: input and event data on the stream; the host can subscribe to a pod's events; an inner
   application's calls reach the outer stream (both nano and plain lost them).
5. **Faster checks**: compiled TypeBox validators, so the boundary stays checked and the cost drops.
6. **Packaging**: nano loads `modules` itself; a contract lives in its own small module that implementations import.

## What to avoid

- Effect's `Effect<A, E, R>`/generator model as the user-facing contract: callers can't hold a plain `TodoList`.
- Lazy subscriptions: in Effect a listener started just before a `put` missed it. `on` must be live when it returns.
- Decorators and `reflect-metadata`; singletons captured at injection (they go stale on a rebind).
- Matching contracts by bare name strings (plain TS did; nano has coordinates and op hashes).
- A container or layer graph as the source of truth: the deployment data is.

## Recommendation

Keep nano's model (it scores best on 3, 7 and wiring-as-data, which nothing else has) and give it the surface the
others show is possible: items 1–3 make it feel like plain TypeScript with Effect's typed dependencies, items 4–6 close
the gaps the spike measured. Each is a small, separate step.
