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
| Implementation | code providing whole interfaces, with declared dependencies (selectors by role) and optional config schema; `make(ctx)` returns handlers | `implementation.ts` |
| Provider | a namespace of implementations (`<provider>/<name>`) plus metadata | `provider.ts` |
| Registry | a pool of providers; O(1) lookups; a plain-data manifest | `registry.ts` |
| Selector | which targets: an interface, narrowed by tags, implementation or provider | `selector.ts` |
| Context | what a handler gets: its instance, runtime, config, the call verbs, `publish`, dependency queries | `context.ts` |
| Pod | runs one instance; turns throws, timeouts, bad output into `Fail`s and observations | `pod.ts` |
| Policy | `isAllowed(src, dest, data)` per runtime; `Policies.allowAll()` only, for now | `policy.ts` |
| Runtime | members, subscriptions (data) and their status (live/waiting/broken), provisioning, books | `runtime/index.ts` |
| — members | the id rule, instance coords (`<implementation>#<id>`) | `runtime/members.ts` |
| — subscriptions | call and event edges as data, their status, order | `runtime/subscriptions.ts` |
| — calls | the verbs over live call subscriptions; publish delivery; books | `runtime/calls.ts` |
| — provision | settles unconnected dependencies: one member → subscribe, else one implementation → make | `runtime/provision.ts` |
| Application | a runtime of runtimes: defines, opens on demand, places instances across them, shares tags and ids | `application.ts` |
| Document | `nano.json` v2: `saveDoc`, `checkDoc`, `loadDoc` | `document.ts` |

## How they work together

1. **Define.** Schemas → ops → interfaces; an implementation provides interfaces and depends on selectors; a provider
   groups implementations; the registry holds providers (`examples/*/interfaces.ts`, `providers.ts`).
2. **Make.** `runtime.create(id, implementation)` makes a pod around the instance; with `{ provision: true }` the
   runtime connects or makes what its dependencies need (create first, then wire: D24–D26).
3. **Wire.** Subscriptions are data: `call` (consumer → target) or `event` (source port → sink/action port). One is
   live when both ends are members and fit; otherwise waiting or broken (`runtime/subscriptions.ts`).
4. **Call.** A handler calls out through `ctx.one/optional/any/all/first/fallback/each(selector, client => …)`; the
   selector filters the instance's live call subscriptions in its home runtime (D3, D11). `ctx.publish(op, data)`
   delivers to live event subscriptions in every runtime the instance is a member of (D17). Every message is policed
   and booked by the runtime it travels in (D19).
5. **Compose.** The application holds runtimes; `place(instance, from, to)` makes an instance a member of another
   runtime without copying it (D28). Runtimes may be only defined and are opened when needed (D31, D35).
6. **Save.** `saveDoc(app)` writes every runtime as data; `loadDoc` defines them and opens those listed in `open`,
   never provisioning (D37–D42).

## FAQ

**Subscription or connection?** A subscription is the edge as data: saved, edited, possibly waiting. A connection is a
subscription that is live now (both ends present and fitting). Verbs only see connections; saving writes subscriptions.
`runtime/subscriptions.ts`, `runtime.status(id)`.

**Why can't my code call any instance it finds?** Calls only travel over the caller's subscriptions (D3), so every
reachable target is visible, saved and policed. To use something from another runtime, place it into yours first (D6).
Hosts call in from outside through the pod (`member.pod.invoke`, D45).

**What happens when two instances match `one`?** `Fail: ambiguous`. `one` never guesses: narrow the selector (tags,
implementation), unplug one, or use `any`, `first` or `fallback` (`runtime/calls.ts`). Provisioning likewise leaves a
dependency with two matching members unsatisfied (`2 match`, D25).

**Where do domain failures go?** In the op's output, as values: the signer's `{ status: 'denied' }`, the composer's
`{ status: 'disabled' }`. `Fail` is for platform failures only (threw, timeout, denied by policy, invalid input or
output, missing, ambiguous); the pod turns every misbehaviour into one (`pod.ts`, `result.ts`).

**What does placing do?** Makes an instance a member of a second runtime, sharing its pod: callers there can subscribe
to it, and its publishes reach subscribers there (D17, D28). It still calls out through its home runtime (D11).
Removing or replacing it at home follows into every runtime it was placed into (D29, D34); replace it only at home
(D15).

**What does saving write?** `nano.json` v2: each runtime's own instances (implementation, id, config), its placed
members with their home, its subscriptions in order, tags, the providers used, and which runtimes are open (D37–D39).
Not live state (an instance's data), not custom policies (D39), not adopted runtimes (D33).

**Does loading provision?** No. It makes what the document says and adds its subscriptions; anything that does not fit
is skipped with a note (D24, D40).

**Mutual dependencies?** Allowed: a provisioning pass makes everything first, then wires; calls into the pass wait for
it, and calls during an instance's own `make` fail at once (D26).

**How does a component adapt to what is plugged in?** `ctx.hasDependencies(role)` / `ctx.listDependencies()`: the
messenger's inbox falls back to a local map, its composer reports disabled (`examples/messenger/providers.ts`).

**Where do binary values go?** Base64 strings in the schema (D2); the signer's keys and signatures.
