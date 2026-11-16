# Design: the nano model

Published as `@pritzlaff/nano-core` (0.4.0, replacing the 0.3 model); the folder is `packages/nano`.

Spec: `docs/superpowers/specs/2026-11-14-pods-runtimes-application-design.md`, and
`docs/superpowers/specs/2026-11-14-values-and-application-design.md` for what it does not revise. Decisions:
`docs/decisions.md` (cited as D<n>; D70 on are this model, D90 on are pods, runtimes and an application). Worked
examples: `examples/external-signer`, `examples/messenger` (each with its `nano.json`), `examples/etl`,
`examples/migration`, `examples/slice`.

Nano is an event-driven RPC and pub/sub system made of plain values and one live `Application`. Everything is a
synchronous value except the `Application`, which alone runs effects (D70).

## Three levels

| Level | Data | Assembled by | Owns |
|---|---|---|---|
| Pods | `PodDeployment` | `Pods.create(d, { registry, tags? })` | which components exist (descriptions, not instances); a scoped lookup |
| Runtime | `RuntimeDeployment` | `Runtime.create(id, d, pods)` | which pods are placed together and how they are wired; where messages are policed and recorded |
| Application | `AppDeployment` | `Application.create(runtimes, opts)` | the live system: instances, mounting, routing, change, closing |

`AppDeployment.assemble(appDeployment, registry)` goes from the whole data to the `Runtime`s in one step. `Pods` and `Runtime` are
inert: assembling builds nothing and sends nothing; `Application.create` is the one step that makes it live (D90).

## Values and the live Application

Every builder is `Noun.verb` (and `api.impl(coord)`, an implementation started from its contract), the value sharing its type's name: `define` for what you declare in source (`Schema.define`,
`Op.action`/`Op.event`, `Interface.define`, `Implementation.define`, `Provider.define`, `Selector.of`), `create` for what
is built at run time (`Registry.create`, `Pods.create`, `Runtime.create`, `Application.create`), plus
`AppDeployment.assemble` and `Pod.lazy`/`Pod.eager`. Helpers (`success`, `failure`, `port`, `fits`, `matches`, `hashOf`) stay
functions.

Each has one responsibility and one file in `packages/nano/src`; each file opens with a comment and an example.

| What | Responsibility | File |
|---|---|---|
| `Coord` | typed, layered coordinates, each a frozen value whose `toString()` is the saved string: `Namespace` (an author's), `InterfaceCoord` and `ImplCoord` (namespace + name), `PortCoord` (interface + op), `PodCoord` (implementation + runtime + pod, the instance); `Coord.namespace`, `Coord.port`, `Coord.pod`, `Coord.parse(kind, s)`; a namespace's `interfaceId(name)` and `implementationId(name)` are its coordinates, and (layer 2, added in `provider.ts` without coord.ts importing it) `ns.interface(name, ops)` is `Interface.define(ns.interfaceId(name), ops)` and `ns.provider(impls, meta?)` is `Provider.define(ns, impls, meta)`; `Interface.define` and `Implementation.define` take one or its string | `coord.ts` |
| `Schema` | a TypeBox schema (`SchemaDef`, from `Schema.define(schema, label?)`; the definition is itself the schema, so it nests in another directly; the label is optional and never hashed) with its blake3 `hashOf` (annotations stripped, `canonical`, `canonicalSchema`) and JSON codec; `isJson` refuses non-JSON schemas | `schema.ts` |
| Op | an action (in, out) or an event (data out) (`Op`, `OpKind`, built unnamed with `Op.action(input, output)` / `Op.event(data)`, each taking a `SchemaDef` or a bare TypeBox schema, defined unlabelled); the interface names each op by its key, and its coord = hash of that name + schema hashes; `fits` checks an event against an action | `op.ts` |
| `Interface` | a coord (`ns/name`; the `COORD` rule) plus its ops, named by key (`Interface.define`); `api.impl(coord)` starts an implementation from the contract it provides: a builder whose `needs(deps)`, `config(schema)` and `description(text)` (each optional, the first two typing the next step) and `make(({ deps, config, ...ctx }) => plain object)` (offered at every step) or `create({ needs, config, description, make })` end in `Implementation.define`, and whose result's `satisfies(otherApi, make)` adds another interface with its own plain object from the same build; `port(i, op)` = `<interface>/<op name>`; `Client` is a typed client for one (actions only); `Interface.Type<typeof api>` is the plain TypeScript interface (each action `(input) => Promise<output>`, a `null` input no argument, a `null` output `void`; each event a source, `() => AsyncIterable<output>`: on the consumer side the outputs emitted from its first iteration, and in a plain `make` an optional method nano runs once per build, publishing each value, stopped at close, a throw traced `failure` for the pod) | `iface.ts` |
| Result | `NanoResult` = `success` or a platform `Fail` (`failure`, `FailType`); never thrown; `isNanoResult` | `result.ts` |
| `Implementation` | code providing whole interfaces (`Implementation.define`), with dependencies (selectors by role) and an optional config schema; its factory `make(ctx, config)` returns `Provided` (`provide(iface, handlers)`), each `Handler` taking only its input (`Handlers`), or, when it provides one interface, that interface's plain object (a value is `success`, a throw `threw`); an event's method on that object is a `Source` (`{ op, run }`). The built `Implementation.make` gives `{ handlers, sources }` by port, and the application runs the sources | `implementation.ts` |
| `Provider` | an author (GCP, AWS, a consultancy) supplying implementations, possibly of another's contract: its namespace, its implementations (`Provider.define`, taking a `Namespace` or its string), metadata; each implementation's namespace is its provider's | `provider.ts` |
| `Registry` | a pool of providers (`Registry.create`); O(1) lookups (`implementationsOf`); a plain-data `Manifest` | `registry.ts` |
| `Selector` | which call subscriptions a call may use: an interface, or `SelectorData` narrowed by tags, implementation, provider, `runtime` (`Selector.of`, `selectorData`, `matches` over a `Target`) | `selector.ts` |
| Context | what a pod's factory gets (`NanoContext`): `self`, `runtimes`, `deps` (one plain object per declared dependency role, typed from its interface: each call goes through `one(role)` then, a `Fail` thrown as an `Error` carrying it, `err.fail`), `one` (a `NanoResult` of a `Selection`: `not-found` or `not-unique` unless exactly one edge matches), `all` (each a `Selection`: `pod`, `runtime`, `call` through that edge, `on` to hear the pod, typed by the op), `publish` (data typed by the op), `addOnPodChangeListener` (`fn({ type: 'added' | 'removed', runtime, pod, implementation })` for each other pod added to or removed from a runtime this pod is placed in, after registering, while its build lives; the runtime's policy is asked `'lifecycle'`, a refusal is traced `denied` once per listener per `apply`; `notifyPodChanges` in `application/pod-changes.ts`, run by `apply`), `addOnCloseListener` (each build has its own; runs on `restarted`, `removed`, `changed` or `closed`) | `context.ts` |
| `Pod` | a value `{ implementation, config?, eager, isolation? }` from `Pod.lazy(impl, { config, isolation })` / `Pod.eager(impl)` (`isolation`: `'host'` (absent) | `'sandbox'` | `'isolated-sandbox'`, host-owned, nano only shape-checks it); no state, methods or instance | `pod.ts` |
| `Policy` | `isAllowed(ask)` per runtime, answering a `Verdict`; `Ask` is the message's envelope `{ runtime, kind, from, to, port?, outside, data? }` (`kind`: `call`, `pipe`, `on`, `subscribe`, `unsubscribe`, `lifecycle`; `outside`: `from` is the host or not placed in `runtime`); `Policies.allowAll()`; `PolicyRules(rules)`: the first `Rule` (`{ allow | deny: kind | kind[] | '*', from?, to?, outside? }`, also its TypeBox schema; `from` a pod or `'host'`, `to` a pod, an interface coordinate (all its ports) or a port; absent or `'*'` anything) matching decides, none denies `no rule allows it`, a deny's reason is `rules[i]` | `policy.ts` |
| `Pods` | which components exist: `Pods.create(podDeployment, { registry, tags? })` checks a `PodDeployment` (names, implementations, configs, at most 5000) and its tags by pod name into an immutable lookup, `names`, `get`, `select` (a scope over the same descriptions, keeping their tags), `deployment` | `pods.ts` |
| `Runtime` | pods placed together and wired: `Runtime.create(id, runtimeDeployment, pods)` checks a `RuntimeDeployment` (pods placed, `Subscription`s, `policy` (`{ kind: 'allow-all' }` or `{ kind: 'rules', rules }`; absent, allow-all; read as the deployment is now, so `apply` changes it; a runtime with this and a code policy in `create`'s `policies` is `invalid-input` at `create` and `apply`), `exports`: the interface coordinates it offers the host, each provided by a pod placed there; absent, everything; `[]`, nothing) over a `Pods` scope into an immutable `{ id, pods, deployment }` | `runtime.ts` |
| `AppDeployment` | the whole system as data: pods, runtimes by id, tags, and the host's `modules` (where each provider's code is loaded from), `views` and the deployer's `layout` (a plain object; shape-checked, otherwise ignored, not in `deployment()`); `AppDeployment.assemble(d, registry)` checks it level by level into its `Runtime`s, strictly (D83) | `deployment.ts` |
| `Application` | the one live thing: `Application.load(url, opts?)` (fetch a `nano.json`, import each `modules` entry relative to it, its default export a `Provider`, into a registry, assemble and create; the first failure throws an `Error` carrying the `Fail`, nothing half-running; the document's shape is checked before any module is imported, a non-ok response is `not-found`; `modules` URLs are code that will run, so `load` is for trusted documents) or `Application.create(runtimes, { policies?, timeoutMs?, isolate? })` (`isolate(name, pod)` gives the host's stand-in, same coord, for a pod whose isolation isn't `host`; without it such a pod fails `invalid-input`) (at most 50, ids by the id rule, every runtime's pods from one `Pods`) gives ten members: `runtime` (`app.runtime(id)`: the host as a member of that runtime, seeing only the pods placed there and only what it exports, every message policed by its policy: `resolve(api, { pod? })`, a `Resolution`, either `ok` with `pod`, `runtime`, `implementation` and `value`, its plain object (`Interface.Type`, resolved again at each call), or not `ok` with `reason` (`not-found`: no pod there provides it; `not-exported`: one does, but the runtime doesn't export it; `not-unique`: several do) and its `fail`; `getOrThrow()` gives the plain object or throws an `Error` carrying the `Fail`; `get` (exactly `resolve(api, where).getOrThrow()`); `call(pod)`, a client by op name from `'host'`; `subscribe(op, fn)`, each successful call of that action travelling in that runtime as `{ input, output }`, after the policy allows a `subscribe` ask from `'host'`, returning an unsubscribe; `listen(fn)`, the application's one stream filtered to that runtime: the `sent` messages travelling in it and their `delivered`/`denied`, `applied`, and the `built`/`closed`/`restarted`/`failure` of pods placed in it now, no `warning`; returning an unsubscribe), then `resolve`, `get`, `call` and `subscribe`, the same of the application's one runtime (with several, `not-unique`: name a runtime; `app.call(runtime, pod)` is `app.runtime(runtime).call(pod)`), `apply`, `restart`, `deployment`, `listen` (an `AppEvent` stream), `close` (every instance closed; then calls are `not-found`, `apply`/`restart` refused) | `application/` |

Inside `application/` (not exported from the package, one line each): `stream()` is the one stream and its ids;
`instances(live)` holds at most one build per pod name and closes builds (each with its own close listeners, run in
order within the timeout, then `closed` on the stream); `send` carries exactly one message in one runtime (a `call`,
`pipe` or `on`, with its chain), reading a `Live` (the application as a message needs it, with its `listeners` (`On` subscriptions, a pod's or the host's, and pod-change listeners),
and deliveries under way); `emit` is what follows a message: an emission (`{ input, output }` of a successful call, `{ output }` of an event) delivered along pipes (its `output`) and to `On`
subscriptions (whole; the 'subscribe' question is asked once, when one connects, and again on `apply`), and `client`, which calls by op name and emits each successful result; `refusal` is a runtime policy's
answer to a message or a new subscription (a throw, a Promise or no verdict refuses); `within` bounds a build or
handler by the timeout, and `attempt` also records its throw or timeout as a `failure`; `impl(live, pod)` is a pod's
implementation now and `placedIn(live, pod)` the runtimes it is placed in (its pipes, `ctx.runtimes`, pod changes) and `wiredFrom(live, pod)` the runtimes holding a call edge from it, placed there or not (its selections); `start(live, pod, ctx, sources, onClose)` (sources.ts) runs a build's sources as handlers are run: each starts once the pod is built, its values published through `ctx.publish`, stopped when the build closes, a throw a `failure` of that pod; `iterate(listen, ended)` is the AsyncIterable form of `on` / `subscribe` without a callback (it connects when made, like the callback form, so a refusal throws at the call; iterated once; `done` when nano drops the `On`: `break`, build close, `apply`, close; a `Fail` that ends it later, `denied`, is thrown after what was buffered); `connect(live, wire, ended)` (connection.ts) makes an `On` by a message: `sent` kind `subscribe` from its owner to its source, then `delivered` (live) or `denied` (nothing added); its `end(fail?)`, the one way an `On` ends, sends `unsubscribe` (caused by the subscribe), `delivered` with `success` or the `Fail`; `contextFor(live, name,
onClose)` is a pod's `NanoContext`, `onClose` adding a listener to that build; `diff(a, b)` is what `apply` changes: pods added, removed, changed, and runtimes rewired;
`loaded(url)` is a nano.json and the registry of its `modules` (what `Application.load` assembles); `placement(live, runtime, api, where)` is the one pod in a runtime providing an exported interface now, and `runtimeView(live, id?)` a `RuntimeView` (a runtime as the host sees it: `resolve`, `get`, `call`, `subscribe`) for runtime `id`, looked up at each use (`not-found` if missing), or, without `id`, the application's one runtime (else `not-unique`); `compose(runtimes)` is the application's deployment from its runtimes (the pods they place, in their `Pods`' order,
and those pods' tags) and their registry.

Inside `plain.ts` (not exported from the package), also: `lift(i, obj)` makes a plain object a part: its actions' methods as handlers, its events' methods as sources (used by `make` and by the `api.impl(...)` builder alike). `make` gives `{ handlers, sources }`; the application runs the sources (`application/sources.ts`).

Inside `plain.ts` (not exported from the package): `handlers(i, obj)` lifts a plain object's methods into an interface's handlers, and `plain(resolve)` is a plain object over a client resolved at each call, a `Fail` thrown as an `Error` carrying it (what `ctx.deps` and `app.get` are made of). Its events are methods whose iterable connects at the call. `thrown(fail)` is that `Error` carrying a `Fail`, the one way nano throws a `Fail`.

Inside `pods.ts` (not exported from the package): `Id` is the id rule for pod names and runtime ids, `shapeError` the
first way a value breaks a level's shape, `originOf(pods)` where a `Pods` comes from: the registry it was checked
against (which `Runtime.create` resolves implementations with), the `Pods` it was selected from (one per application)
and the tags of its pods, and its descriptions by name (read without copying). Inside `deployment.ts`: `RuntimeIds` is the shape of a table by runtime id (the id rule, at
most 50). Inside `runtime.ts`: `isRuntime(r)` is whether `Runtime.create` made `r`, and `opAt(impl, port)` the op at a port of an implementation.

## How it works

1. **Define.** Schemas, ops, interfaces; an implementation provides interfaces and may declare dependencies; a
   provider groups implementations; the registry holds providers (`examples/*/interfaces.ts`, `providers.ts`).
2. **Deployments, per level.** `Pod.lazy(impl, { config })` or `Pod.eager(impl)` is a value holding the
   implementation's coordinate (D85). A `PodDeployment` names pods; a `RuntimeDeployment` places some of them and lists
   its subscriptions, in order: a call edge `{ kind: 'call', from, to }` (which pods `from`'s code may reach) or a pipe
   `{ kind: 'pipe', from, source, to, target }` (source an event or an action's results of `from`, target an action of
   `to` that fits it; pipes may form cycles, D91, D93); an `AppDeployment` holds both and the tags. Each level checks
   its own part: `Pods.create` names, implementations (in the registry), configs, tags (by its pod names) and 5000
   pods; `Runtime.create` that every pod it places is in its `Pods` scope, every subscription's ends are placed in it (a call's `from` need only be in the scope, placed in another runtime; `Application.create` refuses one placed in none),
   ports exist and fit, and 2000 subscriptions; `Application.create` 50 runtimes, their ids and one `Pods` (D75, D78).
3. **Assemble.** `pods.select(names)` is a scope over the same descriptions; `AppDeployment.assemble(d, registry)` does
   `Pods.create`, then `Runtime.create` per runtime over `pods.select(def.pods)` and its call edges' callers, strictly: the first failure is the
   result (D83, D100).
4. **Create.** `Application.create(runtimes, opts)` (from data: `AppDeployment.assemble(d, registry).value`) validates (an invalid
   input is a `Fail` and nothing runs), builds every eager pod, and resolves once those settle. A failed eager build
   is a `failure` on the stream, not a failed `create`.
5. **Mount.** One instance per pod name, made by the factory when first needed, once: concurrent first calls share
   the build. That is when the pod gets its context. A factory that throws, rejects or times out fails the call
   that needed it and caches nothing. State is whatever the factory closes over (D71).
   Whoever holds `app` is the operator; components get a `RuntimeView` or `deps`, never `app`.
6. **Calls through edges.** `app.call(runtime, pod).op(input)` is a message from `'host'` in that runtime. A handler
   reaches others through the `ctx` its factory closed over: `ctx.one(selector)` is the single matching call edge from the pod as `success(Selection)`, or the `Fail`
   (`not-found` or `not-unique`); `ctx.deps.role.op(x)` calls through `one(role)` and throws a `Fail` as an `Error`; `ctx.all(selector)` every one, in deployment order (D86); both read the
   deployment now, across every runtime holding a call edge from the pod, and a selector's `runtime` narrows them. Each message
   travels in exactly one runtime, that of the edge it uses: policed (a throw, or no `Verdict`, denies, D82), input
   checked, run under the timeout, output checked, and recorded: `sent` (its `kind`, `correlation` the id of its
   chain's first message, `cause` the message that led to it), then `delivered` or `denied`. A handler never throws
   across this boundary: a throw, timeout, bad input or bad output is a `Fail` (D76).
7. **Emissions.** An emission is `ctx.publish(op, data)`, or an action's successful result, whoever called it. It is
   delivered along every pipe from the pod with that source, in every runtime the pod is placed in, then to `on`
   subscribers (`selection.on(op, fn)`, which lasts until the build closes, the returned function is called or the
   edge is gone), each delivery its own message in its runtime. The caller of an action doesn't wait for it. A chain
   stops when a step fails (D101, D93).
8. **Change.** `app.apply(next)` validates `next`, asks each affected runtime's policy about each added subscription
   (`isAllowed` of a `call` or `pipe` ask), then applies everything or nothing: pods added (eager ones built), removed
   (instances forgotten), changed (restarted with the new value), subscriptions added, removed, reordered; one
   `applied` event. `app.restart(pod)` forgets an instance (an eager pod rebuilds at once); calls in flight finish on
   the old one (D77). `apply` drops pods that no runtime places. An application created from no runtimes has no
   registry, so `apply` naming any implementation is `not-found`. A forgotten instance is closed first, its
   replacement built after (D102).
9. **Close.** `app.close()` closes every instance: each one's close listeners run in order within the timeout, then
   `closed`. Deliveries under way settle and nothing new is delivered; host calls are then `not-found` and
   `apply`/`restart` refused (D96).
10. **Watch.** `app.listen(e => …)` is the one stream, in order and synchronously, and returns an unsubscribe: `built`,
    `closed`, `restarted`, `applied`, `sent`, `delivered`, `denied`, `failure`, `warning`. A throwing listener is
    swallowed (D79).
11. **Save.** `app.deployment()` is the current value (the pods placed in some runtime, the runtimes, and the tags
    `AppDeployment.assemble` carried in); saving is its JSON, and `AppDeployment.assemble` + `Application.create` on it gives an equivalent
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
`one(DB)` is `not-unique`, and `Selector.of(DB, { runtime: 'v2' })` picks one (`examples/migration`, D86).

**What does saving write?** The `AppDeployment`: pods (implementation coordinate, config, eager), runtimes (pods placed,
subscriptions in order, policy, exports), tags. Not instances, not state, not custom policies (they come in `opts.policies`,
D80), not the registry. `nano.json` is one, serialised.

**Strict validation?** An invalid deployment (including one naming an unknown implementation) fails as a whole with
the reason, in `create` and `apply`; nothing half-runs. A document with a missing provider loads once the provider is
added to the registry (D83). A call subscription is checked against the caller's declared dependencies only when
they name an interface (D87).

**Call edges, pipes or `on`?** A call edge says what a pod's code may call (`ctx.deps.db.save(x)`), and is the
swap point: `apply` re-points it and the code stays. A pipe is deployment data connecting an event or an action's
results to an action's input, outside any component's code. `selection.on(op, fn)` is the same hearing made from code,
for as long as its instance lives; it is in no deployment (D91, D92).

**Scoping with `select`?** `pods.select(['a', 'c'])` is a `Pods` over the same descriptions, keeping their tags; an
unknown name is `not-found`, a duplicate `invalid-input`. A runtime built over it can place only those pods, so its
code cannot reach others and `app.call` there is `not-found`; a pod in two scopes is one pod (D95).

**Why are `Pods` and `Runtime` inert?** They are checked descriptions: no instance, no context, no message. Only
`Application.create` is live, so there is no `start()` and a runtime need not be a second live type (D90, D98).

**Closing?** `app.close()` closes every instance: close listeners (`ctx.addOnCloseListener`) run within the timeout,
deliveries already under way finish, nothing new is delivered. A restarted or removed pod is closed the same way
before its replacement is built (D96, D102).

**Storage and messaging?** Components. Key-value stores, CRUD, queues, REST bridges are pods behind interfaces, chosen
per environment; policies, enrichment and restriction between them are compute pods. Nano only routes, polices and
records (D73). A component adapts to what is plugged in by testing `ctx.all(S).length` or `ctx.one(S).ok`.

**Pods that call each other while building?** Don't: a factory should not wait on another pod during `make`. Two that
do both wait on each other and fail by timeout (D84).

**Does `publish` wait for its pipes?** Open: today it awaits its pipe deliveries, not its `on` subscribers, while an
action's caller waits for neither; whether `publish` should stop waiting is the user's call (D104).

**Where do domain failures go?** In the op's output, as values: the signer's `{ status: 'denied' }`, the composer's
`{ status: 'disabled' }`. `Fail` is for platform failures (`threw`, `timeout`, `denied`, `invalid-input`,
`invalid-output`, `unknown-op`, `not-unique`, `not-found`, `not-exported`).

**Where do binary values go?** Base64 strings in the schema (D2); the signer's keys and signatures.
