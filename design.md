> The other packages (`core`, `app`, `runes`, `ui-workspace`, …) still run on the old core until plans 2 and 3 move
> them; this file describes the new model in `packages/nano`.

# Design: the nano model

Spec: `docs/superpowers/specs/2026-11-13-runtime-model-design.md`. Decisions: `docs/decisions.md` (cited as D<n>).
Worked examples: `examples/external-signer`, `examples/messenger` (each with its `nano.json`).

## The domains

Each has one responsibility and one file in `packages/nano/src`; each file opens with a comment and an example.

| Domain | Responsibility | File |
|---|---|---|
| Schema | a TypeBox schema with its blake3 hash (annotations stripped) and JSON codec; refuses non-JSON schemas | `schema.ts` |
| Op | an action (in → out), source (out) or sink (in); coord = hash of name + schema hashes; `fits` for events | `op.ts` |
| Interface | a coord (`ns/name`, `com.example.DB`) plus its ops; `portKey(iface, op)` names one op as offered | `iface.ts` |
| Result | `NanoResult` = success or a platform `Fail`; never thrown | `result.ts` |
| Implementation | code providing whole interfaces, with declared dependencies (selectors by role) and optional config schema; `make(config)` returns handlers | `implementation.ts` |
| Provider | a namespace of implementations (`<provider>/<name>`) plus metadata | `provider.ts` |
| Registry | a pool of providers; O(1) lookups; a plain-data manifest | `registry.ts` |
| Selector | which targets a call may use (an interface, narrowed by tags, implementation or provider); `EndSelector` picks one end of a connection | `selector.ts` |
| Context | what a handler gets: its instance, runtime, the call verbs, `publish`, dependency queries | `context.ts` |
| Pod | the deployment unit and failure boundary: `{ id, implementation, config, instances }`, owned by its home runtime and shared (not copied) where placed; made, scaled, swapped and removed as one; its state summarises its instances'. Id unique in the application. Being replaced by the standalone `Pod` (the effect boundary: `Pod.create(impl, { config })`, `invoke(ctx, port, input)`, `swap`, `dispose`, `join`; its `PodState`), which the runtime still wraps once per instance | `runtime/pods.ts` (record), `runtime/index.ts` (lifecycle), `pod.ts` (`Pod`) |
| Instance | one made implementation in a pod, `<pod>#<n>`; indices start at 0 and are never reused. Made from its config inside a `Pod`, which turns throws, timeouts and bad output into `Fail`s | `pod.ts` (`Pod`) |
| Policy | `isAllowed(src, dest, data)` per runtime; `Policies.allowAll()` only, for now | `policy.ts` |
| Runtime | pods by coord (`podTable`; `wirings`: each pod's runtimes), subscriptions (data) and their status (live/waiting/broken), provisioning, books, its one stream | `runtime/index.ts`, `runtime/pods.ts` |
| — subscriptions | call and event edges between two coords, as data; their status, order, edits and cascade (`subscriptionTable`) | `runtime/subscriptions.ts` |
| — connect | resolves an end selector, once, to exactly one instance coord | `runtime/connect.ts` |
| — calls | one policed, recorded, booked message (`send`); a host's calls from `'host'` (`hostCall`) | `runtime/calls.ts` |
| — verbs | the context a runtime invokes a pod with: verbs over its live call subscriptions in every runtime it is in; publish | `runtime/verbs.ts` |
| — provision | settles unconnected dependencies: one matching instance → subscribe, else one implementation → make | `runtime/provision.ts` |
| — trace | the runtime's observable stream: lifecycle, wiring, messages, problems | `runtime/trace.ts` |
| Application | a runtime of runtimes: defines, starts on demand, places pods across them, shares tags and pod ids | `application.ts` |
| Document | `nano.json` v2: `saveDoc`, `checkDoc`, `loadDoc` | `document.ts` |

## How they work together

1. **Define.** Schemas → ops → interfaces; an implementation provides interfaces and depends on selectors; a provider
   groups implementations; the registry holds providers (`examples/*/interfaces.ts`, `providers.ts`).
2. **Make.** `rt.create('vault', 'example.signer/vault', { count })` makes a pod of instances `vault#0`, `vault#1`, …
   A `make` that throws or times out leaves that instance `failed`; the create still succeeds (D48). With
   `{ provision: true }` the runtime connects or makes what each instance's dependencies need (create first, then
   wire: D24–D26). `addInstance`, `scale`, `restart`, `removeInstance` and `remove` act at the pod's home (D49); a guest's `remove`
   drops only its own membership.
3. **Connect, once.** `rt.connect({ kind, from, to, … })` takes an `EndSelector` for each end (which pod: by id,
   interface or implementation; which instance: `first`, `index` or `tags`). Each must resolve to exactly one instance
   now, else `not-found` or `ambiguous` and nothing is added; what is saved is the two coords, so later changes never
   re-route it (D50). `rt.subscribe` takes the coords directly (loading, provisioning). A subscription is live when
   both ends are running and fit; waiting when an end is unavailable; broken when the ports no longer fit.
4. **Call.** A handler calls out through `ctx.one/optional/any/all/first/fallback/each(selector, client => …)`; the
   selector filters the instance's live call subscriptions in its home runtime (D3, D11). `ctx.publish(op, data)`
   delivers to live event subscriptions in every runtime holding the pod (D17, D48). Every message is policed and
   booked by the runtime it travels in (D19).
5. **Cascade or wait.** Deleting an instance or pod at home deletes every subscription naming it, in every runtime
   holding the pod (a coord is never reused, so it would only mislead); a guest removing a placed pod drops only its
   membership and its own subscriptions to it. An instance that is failed, stopped or starting is only
   unavailable: its subscriptions wait and go live when it runs again (D49).
6. **Swap.** `rt.swap(pod, implementation, { config? })`, at home only: every instance is made off to the side while
   the old ones serve, then all switch at once. Coords, tags and subscriptions are kept; ports that no longer fit are
   broken; a failing make changes nothing and is a `failure` on the stream; the last swap asked wins (D51, D54).
7. **Compose and start.** The application holds runtimes; `place(pod, from, to)` adds the home's pod record to
   another runtime, so every runtime holding it sees its instances, states and swaps (D48, D51). A runtime may be only
   defined; `start(id)` builds it from its definition (its pods at their saved indices, then the runtimes its members
   come from, its members, its subscriptions) and always gives a runtime: what cannot be made is a note and a
   `warning` on the root stream, a failed make is a failed pod (D52).
8. **Watch.** `rt.listen(e => …)` is the runtime's one stream, in order: lifecycle (`pod-created`, `instance` state,
   `pod-swapped`, `pod-removed`), wiring (`subscription-set`, `subscription-removed` with `unsubscribed` or `cascade`,
   `status`), messages (`sent`, then `delivered` or `denied`), problems (`failure`, `warning`) (D53, D54).
9. **Save.** `saveDoc(app)` writes every runtime as data: pods with their live indices and `next`, members by pod id,
   subscriptions in order, tags, and the runtimes to `start`. `loadDoc` defines them and starts those, never
   provisioning (D37–D42, D52). What is built live stays within what a document can hold, so what it saves loads
   (D54, D56): at most 5000 instances across the application, 49 runtimes besides the root (adopted ones are not
   saved or counted), and per runtime 500 own instances, 500 pods (own and placed) and 2000 subscriptions.

## FAQ

**Subscription or connection?** A subscription is the edge as data: saved, edited, possibly waiting. A connection is a
subscription that is live now (both ends running and fitting). Verbs only see connections; saving writes subscriptions.
`runtime/subscriptions.ts`, `runtime.status(id)`.

**Why must every connection end have a selector?** So choosing an end is explicit and checked once. A selector that
matches two instances fails `ambiguous` (`2 match`) rather than guessing; one that matches nothing fails `not-found`.
The result is saved as concrete coords, so adding instances later never changes an existing connection (D50,
`runtime/connect.ts`). Use `{ pod }` for a specific widget, `{ implements }` for "whichever store is here"
(`examples/messenger/messenger.test.ts`).

**What happens when I delete vs when it fails?** Deleting (`remove`, `removeInstance`, scaling down) is final: the
instances are `stopped`, every subscription naming them is deleted in every runtime holding the pod
(`subscription-removed`, `cascade`), and their indices are never reused. Failing (a make or restart that throws) is
temporary: the instance is `failed` with its reason, its subscriptions wait, and `restart` or a `swap` brings it back
(D49, D51).

**What is start?** What "open" was: `app.start(id)` gives the runtime, building it from its definition if it is not
running yet. It never refuses a runtime because a pod failed; pods it cannot make, members it cannot place and
subscriptions it cannot add are skipped with a note (`app.notes()`, and a `warning` on `app.listen`). It fails only for
an unknown id or a throw while building (D52, `application.ts`).

**How do I watch what a runtime does?** `rt.listen(e => …)` returns an unsubscribe. Every message is `sent` then
exactly one of `delivered` (with its result and duration) or `denied` (with the reason); a placed pod's news reaches
every runtime holding it. Not on the stream: calls during a `make`, a message whose subscription vanished while it
waited for a provisioning pass, and verb results `missing-component`/`ambiguous`. A listener that acts on the runtime
re-enters it, so later listeners see that action's events first (D53, D54, `runtime/trace.ts`). The examples assert
with it.

**Why can't my code call any instance it finds?** Calls only travel over the caller's subscriptions (D3), so every
reachable target is visible, saved and policed. To use something from another runtime, place its pod into yours first
(D6). Known gap: there is no policed way in from outside the graph yet. The example tests call
`rt.record(pod)!.instances.get(coord)!.host!.invoke`, which skips policy, books, the stream and the provisioning-pass
wait; it is for tests only. Plan 2 adds a host-side invoke through the runtime (D45).

**What happens when two instances match `one`?** `Fail: ambiguous`. `one` never guesses: narrow the selector (tags,
implementation), unplug one, or use `any`, `first` or `fallback` (`runtime/calls.ts`). Provisioning likewise leaves a
dependency with two matching instances unsatisfied (`2 match`, D25).

**Where do domain failures go?** In the op's output, as values: the signer's `{ status: 'denied' }`, the composer's
`{ status: 'disabled' }`. `Fail` is for platform failures only (threw, timeout, denied by policy, invalid input or
output, missing, ambiguous); the instance's host turns every misbehaviour into one (`pod.ts`, `result.ts`).

**What does placing do?** Makes a pod a member of a second runtime, sharing its record: callers there can subscribe to
its instances, and their publishes reach subscribers there (D17, D48). It still calls out through its home runtime
(D11). It is scaled, swapped and removed only at home, and every runtime holding it sees the change behind the same
coords (D51). The signer example swaps its vault at home; the client sees a fresh vault through the placed signer.

**What does saving write?** `nano.json` v2: each runtime's own pods (implementation, config, live instance indices,
`next`), its placed members by pod id with their home, its subscriptions in order, tags, the providers used, and which
runtimes to start (D37–D39, D52). Not live state (an instance's data), not custom policies (D39), not adopted
runtimes (D33).

**Does loading provision?** No. It makes what the document says and adds its subscriptions; anything that does not fit
is skipped with a note (D24, D40).

**Mutual dependencies?** Allowed: a provisioning pass makes everything first, then wires; calls into the pass wait for
it, and calls during an instance's own `make` fail at once (D26).

**How does a component adapt to what is plugged in?** `ctx.hasDependencies(role)` / `ctx.listDependencies()`: the
messenger's inbox falls back to a local map, its composer reports disabled (`examples/messenger/providers.ts`).

**Where do binary values go?** Base64 strings in the schema (D2); the signer's keys and signatures.
