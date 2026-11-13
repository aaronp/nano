# The nano model: providers, pods, runtimes, connections

## Why

Nano is the foundation for a modular, shareable app ecosystem. Teams publish components with web-component UIs;
others import them, stitch them together and swap what's underneath (storage, messaging, signing) without changing
the code that uses it. Systems are built from systems: higher-level components are made from lower-level ones.

The dependencies work (spec `2026-11-12-dependencies-design.md`, now on `dev`) proved the idea but showed the model
underneath is tangled: five kinds of edge kept in five places, "System" doing four jobs, live state as the truth with
the document as a lossy export, and no single, visible picture of what depends on what. The first real use case (an
external signer used by other apps) can't be saved as data, because shared instances aren't representable.

This design re-cuts the model into distinct domains with one responsibility each, so that it is simple, explicit and
fast to test. We are in a learning phase: we keep a critical eye on whether each primitive is useful, necessary and
complete, and we judge every choice against two examples (below).

## The measuring sticks

1. **External signer.** A `signer` runtime holds a `vault` (keys) and offers `generator` (`create-keys`) and `signer`
   (`sign`: a request in, a signature or a domain failure such as `denied` out). The application places `generator`
   and `signer` into a `signer-client` runtime, where a `tester` widget uses them and a `log` records signed requests.
   A user can drag the signer runtime's view beside the tester, add a log and a map, connect them to the vault's
   `keys` source, test it, and save the result as a new `nano.json` that opens the same way anywhere.
   - Variations, later: the signer running in a sandbox while the host keeps the keys (WebAuthn PRF passkey
     encrypting an Ed25519 key, stored in the host's IndexedDB); and the signer served from its own origin
     (`my-keys.com`), using WebAuthn and storage there.
2. **Messenger.** A `persistence` runtime offers a `KeyValueStore`; a `messaging` runtime offers `publish`. A
   `messenger` application has an `inbox` (depends on `KeyValueStore`) and a `message-composer` (depends on
   messaging). Opened alone, those widgets show disabled, or fall back (local storage), until the providing runtimes
   are present.

## The domains

Each domain has one responsibility, its own coordinate, and indexes keyed on that coordinate for O(1) lookups.

| Domain | Responsibility | Coordinate |
|---|---|---|
| **Operation** | a typed message: an action (in and out), a source (out) or a sink (in); TypeBox schemas, as today | content hash (blake3) of name + canonical input schema + canonical output schema |
| **Interface** | a named group of operations (`ns/name`, or reverse-DNS such as `com.example.DB`) | its name |
| **Implementation** | code that implements one or more interfaces; declares its **dependencies**: data (config, code snippets) and interfaces | `<provider>/<name>` |
| **Provider** | a package from an author (like an npm package); usually a bridge from an existing library into nano; creates instances of its implementations; later carries metadata (signatures over hashes, licence) | `<author or ns>/<name>` (+ version, later) |
| **Registry** | a pool of providers, and so of implementations; produces a **manifest** of the interfaces, implementations and providers it holds; answers queries in O(1) (e.g. every op on offer, every implementation of an interface) | — |
| **Instance** | one made implementation | implementation coord + instance id |
| **Pod** | wraps one instance: where it runs (host, sandbox, another origin), proxies every message to it, observes messages and exceptions, and turns misbehaviour into a platform failure | the instance's coord |
| **Subscription** | a description of an edge: from a source or a caller, to a sink or an action / interface on a target; mostly drawn at design time, updated at run time as users plug things in | id |
| **Connection** | a live subscription: the subscription plus its two instances | subscription id + the two instance coords |
| **Runtime** | the orchestrator: holds a registry and its instances (in pods), creates instances through providers, runs lifecycle triggers, keeps the connections' books, applies its **policy**. Split into parts (event bus, call routing, lifecycle, eval) so it never becomes a god class | its id |
| **Application** | the host: a runtime that contains runtimes (and can nest). It places an instance from one runtime into another, firing lifecycle events in both. It gets or creates a runtime when something needs it | its id |
| **Tags** | user-driven grouping (logical layers, ownership) at every tier, keyed by coordinate; used to help users choose | — |

### Coordinates, precisely

- An operation's coordinate is derived from its content, so two ops are the same op exactly when name and schemas
  agree. Hashes are taken over a **canonical** schema (annotations such as `description` stripped), so rewording a
  description changes nothing. A changed schema is a new op: versioning by design. *(Canonical form: my call.)*
- An instance's coordinate is independent of any runtime. Being in a runtime is **membership**, so the same instance
  can be placed in several runtimes without copying (this is how `signer` is offered to `signer-client`).

### What an action is

```ts
const sign = (ctx: NanoContext, input: SignRequest): Promise<NanoResult<SignResult>> => …
```

- **`NanoResult`** is the platform's `Success | Fail`. `Fail` covers platform failures only: the implementation threw,
  timed out, was refused by policy, got invalid input, or the target is missing. The pod enforces it: a throw becomes
  a `Fail`, never an exception across the runtime.
- **Domain failures are values.** `SignResult` is the op's own discriminated union (`signed | denied | invalid | …`).
  Nano doesn't know or care about them.
- **`NanoContext`** is the implementation's only door to the world: its config, its dependencies, calls, publishing.

## How they work together

### Calls: the code states the cardinality

A consumer's live connections matching a selector `S` can be zero, one or many, and can change between
two calls (the user plugged another one in, or unplugged the only one). So calls name the interface and say, in code,
what to do with however many there are (selectors are defined below):

| Verb | Order | Calls | Gives back | With no connections |
|---|---|---|---|---|
| `ctx.one(S, fn)` | — | the single connection | its result | `Fail: missing-component`; `Fail: ambiguous` if several |
| `ctx.optional(S, fn)` | — | the single connection, if any | the result, or `none` | `none` (a value) |
| `ctx.any(S, fn)` | — | all at once | the first success, and which instance (like `Promise.any`) | `Fail: missing-component` |
| `ctx.all(S, fn)` | — | all at once | `{coord, result}[]` (like `Promise.allSettled`) | `[]` |
| `ctx.first(S, fn)` | saved | the first connection | its result | `Fail: missing-component` |
| `ctx.fallback(S, fn)` | saved | in order, until one succeeds | the success, which instance, and the failures before it | `Fail: missing-component` |
| `ctx.each(S, fn)` | saved | in order, one after another | `{coord, result}[]` in order | `[]` |
| `ctx.publish(op, data)` | — | every event connection of that source | nothing | nothing happens |

```ts
const sendMessage = async (ctx, message) =>
  ctx.one(DB, db => db.save({ key: message.id, value: message }))
```

- `fn` receives a typed client for one connected instance. Every call it makes goes through the runtime and the
  target's pod: policy-checked, schema-checked, traced, and counted on that connection.
- **Saved order** is an explicit order on a consumer's subscriptions, stored in the document and changed by dragging.
  Only the ordered verbs read it.
- **Fan-out calls every connection.** `any`, `all` and `each` over `save` write to every connected DB (useful for
  replication; documented loudly). `one` refuses to guess; use `any` for "whichever".
- A call can only reach instances the consumer is connected to. There is no calling an arbitrary discovered
  coordinate. *(Follows from the verbs; my statement of it.)*

### Subscriptions become connections

- Subscriptions are data: drawn at design time, saved in the document, edited at run time when a user plugs in,
  replaces or unplugs. When both ends exist (and policy allows), the runtime makes the connection live. When an end
  is missing, the subscription waits and becomes live when the end appears; when the ends no longer fit, it is shown
  as broken rather than dropped.
- The runtime is the bookkeeper. Because every message passes through it, the connections it reports are exactly the
  ones carrying traffic, with counts and last results. Flipping a widget over shows them.
- Replacing an instance keeps its subscriptions by port: those that still fit go live again.

### Dependencies: informational, used for provisioning and display

- An implementation declares the interfaces it depends on. The declaration is information, not a binding.
- **Provisioning.** Creating an instance of `Foo` that depends on `Bar` makes the runtime create `Bar` first, through
  its provider (recursively, with a cycle check), and connect them, when no suitable connection exists. The
  connection is recorded as a subscription like any other. *(Recording it: my call.)*
- **Display.** The host shows a component disabled when a dependency has no connection and no provider can supply
  one. The component decides its own behaviour too: `ctx.hasDependencies()` / `ctx.listDependencies()` let it disable
  a button or fall back (local storage instead of a provided `KeyValueStore`).

### Selectors, and what can change at run time

Code calls through a **selector**, not just an interface: `ctx.one(DB, fn)` is shorthand for
`ctx.one({ implements: DB }, fn)`, and a selector may add `tags`, an `implementation` or a `provider`
(`ctx.one({ implements: DB, tags: ['cache'] }, fn)`). This is how one implementation uses the same interface in two
roles (a primary and a cache DB). Declared dependencies are selectors too, named by role.

How a call finds its targets, precisely:

1. The consumer's **subscriptions** (data) list its call edges: each names a target instance, in saved order.
2. Its **connections** are those subscriptions that are live (both ends present, policy approved).
3. A verb's selector **filters** the connections to the targets that match now (the target implements the interface,
   carries the tags, is of that implementation or provider). The verb then applies its cardinality to that set.

The selector never creates a connection; it only chooses among existing ones. *(My call: keeps every reachable target
visible as data.)* A selector's tags are matched against the **target instance's** tags *(my call)*, so per-consumer
roles need distinct, tagged instances.

| Can change at run time | How | What saving then writes |
|---|---|---|
| A subscription is added, removed, retargeted or reordered (a user plugs in, replaces, unplugs, drags) | an edit to the data, checked by the runtime's policy, then reconciled live | the new subscriptions, with current target coordinates and order |
| An instance is added, removed or replaced by another implementation | lifecycle; subscriptions to it go waiting or broken, and those that still fit go live again | instances and subscriptions as they are now |
| An instance's tags | a tag edit; tag-filtered selectors see the new set on the next call | the tags |
| The selectors in code, and the declared dependencies | never: they are code | — |

A rewire the policy denies changes nothing, and the user sees the reason. A rewire it approves updates the
subscription data first, so a `nano.json` saved at any moment describes exactly the running system.

### Provisioning, precisely

*(My calls; they mirror the dependencies work's resolver.)* When an instance is created, for each declared dependency
that no connection satisfies:

1. exactly one existing instance in the runtime matches the dependency's selector → subscribe to it;
2. otherwise, exactly one implementation in the registry matches → create it (recursively, with a cycle check) and
   subscribe to it;
3. otherwise (none, or several) → leave it unsatisfied: the component shows disabled or falls back, and the host may
   offer a choice.

Loading a document never provisions: it creates what the document says and reconciles its subscriptions. Every
subscription provisioning adds is ordinary data, saved like any other.

### Policy

Each runtime has one `Policy`: `isAllowed(src, dest, data) → Approved | Denied { reason }`, consulted for every call,
publish and subscription change. `Policies.allowAll()` is the default. Coordinate allow/deny lists (O(1) on exact coordinates) come later,
and the same check filters what the UI offers.

### The Application: systems of systems

- The application is a runtime whose instances include runtimes. Nothing else is special about it, and applications
  can nest.
- **Placing** an instance from one runtime into another is how a runtime offers something: `signer` runtime makes
  `signer`, which can use the `vault` beside it, and the application places it into `signer-client` (or a chat
  runtime). Both runtimes get a lifecycle event.
- **On demand.** Opening a view that needs a runtime makes the application get or create it, from its saved
  definition. Saving writes every runtime's definition, opened or not.
- A component built from other components is just an implementation whose factory creates its own runtime. There is
  no separate "composite" concept.

### The source of truth

The data model is the truth: instance specs, memberships, subscriptions (with order), policies and tags. The runtime
reconciles to it, incrementally, whenever either side changes: a user's edit (plug in, replace, unplug) is an edit to
the data, which the runtime then makes live; a runtime change (an end appearing or disappearing) updates the
subscriptions' live status (live, waiting, broken). Saving writes the data, so nothing is lost. *(Agreed when the
one-graph model was accepted; stated here explicitly.)*

### Across runtimes

*(My calls, from the examples.)*

- A subscription lives in one runtime and joins two members of that runtime. Nothing points straight into another
  runtime: to use something from elsewhere, the application first places it into the consumer's runtime (that is
  what "offering" means).
- Each hop is policed and booked by the runtime it happens in: `tester → signer` in `signer-client`,
  `signer → vault` in `signer`.
- A subscription in a saved runtime whose end is an instance placed from an unopened runtime makes the application
  open that runtime on demand.
- Runtimes the application holds are saved in the document and editable (dragging the signer runtime beside the
  tester, adding a log). A runtime an implementation's factory builds internally is that implementation's own
  business: opaque, and rebuilt by the factory.

### Schemas, op identity and matching

- **Schema definitions are centralised**, after kerits (`kerits/packages/sdk/src/lib/schemas/schema-def.ts`,
  `messages/topic-message-def.ts`): one `defineSchema(type, schema)` returns `{ schema, type, hash, encode, decode }`,
  where `hash` is blake3 over the schema's RFC 8785 canonical JSON (kerits' `schemaSaidOf`), and `decode` checks the
  value against the schema. Every op input and output is such a definition, so a schema's identity, its checks and its
  serialisation live in one place.
- **An op's coordinate** is derived from its bare name and the two schema hashes
  (`nano.op.coords("save", RecordType.hash, SaveResultType.hash)`), so `save(Record) → SaveResult` is the same op
  wherever it appears (structural typing). Interfaces give it context: a call is routed by interface coordinate and op
  coordinate.
- **Annotations don't count** *(my call; kerits hashes the whole schema)*: `description`, `title` and `examples` are
  stripped before hashing, so rewording documentation never breaks a wire. Recorded in the decision log.
- Schemas must be JSON (canonicalisable). Binary data travels as base64 strings with a declared format, not as a
  refined `Uint8Array`, which can't be hashed or cross a frame. *(My call, from the `Bytes` finding.)*
- Call subscriptions join a consumer to an interface on a target, so their ops match exactly. Event subscriptions
  may join a source to a sink or action whose input accepts the source's output (`Ops.fits`, as today).

### Code-taking components

"Eval" is not a new subsystem: it is a component whose input is code (today's code-taking ops, with the existing
consent on load). "Code snippets" as a data dependency are config of that kind. *(My call.)*

### Data, all the way down

Everything above is data and persistable: providers to load (by coordinate and URL), runtimes, instances (implementation,
id, config, pod placement), memberships, subscriptions (with order), policies, tags, workspaces and placements of
views. A `nano.json` holds it; saving exports it (overwrite, save as, or download). Importing one document into
another app merges it; opening replaces the app (both exist today).

## Readability, tests and documentation

- **`design.md`** is the terse map: each domain, its responsibility, how they work together, and an FAQ. It points at
  the code. It is rewritten when this model lands.
- **Code comments** state each module's responsibility, with a small example.
- **Tests are the behavioural documentation.** Each domain has fast, isolated tests that read as examples:
  operations and coordinates, interfaces, providers, the registry's manifest and queries, pods (failure capture,
  sandbox), the runtime (provisioning, connections, lifecycle, policy), each `NanoContext` verb, and the application
  (placing, on-demand runtimes).
- **The examples suite is the end-to-end tests.** Each example is a standalone app with its `nano.json`, doubling as
  documentation and as a starting-point recipe; importing one into another is itself a test.
- **Readability is a requirement.** Authoring must stay as tight as runes and the dependencies spike's `example.ts`.
  Explore annotations or proxies (`@nano-interface("com.example.DB")` / `@nano-op("save")` as an equivalent of the
  explicit `nano.iface.create(...)` form) where they make code read better, without hiding what happens.

## Migration

- **A clean break.** No backwards compatibility with today's `nano.json` documents or APIs. Correctness first.
- **Scope:** the model (core and application), the host UI on it, and the examples. Other packages (`bundle`,
  `editor`, `circuit`, `elements`, `platform`, `shell`, `people`) are deferred and noted, not ported, until the model
  is right; they may break meanwhile.
- **The current sandbox deploy mode may lapse** until the sandbox pod arrives.

## Decision log

Architectural and behavioural decisions met while building are written down, not guessed: one entry each in
`docs/decisions.md` (append-only: the question, the decision, why, and what it costs if wrong). The "my call" items in
this spec are its first entries. Where behaviour is underspecified (rewiring at run time is the known case), the
builder states the behaviour in the log and pins it with a test before relying on it.

## Goals

1. The domains above, each with one responsibility, a coordinate and O(1) indexes, in code with comments and tests.
2. `NanoContext` with the call verbs, `publish`, config and dependency queries.
3. Pods: host mode first; sandbox and other-origin pods slot in behind the same proxy.
4. Runtimes that provision dependencies, keep connection books, apply policy, and fire lifecycle events.
5. The application as a nestable runtime of runtimes, with placing and on-demand runtimes.
6. A `nano.json` format that expresses everything above, including memberships and subscription order.
7. The examples suite, starting with the external signer (host mode) and the messenger, each standalone and stitched.
8. The host UI (`ui-workspace`) on the new model: plugging, replacing and unplugging connections; disabled views.

## Non-goals

- Fine-grained policies (coordinate allow/deny lists): later.
- Provider metadata (signatures, licences), versioning and a marketplace.
- The WebAuthn signer variants (sandboxed with host keys; own origin): after the host-mode signer works.
- Calling a discovered, unconnected coordinate.

## Anti-goals

- **A god runtime.** Responsibilities split into parts with their own tests.
- **Implicit wiring.** Every connection is a subscription someone can see, save and change.
- **Hidden magic.** Annotations or proxies may shorten code but must not hide a call, a connection or a failure.
- **Exceptions across the runtime.** Platform failures are `Fail` values; domain failures are op values.
- **Unreadable authoring.** If a component reads worse than runes do today, the API is wrong.

## Decided in conversation

- Operations stay as they are (typed inputs/outputs; actions, sources, sinks).
- Interfaces are named groups of operations; `ns/name` or reverse-DNS names.
- Implementations implement one or more interfaces and have data and interface dependencies.
- A provider is a package from an author (npm-like), usually a bridge from an existing system; it defines
  implementation coordinates and creates instances.
- The registry is a pool of providers with a manifest and O(1) queries.
- Subscription = design-time edge; connection = the live one with instances.
- The runtime orchestrates: creates instances through providers, runs lifecycle triggers, keeps connection books,
  and is split into sub-parts.
- Each domain has a clear coordinate; an op's is a blake3 hash of name, input and output; an instance's is its
  implementation's plus an id; lookups are O(1) on coordinates.
- The application is the host: a runtime containing runtimes, nestable, placing instances across them; it provides
  the gateway behaviour the external signer needs.
- A pod wraps an instance: sandbox vs host, observing messages and exceptions, proxying.
- Actions are `(ctx, input) => Promise<NanoResult>`; `NanoResult` is the platform's Success | Fail; domain failures
  belong to the op's own union.
- One `Policy` per runtime, `isAllowed(src, dest, data) → reason`; `Policies.allowAll()` now, richer later.
- Dependencies are informational: the runtime provisions them recursively with a cycle check; the host shows
  disabled components; components can query `ctx.hasDependencies()` / `ctx.listDependencies()` and adapt.
- Calls state their cardinality in code; the verb set above, including ordered verbs and the caveats.
- No separate composite concept: a higher-level component is an implementation with its own sub-runtime.
- Saving exports the document; import (merge) and open (replace) already exist.
- On-demand runtimes: opening something that needs a runtime gets or creates it via the application.
- Tags at the various tiers, keyed by coordinates.
- `design.md` terse and pointing at code; code comments state responsibilities with examples; fast tests per area as
  documentation; the examples suite as e2e; readability first (runes as the model; explore annotations/proxies).
- The external signer is the measuring stick for every choice.
- A clean break: no backwards compatibility; correctness first. Other packages are deferred and noted; the current
  sandbox mode may lapse.
- Code calls through selectors (interfaces, tags, …), not just interface coordinates, so one implementation can use
  an interface in several roles.
- Rewiring at run time (policy permitting) updates the subscription data, so a saved `nano.json` always has the right
  subscriptions for the running system.
- Policy returns `Approved | Denied { reason }`; only `Policies.allowAll()` for now.
- Schema definitions are centralised with their hash and codec, after kerits' `defineSchema`.
- Design and behaviour decisions are recorded as they're met, not guessed.

## Left to the builder

- Package layout (which domains live in `core` vs `app`), and how today's runtime core (calls, checks, traces) is
  carried over or rewritten.
- The exact lifecycle events and their names.
- How runes evolves to the new `NanoContext`, and whether annotations or proxies earn their place.
- How broken and waiting subscriptions are shown in the host.
