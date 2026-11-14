> The other packages (`core`, `app`, `runes`, `ui-workspace`, …) still run on the old core until plans 2 and 3 move
> them; this file describes the new model in `packages/nano`.

# Design: the nano model

Spec: `docs/superpowers/specs/2026-11-13-runtime-model-design.md`. Decisions: `docs/decisions.md` (cited as D<n>).
Worked examples: `examples/external-signer`, `examples/messenger` (each with its `nano.json`), `examples/etl`, `examples/migration`.

## The domains

Each has one responsibility and one file in `packages/nano/src`; each file opens with a comment and an example.

| Domain | Responsibility | File |
|---|---|---|
| Schema | a TypeBox schema (`SchemaDef`, from `defineSchema`) with its blake3 `hashOf` (annotations stripped, `canonical`, `canonicalSchema`) and JSON codec; `isJson` refuses non-JSON schemas | `schema.ts` |
| Op | an action (in → out), source (out) or sink (in) (`Op`, `OpKind`); coord = hash of name + schema hashes; `fits` for events | `op.ts` |
| `Interface` | a coord (`ns/name`, `com.example.DB`; the `COORD` rule) plus its ops; `portKey(iface, op)` names one op as offered; `Client` is a typed client for one | `iface.ts` |
| Result | `NanoResult` = `success` or a platform `Fail` (`FailType`); never thrown; `isNanoResult` | `result.ts` |
| `Implementation` | code providing whole interfaces, with declared dependencies (selectors by role) and optional config schema; `make(config)` returns `Handlers` (a `Handler` per port; `provide` / `Provided` pair them); no context at make | `implementation.ts` |
| `Provider` | a namespace of implementations (`<provider>/<name>`) plus metadata | `provider.ts` |
| `Registry` | a pool of providers (`createRegistry`); O(1) lookups (`implementationsFor`); a plain-data `Manifest` | `registry.ts` |
| Selector | which pods a call may use (`Selector`: an interface, or `SelectorData` narrowed by tags, implementation, provider, `runtime`; `sel`, `selectorData`, `matches` over a `Target`); `EndSelector` picks one end of a subscription | `selector.ts` |
| Context | what a handler gets, from a runtime: its coord, runtime, `runtimes`, the call verbs (`CallSelector`, `Call`, `Found`, `Each`), `publish`, dependency queries (`NanoContext`) | `context.ts` |
| Pod | the effect boundary a runtime invokes through, standalone: `Pod.create(impl, { config })`; `invoke`, `call.<op>`, `swap`, `dispose`, `join`; state `PodState`; knows its runtimes' names, nothing else. Turns throws, timeouts and bad output into `Fail`s | `pod.ts` |
| `Policy` | `isAllowed(src, dest, data)` per runtime, a `Verdict`; `Policies.allowAll()` only, for now | `policy.ts` |
| Runtime | pods by coord `<implementation>#<n>` (`createRuntime`, `Runtime`, `RuntimeOpts`; `podTable`, `wirings`, `instanceCoord`, `parseInstance`; limits `MAX_PODS`, `MAX_RUNTIMES`, `MAX_SUBSCRIPTIONS`, id rule `ID`), subscriptions and their status, provisioning, books, one stream | `runtime/index.ts`, `runtime/pods.ts` |
| — subscriptions | edges between two coords, as data (`SubscriptionData`, `NewSubscription`, `Status`: live/waiting/broken); order, edits and cascade (`subscriptionTable`, `statusOf`, `reordered`, `nextId`, `invalid`) | `runtime/subscriptions.ts` |
| — connect | resolves an end (`NewConnection`) once to exactly one registered coord (`resolveEnd`) | `runtime/connect.ts` |
| — calls | one policed, recorded, booked message (`send`, `Book`); a host's calls from `'host'` (`hostCall`) | `runtime/calls.ts` |
| — verbs | the context a runtime invokes a pod with (`contextFor`): verbs over its live call subscriptions in every runtime it is in (`connectionsOf`, `Wiring`); publish | `runtime/verbs.ts` |
| — provision | settles unconnected dependencies, synchronously: one matching pod → subscribe, else one implementation → make and register (`provision`, `Provisioner`, `Unsatisfied`) | `runtime/provision.ts` |
| — trace | the runtime's observable stream (`tracer`, `Tracer`, `RuntimeEvent`): lifecycle, wiring, messages, problems | `runtime/trace.ts` |
| Application | a runtime of runtimes (`createApplication`, `Application`): defines, starts on demand, shares tags and the pods table; sharing a pod is registering it. `define({ pods, runtimes })` (`RuntimeDef`, `RuntimeDefSchema`, `PodDef`); starting makes each pod key once (`podsTable`) and registers it at its saved coord | `application.ts`, `application-start.ts` |
| Document | `nano.json` v2 (`NanoDoc`, `NanoDocSchema`): `saveDoc`, `checkDoc`, `loadDoc`; one `pods` table (keys `p0`, `p1`, … in first-registered order), at most 25000 pods (`MAX_RUNTIMES` × `MAX_PODS`) | `document.ts` |

## How they work together

1. **Define.** Schemas → ops → interfaces; an implementation provides interfaces and depends on selectors; a provider
   groups implementations; the registry holds providers (`examples/*/interfaces.ts`, `providers.ts`).
2. **Make and register.** `Pod.create(impl, { config })` returns at once, `starting`; `rt.register(pod)` gives it the
   coord `<implementation>#<n>` (`n` per implementation, never reused). The pod is `running` or `failed` when its make
   settles; a throw or timeout is a `failed` pod, never a thrown error (D57, D58).
3. **Connect, once.** `rt.subscribe({ kind, from, to, … })` takes each end as a coord or an `EndSelector` (a coord,
   an interface it implements, or an implementation, with tags). Each must resolve to exactly one registered pod now,
   else `not-found` or `ambiguous` and nothing is added; what is saved is the two coords, so later changes never
   re-route it (D50, D60). A subscription is live when both ends are available and fit; waiting when an end is failed,
   stopped or not registered (a starting pod is available, D59); broken when the ports no longer fit.
4. **Call.** A handler calls out through `ctx.one/optional/any/all/first/fallback/each(selector, client => …)`; the
   selector filters the pod's live call subscriptions in every runtime it is registered in, and a selector's `runtime`
   narrows it to one (D3, D11, D65). `ctx.publish(op, data)` delivers to live event subscriptions in every one of them.
   Every message is policed and booked by the runtime whose subscription carries it (D19).
5. **Cascade or wait.** Unregistering a pod deletes every subscription naming it in that runtime (a coord is never
   reused, so it would only mislead); the pod keeps serving in other runtimes. A pod that is failed or stopped is only
   unavailable: its subscriptions wait and go live when it runs again.
6. **Swap.** `pod.swap({ config })`: a new instance is made off to the side while the old one serves, then it is
   switched to; calls in flight finish on the old one. Coords, tags and subscriptions are kept; ports that no longer
   fit are broken. A swap whose make fails leaves a running pod as it was (D65). Of overlapping swaps the latest asked
   wins even if its make fails (an earlier successful make is discarded and the pod keeps what it was serving); a
   superseded swap resolves `invalid-input`. One swap changes the pod in every runtime holding it, each telling
   `pod-swapped`.
7. **Share.** Registering the same pod in another runtime is the whole of sharing (D63): it gets a coord there, and its
   own wiring stays in the runtime that made it. Compose with `createApplication`: `define({ pods, runtimes })`, then
   `start(id)` builds a runtime from its definition (each pod key made once application-wide, registered at its saved
   coord, then its subscriptions) and always gives a runtime: what cannot be made is a note and a `warning` on the root
   stream, a failed make is a failed pod (D52).
8. **Watch.** `rt.listen(e => …)` is the runtime's one stream, in order: lifecycle (`pod-created`, `pod-state`,
   `pod-swapped`, `pod-removed`), wiring (`subscription-set`, `subscription-removed` with `unsubscribed` or `cascade`,
   `status`), messages (`sent`, then `delivered` or `denied`), problems (`failure`, `warning`) (D53, D62).
9. **Save.** `saveDoc(app)` writes one `pods` table (implementation, config; keys only in the document) and every
   runtime as data: its pods by saved coord, its `next` counters, its subscriptions in order; tags; which runtimes to
   `start`. `loadDoc` defines them and starts those, never provisioning (D37–D42, D52, D63). What is built live stays
   within what a document can hold, so what it saves loads (D56, D68): 49 runtimes besides the root (adopted ones are
   not saved or counted), per runtime 500 pods and 2000 subscriptions, so at most 50 × 500 = 25000 pods in a document.
   The root is saved whenever it holds pods, subscriptions or counters, so a coord is never reused after loading.

## FAQ

**Subscription or connection?** A subscription is the edge as data: saved, edited, possibly waiting. A connection is a
subscription that is live now (both ends available and fitting). Verbs only see connections; saving writes
subscriptions. `runtime/subscriptions.ts`, `rt.status(id)`.

**Why must every end of a subscription be a coord or a selector?** So choosing an end is explicit and checked once. A
selector that matches two pods fails `ambiguous` (`2 match`) rather than guessing; one that matches nothing fails
`not-found`. The result is saved as concrete coords, so registering more pods later never changes an existing
subscription (D50, `runtime/connect.ts`). Use `{ coord }` for a specific pod, `{ implements }` for "whichever store is
here" (`examples/messenger/messenger.test.ts`).

**How does sharing work, and where did place and gateways go?** Sharing is registering: to offer a pod to another
runtime, `b.register(a.pod(coord))`. There is no `place`, home, gateway or `expose`. The shared pod's wiring stays in
its own runtime: the messenger's `send` pod, wired to `db` in `messaging` and registered in `chat` and `support`,
reaches `db` through `messaging`'s subscription, and `db` is never in `chat` (D63, `examples/messenger/send.test.ts`).

**Can one verb reach across runtimes?** Yes, by the pod's registrations. A handler's `ctx.one(DB, …)` searches its
pod's subscriptions in every runtime it is in; a match in two is `ambiguous`, and a selector's `runtime` narrows the
search to one, by name (`sel(DB, { runtime: 'v2' })`). The ETL pod reads in `foo` and writes in `bar` with no runtime
named in code; the migration pod takes `{ from, to }` in its config and names runtimes only through that
(`examples/etl`, `examples/migration`, D65). Each call is policed and recorded by the runtime that carries it.

**What happens when I delete vs when it fails?** Deleting (`rt.unregister`) is final for that runtime: its
subscriptions naming the coord are deleted (`subscription-removed`, `cascade`), the coord is never reused, and the pod
keeps running where else it is registered. Failing (a make that throws, a pod `dispose`d or `stopped`) is temporary:
the pod is `failed` or `stopped` with its reason, its subscriptions wait, and a `swap` brings a failed one back (D59, D65).

**What is a host call?** `rt.call(coord).<op>(input)`: how a host or a test reaches a pod, through the runtime. It is
policed (`isAllowed` sees `'host'` as the source), `sent` then `delivered` on the stream, and not booked (it is over no
subscription). An unknown coord is `not-found`; an op name the pod does not offer is `unknown-op`; an op name two
interfaces offer is `ambiguous` (D62, D64, `runtime/calls.ts`). Nothing else can invoke a pod: `pod.invoke` needs a context, and only a runtime makes one.

**What is start?** What "open" was: `app.start(id)` gives the runtime, building it from its definition if it is not
running yet. It never refuses a runtime because a pod failed; pods it cannot make, entries it cannot register and
subscriptions it cannot add are skipped with a note (`app.notes()`, and a `warning` on `app.listen`). It fails only for
an unknown id or a throw while building (D52, `application.ts`).

**How do I watch what a runtime does?** `rt.listen(e => …)` returns an unsubscribe. Every message is `sent` then
exactly one of `delivered` (with its result and duration) or `denied` (with the reason); a shared pod's news reaches
every runtime it is registered in. Not on the stream: verb results `missing-component`/`ambiguous` and a host call to an
unknown coord (no message was sent). A listener that acts on the runtime re-enters it, so later listeners see that
action's events first (D53, D54, `runtime/trace.ts`). The examples assert with it.

**Why can't my code call any pod it finds?** Calls only travel over the caller's subscriptions (D3), so every reachable
target is visible, saved and policed. To use something from another runtime, register its pod in yours (D63); to call it
from outside the graph, use `rt.call`.

**What happens when two pods match `one`?** `Fail: ambiguous`. `one` never guesses: narrow the selector (tags,
implementation, `runtime`), unplug one, or use `any`, `first` or `fallback` (`runtime/calls.ts`). Provisioning likewise
leaves a dependency with two matching pods unsatisfied (`2 match`, D25).

**Where do domain failures go?** In the op's output, as values: the signer's `{ status: 'denied' }`, the composer's
`{ status: 'disabled' }`. `Fail` is for platform failures only (threw, timeout, denied by policy, invalid input or
output, `missing-component`, `ambiguous`); the pod turns every misbehaviour into one (`pod.ts`, `result.ts`).

**What does saving write?** `nano.json` v2: one `pods` table (each pod once: implementation, config; the keys `p0`,
`p1`, … exist only in the document, in first-registered order), then each runtime's pods by key and saved coord, its
`next` counters, its subscriptions in order, tags, the providers used, and which runtimes to start (D37–D39, D52, D63).
A pod in two runtimes is one entry, referred to from both; loading makes it once. Not live state (an instance's data),
not custom policies (D39), not adopted runtimes (D33).

**Does loading provision?** No. It makes what the document says and adds its subscriptions; anything that does not fit
is skipped with a note (D24, D40).

**Mutual dependencies?** Allowed: `rt.provision` makes and registers every pod first, then wires, in one synchronous
pass. A starting pod is available, so nothing waits on the pass (D26, D59, D61).

**How does a component adapt to what is plugged in?** `ctx.hasDependencies(role)` / `ctx.listDependencies()`: the
messenger's inbox falls back to a local map, its composer reports disabled (`examples/messenger/providers.ts`).

**Where do binary values go?** Base64 strings in the schema (D2); the signer's keys and signatures.
