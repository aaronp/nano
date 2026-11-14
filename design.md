# Design: the nano model

Spec: `docs/superpowers/specs/2026-11-14-values-and-application-design.md`. Decisions: `docs/decisions.md` (cited as D<n>;
D70 on are this model). Worked examples: `examples/external-signer`, `examples/messenger` (each with its `nano.json`),
`examples/etl`, `examples/migration`.

Nano is an event-driven RPC and pub/sub system made of plain values and one live `Application`. Everything is a
synchronous value except the `Application`, which alone runs effects (D70).

## Values and the live Application

Each has one responsibility and one file in `packages/nano/src`; each file opens with a comment and an example.

| What | Responsibility | File |
|---|---|---|
| Schema | a TypeBox schema (`SchemaDef`, from `defineSchema`) with its blake3 `hashOf` (annotations stripped, `canonical`, `canonicalSchema`) and JSON codec; `isJson` refuses non-JSON schemas | `schema.ts` |
| Op | an action (in, out) or an event (data out) (`Op`, `OpKind`, built with `op`); coord = hash of name + schema hashes; `fits` checks an event against an action | `op.ts` |
| `Interface` | a coord (`ns/name`; the `COORD` rule) plus its ops (`iface`); `port(i, op)` = `<interface>/<op name>`; `Client` is a typed client for one (actions only) | `iface.ts` |
| Result | `NanoResult` = `success` or a platform `Fail` (`failure`, `FailType`); never thrown; `isNanoResult` | `result.ts` |
| `Implementation` | code providing whole interfaces (`implementation`), with dependencies (selectors by role) and an optional config schema; its factory `make(ctx, config)` returns `Provided` (`provide(iface, handlers)`), each `Handler` taking only its input (`Handlers`) | `implementation.ts` |
| `Provider` | a namespace of implementations (`provider`) plus metadata | `provider.ts` |
| `Registry` | a pool of providers (`createRegistry`); O(1) lookups (`implementationsOf`); a plain-data `Manifest` | `registry.ts` |
| `Selector` | which call subscriptions a call may use: an interface, or `SelectorData` narrowed by tags, implementation, provider, `runtime` (`sel`, `selectorData`, `matches` over a `Target`) | `selector.ts` |
| Context | what a pod's factory gets (`NanoContext`): `self`, `runtimes`, `one`, `all`, `publish` | `context.ts` |
| `Pod` | a value `{ implementation, config?, eager }` from `Pod.lazy(impl, { config })` / `Pod.eager(impl)`; no state, methods or instance | `pod.ts` |
| `Policy` | `isAllowed(src, dest, data)` per runtime, answering a `Verdict`; `Policies.allowAll()` | `policy.ts` |
| `Pods` | which components exist: `Pods.create(podDeployment, { registry })` checks a `PodDeployment` (names, implementations, configs, at most 5000) into an immutable lookup, `names`, `get`, `select` (a scope over the same descriptions), `deployment` | `pods.ts` |
| `Runtime` | pods placed together and wired: `Runtime.create(id, runtimeDeployment, pods)` checks a `RuntimeDeployment` (pods placed, `Subscription`s, policy) over a `Pods` scope into an immutable `{ id, pods, deployment }` | `runtime.ts` |
| `AppDeployment` | the whole system as data: pods, runtimes by id, tags; `assemble(d, registry)` checks it level by level into its `Runtime`s, strictly (D83) | `deployment.ts` |
| `Application` | the one live thing: `Application.create(runtimes, { policies?, timeoutMs? })` (at most 50, ids by the id rule, every runtime's pods from one `Pods`) gives five members, `call`, `apply`, `restart`, `deployment`, `listen` (an `AppEvent` stream) | `application/` |

Inside `application/` (not exported from the package, one line each): `stream()` is the one stream and its ids;
`instances(live)` holds at most one build per pod name; `send` carries one message in one runtime and `client` calls
by op name over it, both reading a `Live` (the application as a message needs it); `refusal` is a runtime policy's
answer to a message or a new subscription (a throw, a Promise or no verdict refuses); `within` bounds a build or handler
by the timeout; `contextFor(live, name)` is a pod's `NanoContext`; `diff(a, b)` is what `apply` changes: pods added,
removed, changed, and runtimes rewired; `compose(runtimes)` is the application's deployment from its runtimes (the pods
they place, in their `Pods`' order, and the tags their `Pods` carry) and their registry.

Inside `pods.ts` (not exported from the package): `Id` is the id rule for pod names and runtime ids, `shapeError` the
first way a value breaks a level's shape, `originOf(pods)` where a `Pods` comes from: the registry it was checked
against (which `Runtime.create` resolves implementations with), the `Pods` it was selected from (one per application)
and, on that root, the tags `assemble` put there with `tag(root, tags)`. Inside `deployment.ts`: `RuntimeIds` is the
shape of a table by runtime id (the id rule, at most 50). Inside `runtime.ts`: `isRuntime(r)` is whether
`Runtime.create` made `r`.

## How it works

1. **Define.** Schemas, ops, interfaces; an implementation provides interfaces and may declare dependencies; a
   provider groups implementations; the registry holds providers (`examples/*/interfaces.ts`, `providers.ts`).
2. **Describe.** `Pod.lazy(impl, { config })` or `Pod.eager(impl)` is a value holding the implementation's coordinate
   (D85). An `AppDeployment` names pods, places them in runtimes (a pod may be in several), and lists each runtime's
   subscriptions, in order: a call edge `{ kind: 'call', from, to }` or a pipe `{ kind: 'pipe', from, source, to,
   target }`, whose source is an event or an action (its results) of `from` and whose target an action of `to` that
   fits it; pipes may form cycles. Each level checks its own part: `Pods.create` names, implementations (in the
   registry), configs and 5000 pods; `Runtime.create` that every pod it places is in its scope, every subscription's
   ends are placed in it, ports exist and fit, and 2000 subscriptions; `assemble` 50 runtimes and their ids (D75, D78).
3. **Create.** `Application.create(runtimes, opts)`, or `Application.create(assemble(d, registry).value, opts)` from
   data, validates (an invalid input is a `Fail` and nothing runs), builds every eager pod, and resolves once those
   settle. A failed eager build is a `failure` on the stream, not a failed `create`.
4. **Build.** One instance per pod name, made by the factory on first need, once: concurrent first calls share the
   build. A factory that throws, rejects or times out fails the call that needed it and caches nothing, so the next
   call builds again. State is whatever the factory closes over (D71).
5. **Call.** `app.call(runtime, pod).op(input)` is a message from `'host'` in that runtime. A handler reaches others
   through the `ctx` its factory closed over: `ctx.one(selector)` is the single matching call subscription from the
   pod (`not-found` or `ambiguous` otherwise), `ctx.all(selector)` every one, in deployment order (D86); both read the
   deployment now, across every runtime the pod is placed in, and a selector's `runtime` narrows them.
   `ctx.publish(op, data)` delivers along every pipe from the pod with that source, in every runtime it is in.
6. **Message.** Each message travels in exactly one runtime, that of the subscription it uses: policed by its policy
   (a throw, or no `Verdict`, denies, D82), input checked, run under the timeout, output checked, and recorded: `sent`,
   then `delivered` or `denied`. A handler never throws across this boundary: a throw, a timeout, bad input or bad
   output is a `Fail` (D76).
7. **Change.** `app.apply(next)` validates `next`, asks each affected runtime's policy about each added subscription
   (`isAllowed(from, to, 'subscribe')`), then applies everything or nothing: pods added (eager ones built), removed
   (instances forgotten), changed (restarted with the new value), subscriptions added, removed, reordered; one
   `applied` event. `app.restart(pod)` forgets an instance (an eager pod rebuilds at once); calls in flight finish on
   the old one (D77). `apply` drops pods that no runtime places. An application created from no runtimes has no
   registry, so `apply` naming any implementation is `not-found`.
8. **Watch.** `app.listen(e => …)` is the one stream, in order and synchronously, and returns an unsubscribe: `built`,
   `restarted`, `applied`, `sent`, `delivered`, `denied`, `failure`, `warning`. A throwing listener is swallowed (D79).
9. **Save.** `app.deployment()` is the current value (the pods placed in some runtime, the runtimes, and the tags
   `assemble` carried in); saving is its JSON, and `assemble` + `Application.create` on it gives an equivalent
   application (D74).

## FAQ

**Values vs live?** `Pod`, `AppDeployment`, `Subscription`, `Selector`, `Policy`, `Registry` and the rest are plain
data or plain lookups, and `Pods` and `Runtime` are inert values (frozen, with methods); only the `Application` does
anything with effects. You have a running `Application` from `Application.create(runtimes)`, or you have values.
There is no `start()` and no type that behaves differently by mode (D70).

**Lazy vs eager?** `Pod.lazy` is built on its first call, like `IO`: describing costs nothing. `Pod.eager` is built
when it is in an application (at `create`, or when `apply` adds it): use it for a pod that starts a timer or opens a
socket in `make`, since the factory is the mount (D72). Calling through another pod builds a lazy one on the way.

**Restart and state?** Nano holds no component state. A pod's state is its factory's closure (`let n = 0`, a REST
client), so `restart` gives a fresh closure: a counter at 2 answers 1 next. Anything that must survive is a storage
component behind an interface (D71, D73).

**Sharing a pod across runtimes?** Place its name in several runtimes' `pods`. It has one instance, `ctx.runtimes`
names every runtime, and its wiring stays where the subscriptions are. The messenger's `send` is wired to `db` only
in `messaging` and placed in `chat` and `support`: a send from `chat` reaches `db`, recorded in `messaging`, and
`app.call('chat', 'db')` is `not-found` (D75, `examples/messenger/send.test.ts`).

**Cross-runtime calls and the `runtime` selector?** `ctx.one`/`ctx.all` search the pod's call subscriptions in every
runtime it is in. ETL: `etl` is wired to `source` in `foo` and to `sink` in `bar`, reads and writes with no runtime
named in code, each call recorded in its own runtime (`examples/etl`). Migration: with a `db` wired in `v2` and `v3`,
`one(DB)` is `ambiguous`, and `sel(DB, { runtime: 'v2' })` picks one (`examples/migration`, D86).

**What does saving write?** The `AppDeployment`: pods (implementation coordinate, config, eager), runtimes (pods placed,
subscriptions in order, policy), tags. Not instances, not state, not custom policies (they come in `opts.policies`,
D80), not the registry. `nano.json` is one, serialised.

**Strict validation?** An invalid deployment (including one naming an unknown implementation) fails as a whole with
the reason, in `create` and `apply`; nothing half-runs. A document with a missing provider loads once the provider is
added to the registry (D83). A call subscription is checked against the caller's declared dependencies only when
they name an interface (D87).

**Storage and messaging?** Components. Key-value stores, CRUD, queues, REST bridges are pods behind interfaces, chosen
per environment; policies, enrichment and restriction between them are compute pods. Nano only routes, polices and
records (D73). A component adapts to what is plugged in by testing `ctx.all(S).length` or `ctx.one(S).ok`.

**Pods that call each other while building?** Don't: a factory should not wait on another pod during `make`. Two that
do both wait on each other and fail by timeout (D84).

**Where do domain failures go?** In the op's output, as values: the signer's `{ status: 'denied' }`, the composer's
`{ status: 'disabled' }`. `Fail` is for platform failures (`threw`, `timeout`, `denied`, `invalid-input`,
`invalid-output`, `unknown-op`, `ambiguous`, `not-found`).

**Where do binary values go?** Base64 strings in the schema (D2); the signer's keys and signatures.
