# The nano model (headless) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The new model (schemas and coordinates, interfaces, implementations, providers, registry, pods, policy,
runtimes with subscriptions and connections, `NanoContext` and its verbs, provisioning, the application, and the
`nano.json` v2 document), built headless in a fresh package and proven by the external-signer and messenger examples.

**Architecture:** A new package `packages/nano` (`@pritzlaff/nano`), one file per domain, beside today's code (a clean
break: nothing old is imported or kept compatible). The runtime is split into parts (members and lifecycle,
subscriptions and status, calls, provisioning) composed in `runtime/index.ts`. A new `examples/` workspace holds the
two measuring-stick examples as end-to-end tests with their saved `nano.json`.

**Tech Stack:** Bun 1.3, TypeScript, TypeBox 1.x (`typebox`), `json-canonicalize` (RFC 8785), `@noble/hashes`
(blake3), WebCrypto Ed25519 (the signer example).

**Spec:** `docs/superpowers/specs/2026-11-13-runtime-model-design.md`. Kerits references:
`kerits/packages/sdk/src/lib/schemas/schema-def.ts`, `kerits/packages/core/src/common/data.ts` (`schemaSaidOf`).

**Scope:** this is plan 1 of 3. Plan 2 moves the host UI (`ui-workspace`) onto the model; plan 3 grows the examples
suite with UIs (and the WebAuthn signer variants). Other packages are deferred.

## Global Constraints

- Tests: `cd packages/nano && bun test --isolate`; `cd examples && bun test --isolate`. Types: `bunx tsc --noEmit` at
  the root (add `examples` to the root `tsconfig.json` `include`). Every test file runs in well under a second; no
  real timers longer than 50 ms.
- Commit to `dev`, one commit per task, each message ending `Co-Authored-By: <the model that wrote it> <noreply@anthropic.com>`.
- No dependencies beyond `typebox`, `json-canonicalize` and `@noble/hashes`. `bun install` may need the sandbox off.
- Nothing in `packages/nano` imports another workspace package. Nothing outside `packages/nano` and `examples` changes,
  except the root `package.json` workspaces, the root `tsconfig.json` and `docs/` / `design.md`.
- Every module opens with a comment stating its one responsibility and a two-to-five-line example. Tests read as
  behavioural documentation: one behaviour per test, named as a sentence.
- **Decision log:** `docs/decisions.md`, append-only, one entry per decision (`## <n>. <question>` then **Decision**,
  **Why**, **Cost if wrong**). Any behaviour this plan leaves open is decided there, pinned by a test, before relying on
  it.
- Platform failures are `NanoResult` fails, never thrown across the runtime or the pod. Domain failures are op values.
- Calls only travel through subscriptions; there is no call by discovered coordinate.

## Review Focus

1. **A misbehaving handler** (throws synchronously, rejects, never settles, returns something that isn't a
   `NanoResult`, returns output that fails its schema) → a `Fail` of the right type, an `exception` observation, and the
   runtime keeps working. *(Task 4 tests.)*
2. **A rewire the policy denies** → the subscription data and the live connection are unchanged and the reason comes
   back. *(Task 5 test.)*
3. **A subscription whose target is removed** → status `waiting`, verbs see no connection (`one` fails
   `missing-component`), saving still writes the subscription, and re-adding the target makes it `live`. *(Task 5 and
   Task 9 tests.)*
4. **Cyclic dependencies** (A depends on B depends on A) → provisioning stops with an unsatisfied `cycle` reason; no
   loop, no stack overflow. *(Task 7 test.)*
5. **A non-JSON schema** (a `Type.Refine`, a function inside) → `defineSchema` throws a clear error when defined, never
   a wrong hash. *(Task 1 test.)*

---

### Task 1: Package, decision log, schema definitions and hashes

**Files:**
- Create: `packages/nano/package.json` (`@pritzlaff/nano`, `"type": "module"`, exports `./src/index.ts`, deps
  `typebox`, `json-canonicalize`, `@noble/hashes`), `packages/nano/src/index.ts`, `packages/nano/src/schema.ts`
- Create: `docs/decisions.md`, seeded with the spec's "my call" items (op hashes ignore annotations; binary as base64;
  selectors never create connections; selector tags match the target instance; provisioning order; subscriptions stay
  in one runtime; Eval is a code-taking component) plus this plan's: a fresh package beside the old code.
- Test: `packages/nano/test/schema.test.ts`

**Interfaces:**
- Produces, in `schema.ts`:
  - `type SchemaDef<S extends TSchema = TSchema> = { readonly type: string; readonly schema: S; readonly hash: string; check(v: unknown): v is Static<S>; encode(v: Static<S>): string; decode(json: string): Static<S> | undefined }`
  - `defineSchema<S extends TSchema>(type: string, schema: S): SchemaDef<S>`
  - `canonical(value: unknown): string`: RFC 8785 (`json-canonicalize`).
  - `canonicalSchema(schema: TSchema): string`: `canonical` of the schema with `description`, `title`, `examples` and
    `$comment` removed at every depth, except inside `properties`/`patternProperties`/`$defs` maps (there a key is a
    property name).
  - `hashOf(text: string): string`: blake3 of the UTF-8 text, lower-case hex (64 characters).

- [ ] **Step 1: Write failing tests**
  - "equal schemas hash equal, whatever their key order".
  - "a description, title or example doesn't change the hash"; "a property named `description` does".
  - "different constraints hash differently" (`Type.String()` vs `Type.String({ minLength: 1 })`).
  - "decode returns the value when it fits, undefined when it doesn't or isn't JSON".
  - "a Refine or a function in the schema throws `<type>: schema is not JSON`" **(Review Focus 5)**.
- [ ] **Step 2: Run** `cd packages/nano && bun test --isolate`. Expect FAIL (module missing). Run `bun install` first
  (root), sandbox off if needed.
- [ ] **Step 3: Implement** `schema.ts`. Detect non-JSON by comparing `canonical(schema)` round-tripped through
  `JSON.parse` with the original's own-key walk (a function or Refine leaves a difference), or by walking for
  functions; either is fine.
- [ ] **Step 4: Run** the tests and root tsc. Expect PASS.
- [ ] **Step 5: Commit** `feat(nano): a fresh package — schema definitions with canonical hashes; the decision log`

### Task 2: Ops, interfaces and results

**Files:**
- Create: `packages/nano/src/op.ts`, `packages/nano/src/iface.ts`, `packages/nano/src/result.ts`
- Test: `packages/nano/test/op.test.ts`, `packages/nano/test/result.test.ts`

**Interfaces:**
- Consumes: Task 1's `SchemaDef`, `canonical`, `hashOf`.
- Produces, in `result.ts`:
  - `type FailType = 'threw' | 'timeout' | 'denied' | 'invalid-input' | 'invalid-output' | 'unknown-op' | 'missing-component' | 'ambiguous' | 'all-failed' | 'not-found' | 'exists' | 'cycle'`
  - `type Fail = { type: FailType; reason: string; coord?: string }`
  - `type NanoResult<T> = { ok: true; value: T } | { ok: false; fail: Fail }`
  - `success<T>(value: T): NanoResult<T>`, `failure(type: FailType, reason: string, coord?: string): NanoResult<never>`,
    `isNanoResult(v: unknown): v is NanoResult<unknown>`
- Produces, in `op.ts`:
  - `type OpKind = 'action' | 'source' | 'sink'`
  - `type Op<I extends TSchema | undefined = TSchema | undefined, O extends TSchema | undefined = TSchema | undefined> = { readonly name: string; readonly kind: OpKind; readonly input?: SchemaDef<…I>; readonly output?: SchemaDef<…O>; readonly coord: string; readonly description?: string }`
  - `op.action(name, input: SchemaDef, output: SchemaDef, o?: { description?: string })`, `op.source(name, output, o?)`,
    `op.sink(name, input, o?)`
  - `coord = hashOf(canonical({ name, input: input?.hash ?? null, output: output?.hash ?? null }))`
  - `fits(source: Op, target: Op): boolean`: the source's output hash equals the target's input hash, or the target's
    input accepts anything (its canonical schema is `{}`).
- Produces, in `iface.ts`:
  - `type Interface<Ops extends Record<string, Op> = Record<string, Op>> = { readonly coord: string; readonly ops: Ops; readonly byCoord: ReadonlyMap<string, Op> }`
  - `iface<Ops>(coord: string, ops: Ops): Interface<Ops>`. Coord must match `^[a-zA-Z][a-zA-Z0-9-]*([./][a-zA-Z0-9-]+)+$`
    (`acme/db`, `com.example.DB`); otherwise throws `bad interface coordinate <coord>`. Each op's `name` must equal
    its key; otherwise throws `<coord>: op <key> is named <name>`.
  - `type Client<I extends Interface>`: for each action or sink `k`, `(input: Static<input>) => Promise<NanoResult<Static<output> | void>>`.

- [ ] **Step 1: Write failing tests**
  - "two ops with the same name and schemas have the same coord"; "same name, different output: different coord";
    "the description doesn't count".
  - "fits: equal types, or a target that takes anything".
  - "iface indexes its ops by coord"; "a bad coordinate throws"; "a key that differs from the op's name throws".
  - "isNanoResult tells results from other values".
- [ ] **Step 2: Run.** Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** tests and root tsc. Expect PASS.
- [ ] **Step 5: Commit** `feat(nano): ops with content coordinates, interfaces, NanoResult`

### Task 3: Implementations, providers, the registry and selectors

**Files:**
- Create: `packages/nano/src/implementation.ts`, `packages/nano/src/provider.ts`, `packages/nano/src/registry.ts`,
  `packages/nano/src/selector.ts`
- Test: `packages/nano/test/registry.test.ts`, `packages/nano/test/selector.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces, in `selector.ts`:
  - `type SelectorData = { implements?: string; tags?: string[]; implementation?: string; provider?: string }`
  - `type Selector = Interface | SelectorData`; `selectorData(s: Selector): SelectorData` (an Interface becomes
    `{ implements: coord }`).
  - `type Target = { instance: string; implementation: string; provider: string; provides: ReadonlySet<string>; tags: ReadonlySet<string> }`
  - `matches(s: SelectorData, t: Target): boolean`: every given field holds (all tags present).
- Produces, in `implementation.ts`:
  - `type Handler = (ctx: NanoContext, input: unknown) => Promise<NanoResult<unknown>>` (`NanoContext` is a type
    imported from Task 6's `context.ts`; declare it there now as an empty-for-now exported type if needed, and Task 6
    fills it).
  - `provide<I extends Interface>(i: I, handlers: Handlers<I>): Provided`: `Handlers<I>` has one typed handler per
    action and sink of `I` (sources have none: they are published).
  - `type Implementation = { readonly coord: string; readonly provider: string; readonly provides: readonly Interface[]; readonly dependencies: Readonly<Record<string, SelectorData>>; readonly config?: SchemaDef; readonly description?: string; make(ctx: NanoContext): Promise<ReadonlyMap<string, Handler>> }`
  - `implementation(coord: string, spec: { provides: Interface[]; dependencies?: Record<string, Selector>; config?: SchemaDef; description?: string; make(ctx: NanoContext): Provided[] | Promise<Provided[]> }): Implementation`
    - `coord` is `<provider coord>/<name>`; `provider` is everything before the last `/`.
    - `make` flattens the parts into a map keyed by op coord. It throws `<coord>: op <name> is provided twice` for a
      coord given twice, and `<coord>: missing <iface>/<op>` for an action or sink of a declared interface with no
      handler. *(Every op belongs to an interface: decision-log entry.)*
- Produces, in `provider.ts`: `type Provider = { readonly coord: string; readonly implementations: ReadonlyMap<string, Implementation>; readonly meta: Readonly<Record<string, string>> }`;
  `provider(coord: string, implementations: Implementation[], meta?: Record<string, string>): Provider`. It throws
  `<impl> is not under <provider>` when an implementation's `provider` differs.
- Produces, in `registry.ts`:
  - `type Manifest = { providers: { coord: string; implementations: string[] }[]; implementations: { coord: string; provides: string[]; dependencies: Record<string, SelectorData> }[]; interfaces: { coord: string; ops: { name: string; kind: OpKind; coord: string; input?: string; output?: string }[] }[] }`
    (data only: hashes, not schemas; sorted by coord).
  - `type Registry = { add(p: Provider): NanoResult<void>; manifest(): Manifest; provider(coord): Provider | undefined; implementation(coord): Implementation | undefined; implementationsOf(ifaceCoord): readonly Implementation[]; interface(coord): Interface | undefined; op(coord): Op | undefined }`
  - `createRegistry(): Registry`. Every lookup is a `Map` get. `add` fails `exists` (`provider <coord> is already
    registered`, or `implementation <coord> …`) and adds nothing. Two interfaces with the same coord but different op
    sets fail `exists` (`interface <coord> differs`).

- [ ] **Step 1: Write failing tests**
  - Registry: "a provider's implementations, interfaces and ops are found by coord"; "implementationsOf an interface";
    "the manifest is plain, sorted data (`structuredClone` equals it)"; "adding a clashing provider fails and adds
    nothing"; "an implementation outside its provider's namespace throws".
  - Implementation: "make maps handlers by op coord"; "a missing handler throws `<coord>: missing <iface>/<op>`".
  - Selector: "an interface selects what provides it"; "tags must all be present"; "implementation and provider narrow
    it".
- [ ] **Step 2: Run.** Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** tests and root tsc. Expect PASS.
- [ ] **Step 5: Commit** `feat(nano): implementations, providers, a registry with a manifest, selectors`

### Task 4: Pods and policy

**Files:**
- Create: `packages/nano/src/pod.ts`, `packages/nano/src/policy.ts`
- Test: `packages/nano/test/pod.test.ts`, `packages/nano/test/policy.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces, in `policy.ts`: `type Verdict = { approved: true } | { approved: false; reason: string }`;
  `type Policy = { isAllowed(src: string, dest: string, data: unknown): Verdict }`; `Policies.allowAll(): Policy`.
- Produces, in `pod.ts`:
  - `type Observation = { kind: 'message'; instance: string; op: string; input: unknown; result: NanoResult<unknown>; ms: number } | { kind: 'exception'; instance: string; op: string; error: string }`
  - `type Pod = { readonly instance: string; readonly implementation: Implementation; invoke(op: string /* coord */, input: unknown): Promise<NanoResult<unknown>>; dispose(): void }`
  - `createHostPod(instance: string, impl: Implementation, ctx: NanoContext, opts?: { timeoutMs?: number; observe?(o: Observation): void }): Promise<NanoResult<Pod>>`
    - Runs `impl.make(ctx)` once; a throw becomes `failure('threw', '<instance>: <message>')`.
    - Handlers always receive the pod's own `ctx` (the instance's home context). *(Decision-log entry: an instance
      calls out through its home runtime, wherever it is called from.)*
    - `invoke`: unknown op → `unknown-op`; input fails the op's input schema → `invalid-input`; handler throws or
      rejects → `threw` plus an `exception` observation; no settle within `timeoutMs` (default `30_000`) → `timeout`;
      returns something not a `NanoResult` → `invalid-output` (`returned something other than a NanoResult`); an `ok`
      value failing the op's output schema → `invalid-output`. Every invoke ends with one `message` observation.
    - After `dispose`, `invoke` fails `not-found`.

- [ ] **Step 1: Write failing tests** (one per row) **(Review Focus 1)**:
  - "a handler's success comes back as is"; "invalid input never reaches the handler".
  - "a synchronous throw / a rejection becomes `threw` and an exception observation".
  - "a handler that never settles times out" (`timeoutMs: 20`).
  - "a non-NanoResult return is `invalid-output`"; "an ok value that breaks the output schema is `invalid-output`".
  - "make throwing fails pod creation with `threw`".
  - "every invoke is observed once"; "a disposed pod fails `not-found`".
  - Policy: "allowAll approves anything".
- [ ] **Step 2: Run.** Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expect PASS.
- [ ] **Step 5: Commit** `feat(nano): host pods that turn misbehaviour into fails; policy`

### Task 5: The runtime — members, lifecycle, subscriptions and their status

**Files:**
- Create: `packages/nano/src/runtime/members.ts` (pods by coord, membership, lifecycle events),
  `packages/nano/src/runtime/subscriptions.ts` (the data: add, remove, retarget, reorder; status), 
  `packages/nano/src/runtime/index.ts` (composes the parts into `createRuntime`)
- Test: `packages/nano/test/runtime.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces:
  - Instance coords: `instanceCoord(implementation: string, id: string): string` = `` `${implementation}#${id}` ``;
    `parseInstance(coord): { implementation: string; id: string } | undefined`.
  - `type SubscriptionData = { id: string; kind: 'call'; from: string; to: string } | { id: string; kind: 'event'; from: string; source: string; to: string; target: string }`
    (instance coords; `source`/`target` are op coords).
  - `type Status = 'live' | 'waiting' | 'broken'`:
    - `waiting`: an end isn't a member;
    - `broken` (event): the source no longer offers `source`, the target no longer offers `target`, or they don't `fits`;
    - `broken` (call): the target provides none of the interfaces in the consumer's dependency selectors' `implements`
      (a consumer with no `implements` in any dependency: never broken);
    - otherwise `live`.
  - `type RuntimeEvent = { type: 'instance-added'; instance: string; home: string } | { type: 'instance-removed'; instance: string } | { type: 'instance-replaced'; from: string; to: string } | { type: 'subscription-set'; subscription: SubscriptionData } | { type: 'subscription-removed'; id: string } | { type: 'status'; id: string; status: Status }`
  - `type Member = { coord: string; pod: Pod; home: string }`
  - `type Runtime = { readonly id: string; readonly registry: Registry; readonly policy: Policy; create(id: string, implementation: string, opts?: { config?: unknown; provision?: boolean }): Promise<NanoResult<{ coord: string; unsatisfied: { role: string; reason: string }[] }>>; add(m: Member): NanoResult<void>; remove(coord: string): NanoResult<void>; replace(coord: string, implementation: string, opts?: { config?: unknown }): Promise<NanoResult<string>>; member(coord: string): Member | undefined; members(): readonly string[]; target(coord: string): Target | undefined; subscribe(s: Omit<SubscriptionData, 'id'> & { id?: string }): NanoResult<SubscriptionData>; unsubscribe(id: string): NanoResult<void>; retarget(id: string, to: string): NanoResult<void>; reorder(consumer: string, ids: string[]): NanoResult<void>; subscriptions(): readonly SubscriptionData[]; status(id: string): Status | undefined; listen(fn: (e: RuntimeEvent) => void): () => void }`
  - `createRuntime(id: string, opts: { registry: Registry; policy?: Policy; tagsOf?: (coord: string) => ReadonlySet<string>; idTaken?: (id: string) => boolean; pod?: { timeoutMs?: number; observe?(o: Observation): void } }): Runtime`
- **Rules:**
  - `create` fails `not-found` for an unknown implementation, `exists` when `id` is taken (here, or by `idTaken`), and
    `threw` when the pod can't be made. It builds the instance's context (Task 6 fills calls; until then a context
    whose verbs fail `missing-component` is fine) and creates the pod. `provision` defaults to `true`; Task 7
    implements it (until then `unsatisfied` lists every dependency with reason `not provisioned`).
  - `subscribe`, `retarget` and `reorder` ask `policy.isAllowed(from, to, subscription)` first; a denial returns
    `failure('denied', reason)` and changes nothing **(Review Focus 2)**. Ids default to `s1`, `s2`, … (first free).
    `reorder` takes the full list of the consumer's call subscription ids in their new order (`not-found` otherwise).
  - Subscriptions are kept in one array; a consumer's order is the array order of its call subscriptions.
  - Status is recomputed on every member or subscription change, and a `status` event fires only when it changes.
  - `remove` of the home member disposes the pod; subscriptions naming it stay and go `waiting` **(Review Focus 3)**.
  - `replace` creates the new implementation under the same id (new coord), rewrites every subscription naming the
    old coord to the new one, removes the old member, and returns the new coord. Event subscriptions whose ops the new
    implementation lacks go `broken`, not removed.

- [ ] **Step 1: Write failing tests**
  - "create adds a member and announces it"; "an unknown implementation fails `not-found`"; "a taken id fails `exists`".
  - "subscribe with both ends present is live"; "with an end missing it waits, and goes live when the end is added".
  - "a denied subscribe or retarget changes nothing and gives the reason" (a policy denying `dest` `…#b`).
  - "removing a target leaves its subscriptions waiting" **(Review Focus 3)**.
  - "replace keeps subscriptions that still fit and marks an event subscription broken when the op is gone".
  - "reorder changes a consumer's call order; a partial list fails `not-found`".
  - "status events fire only on change".
- [ ] **Step 2: Run.** Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** tests and root tsc. Expect PASS.
- [ ] **Step 5: Commit** `feat(nano): runtimes — members, lifecycle, subscriptions as data with live status`

### Task 6: NanoContext — the call verbs, publish and dependency queries

**Files:**
- Create: `packages/nano/src/context.ts`, `packages/nano/src/runtime/calls.ts` (routing, policy per message, books)
- Modify: `packages/nano/src/runtime/index.ts`
- Test: `packages/nano/test/context.test.ts`

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces, in `context.ts`:
  - `type Found<T> = { value: T; from: string }`
  - `type NanoContext = { readonly instance: string; readonly runtime: string; readonly config: unknown; one<I extends Interface, T>(s: I | (SelectorData & { implements?: string }), fn: (c: Client<I>) => Promise<NanoResult<T>>): Promise<NanoResult<T>>; optional<…>(…): Promise<NanoResult<Found<T> | { none: true }>>; any<…>(…): Promise<NanoResult<Found<T>>>; all<…>(…): Promise<{ from: string; result: NanoResult<T> }[]>; first<…>(…): Promise<NanoResult<T>>; fallback<…>(…): Promise<NanoResult<Found<T> & { failures: { from: string; fail: Fail }[] }>>; each<…>(…): Promise<{ from: string; result: NanoResult<T> }[]>; publish(op: Op, data: unknown): Promise<void>; hasDependencies(role?: string): boolean; listDependencies(): { role: string; selector: SelectorData; satisfied: boolean; targets: string[] }[] }`
  - The typed selector form: `ctx.one(DB, db => db.save(r))` and `ctx.one({ ...DB-selector, tags: ['cache'] } , …)`;
    the client's type comes from the interface passed (or a `{ implements: DB }` wrapper helper `sel(DB, { tags })`
    returning `Interface & SelectorData` so typing survives; export `sel`).
- Produces, on `Runtime`: `books(id: string): { calls: number; last?: NanoResult<unknown> } | undefined`.
- **Rules (the spec's verb table, exactly):**
  - Targets = the consumer's **live call** subscriptions in this runtime, in saved order, whose target `matches` the
    selector (with `tagsOf`).
  - Each client call asks `policy.isAllowed(from, to, input)` (`denied` fail if not), then `pod.invoke`, then counts
    the call and the last result on that subscription's books.
  - `one`: 0 → `missing-component` (coord = the selector's `implements`), >1 → `ambiguous`. `optional`: 0 →
    `{ none: true }`, >1 → `ambiguous`. `any`: all at once, first `ok` wins; 0 → `missing-component`; none ok →
    `all-failed` (reason lists each `from: fail.reason`). `all`: all at once, `[]` for 0. `first`: the first in order.
    `fallback`: in order until one is ok; 0 → `missing-component`; none ok → `all-failed`. `each`: in order, waiting for
    each.
  - `publish(op, data)`: checks `data` against the op's output schema (a bad publish is dropped and observed as an
    exception), then delivers to every live event subscription with `from` = this instance and `source` = `op.coord`,
    **in every runtime where the instance is a member** (each runtime polices its own deliveries). *(Decision-log
    entry.)* Delivery is `pod.invoke(target, data)` on the listener; results are booked, never returned.
  - A dependency is `satisfied` when at least one live call subscription's target matches its selector.

- [ ] **Step 1: Write failing tests** (a `DB` interface with `save`; three tiny DB implementations `a`, `b`, `c`, one
  failing with a domain-free `threw`):
  - One test per verb row for 0, 1 and several connections, asserting the exact result shapes and fail types.
  - "ordered verbs follow the saved order; reorder changes `first`".
  - "fan-out calls every connection" (`all` over `save`: every DB holds the record).
  - "a tag selector sees a tag added after the call before" (re-tag between two calls).
  - "a denied message fails `denied` and isn't delivered".
  - "books count calls and keep the last result".
  - "publish reaches every live event subscription, in each runtime the instance belongs to".
  - "listDependencies and hasDependencies reflect the live connections".
- [ ] **Step 2: Run.** Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expect PASS.
- [ ] **Step 5: Commit** `feat(nano): NanoContext — cardinality verbs over live connections, publish, dependency queries`

### Task 7: Provisioning

**Files:**
- Create: `packages/nano/src/runtime/provision.ts`
- Modify: `packages/nano/src/runtime/index.ts`
- Test: `packages/nano/test/provision.test.ts`

**Interfaces:**
- Consumes: Tasks 3, 5, 6.
- Produces: `create(…, { provision: true })` fills `unsatisfied` with `{ role, reason }` per dependency still
  unsatisfied, where reason is `nothing matches`, `<n> match`, `cycle: <a> → <b> → <a>` or the nested create's fail
  reason.
- **Rules (the spec's order):** for each dependency with no matching live connection: exactly one member (not the
  instance itself) matches → subscribe to it; else exactly one implementation in the registry matches (by `implements`,
  `implementation`, `provider`; a selector with only `tags` matches no implementation) → create it with id
  `<last segment of its coord>-<first free n from 1>` (recursively, provisioning its own dependencies) and subscribe;
  else unsatisfied. A creation stack of implementation coords detects cycles **(Review Focus 4)**. Created instances
  and subscriptions are ordinary data.

- [ ] **Step 1: Write failing tests**
  - "an existing single match is connected, nothing is made".
  - "a single provider is made and connected, recursively" (`Foo → Bar → Baz`).
  - "two matching implementations leave it unsatisfied with `2 match`".
  - "a cycle stops with `cycle: …`" **(Review Focus 4)**.
  - "`provision: false` makes nothing".
- [ ] **Step 2: Run.** Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expect PASS.
- [ ] **Step 5: Commit** `feat(nano): provisioning — connect the one match, or make the one provider, with a cycle check`

### Task 8: The application — runtimes of runtimes, placing, tags, on demand

**Files:**
- Create: `packages/nano/src/application.ts`
- Test: `packages/nano/test/application.test.ts`

**Interfaces:**
- Consumes: Tasks 3–7, and `RuntimeDef` from Task 9 (define its type here and re-export it from `document.ts` in
  Task 9): `type RuntimeDef = { id: string; policy?: 'allow-all'; instances: { id: string; implementation: string; config?: unknown }[]; members: { instance: string; home: string }[]; subscriptions: SubscriptionData[] }`.
- Produces:
  - `type Application = Runtime & { runtime(id: string): Runtime | undefined; createRuntime(id: string, opts?: { policy?: Policy }): NanoResult<Runtime>; adopt(child: Runtime): NanoResult<void>; define(def: RuntimeDef): NanoResult<void>; definition(id: string): RuntimeDef | undefined; open(id: string): Promise<NanoResult<Runtime>>; place(instance: string, from: string, to: string): NanoResult<void>; runtimes(): readonly string[]; tag(coord: string, tag: string): void; untag(coord: string, tag: string): void; tagsOf(coord: string): ReadonlySet<string> }`
  - `createApplication(id: string, opts: { registry: Registry; policy?: Policy }): Application`: its own runtime (the
    root) plus children. Children share its registry, its `tagsOf`, and an application-wide `idTaken` (instance ids
    are unique in the application). `adopt` adds an existing runtime (another application included) as a child:
    nesting. *(Placing across nested applications is out of scope: decision-log entry.)*
- **Rules:**
  - `place(instance, from, to)`: `from` must hold the instance (`not-found`); `to`'s policy approves
    `isAllowed(from-runtime id, to-runtime id, instance)`; `to.add({ coord, pod, home })`. `from` emits nothing new;
    `to` emits `instance-added` with its `home`. Removing an instance from its home removes it from every runtime.
  - `open(id)`: an opened runtime is returned as is; a defined one is built from its definition: open the home runtime
    of every member first (cycle-safe: a runtime being opened is skipped), create its instances with
    `provision: false`, place its members, then add its subscriptions (they may wait). An undefined, unopened id fails
    `not-found`.
  - `runtimes()` lists opened and defined ids.

- [ ] **Step 1: Write failing tests**
  - "a placed instance is a member of both, and calls into it are policed by the runtime they happen in".
  - "a placed instance calls out through its home runtime's subscriptions".
  - "removing it at home removes it everywhere; subscriptions to it wait".
  - "opening a defined runtime opens the runtimes its members come from first".
  - "instance ids are unique across the application"; "tags are shared, so a tag selector works in every runtime".
  - "an application can be adopted as a child of another".
- [ ] **Step 2: Run.** Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expect PASS.
- [ ] **Step 5: Commit** `feat(nano): the application — runtimes of runtimes, placing, shared tags, opened on demand`

### Task 9: The `nano.json` v2 document

**Files:**
- Create: `packages/nano/src/document.ts`
- Test: `packages/nano/test/document.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 5, 8.
- Produces:
  - `NanoDocSchema` (TypeBox): `{ nano: 2, title: string, providers: string[], runtimes: RuntimeDef[], tags: Record<string, string[]>, open?: string[], workspaces?: unknown[] }`
    (`open`: runtimes to open on load; `workspaces` is opaque here: plan 2 defines it). Ids use
    `^[^/\s#\x00-\x1f\x7f]{1,64}$`; at most 50 runtimes, 500 instances and 2000 subscriptions per runtime.
  - `checkDoc(json: unknown): NanoDoc | string` (never throws).
  - `saveDoc(app: Application, opts?: { title?: string; workspaces?: unknown[] }): NanoDoc`: every runtime, opened
    (read from live: instances by `create` order with their config if they were given one, members placed in with
    their home, subscriptions in array order) or not (its definition, unchanged); providers = the registry's provider
    coords in use; tags with at least one tag.
  - `loadDoc(doc: NanoDoc, opts: { registry: Registry; policy?: Policy }): Promise<{ app: Application; notes: string[] }>`:
    define every runtime, then open those in `open`. Notes, never throws: `provider <coord> is not registered`,
    `<runtime>/<id>: no implementation <coord>` (that instance skipped), `<runtime>: member <coord> has no home
    <runtime>`, `<runtime>/<sub id>: <reason>` for a subscription that can't be added.
- **Rule:** `loadDoc(saveDoc(app))` then opening the same runtimes gives the same members, subscriptions (ids, order,
  status) and tags.

- [ ] **Step 1: Write failing tests**
  - "a round trip gives the same runtimes, members, subscriptions in order, and tags".
  - "an unopened runtime is saved from its definition, unchanged".
  - "a subscription to a removed target is still saved, and waits after loading" **(Review Focus 3)**.
  - "an unknown implementation gives a note and the rest loads"; "checkDoc refuses a v1 document with a reason".
- [ ] **Step 2: Run.** Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expect PASS.
- [ ] **Step 5: Commit** `feat(nano): nano.json v2 — every runtime saved as data, loaded and opened on demand`

### Task 10: The measuring sticks, and `design.md`

**Files:**
- Create: `examples/package.json` (`@composable/examples`, private, depends on `@pritzlaff/nano` via `workspace:*`);
  add `examples` to the root `package.json` workspaces and root `tsconfig.json` `include`.
- Create: `examples/external-signer/interfaces.ts`, `providers.ts`, `external-signer.test.ts`, `nano.json`
- Create: `examples/messenger/interfaces.ts`, `providers.ts`, `messenger.test.ts`, `nano.json`
- Rewrite: `design.md` (the terse map of the new model: each domain, its responsibility, its file in
  `packages/nano/src`, how they work together, and an FAQ; a first line saying the other packages still run on the old
  core until plan 2/3).

**Interfaces:**
- Consumes: everything above.
- **External signer** (provider `example.signer`):
  - Interfaces: `example.signer.KeyGenerator` (`create-keys`: `{ count: 1..10, purpose: string }` →
    `{ keys: string[] }`, base64 raw Ed25519 public keys); `example.signer.Signer` (`sign`:
    `{ publicKey: string, purpose: string, payload: string /* base64 */ }` → `{ status: 'signed', signature: string } | { status: 'denied', reason: string } | { status: 'unknown-key' }`);
    `example.signer.Vault` (`store`, `sign-with` actions and a `keys` source of `{ publicKey, purpose }[]`).
  - Implementations: `example.signer/vault` (WebCrypto Ed25519 keys in memory; a purpose other than the key's is
    `denied`), `example.signer/generator` and `example.signer/signer` (each depends on `{ vault: Vault }`),
    `example.signer/tester` (depends on `{ signer: Signer, generator: KeyGenerator }`), `example.signer/log` (a `log`
    interface with an `append` sink and an `entries` source), `example.signer/map` (formats `keys` into log lines).
  - Test: runtimes `signer` (vault, generator, signer) and `signer-client` (tester, log); the application places
    `generator` and `signer` into `signer-client`. Assert: the tester gets keys and a valid signature (verified with
    WebCrypto); a wrong purpose returns `denied` as a value (`ok: true`); vault → map → log entries appear; replacing
    the vault with a fresh one keeps every subscription live; `saveDoc` equals the committed `nano.json` and loading it
    reproduces a working signer.
- **Messenger** (provider `example.messenger`):
  - Interfaces: `example.messenger.KeyValueStore` (`get`, `put`), `example.messenger.Messaging` (`publish` action,
    `messages` source).
  - Implementations: `memory-store`, `messaging` (depends on nothing), `inbox` (dependency `store: KeyValueStore`;
    `ctx.hasDependencies('store')` false → keeps messages in a local `Map`, the documented fallback),
    `composer` (dependency `messaging: Messaging`; its `send` returns `{ status: 'disabled' }` as a value when
    unsatisfied).
  - Test: open `messenger` alone (with `provision: false`) → composer reports disabled, inbox uses its fallback; open
    `persistence` and `messaging`, place their instances into `messenger`, subscribe → messages flow and are stored;
    unplug the store (unsubscribe) → inbox falls back again; round trip through `nano.json`.
- **`design.md`:** terse; points at files; FAQ answers at least: "Subscription or connection?", "Why can't my code
  call any instance it finds?", "What happens when two instances match `one`?", "Where do domain failures go?",
  "What does placing do?", "What does saving write?".

- [ ] **Step 1: Write the two example tests** (they fail: nothing exists).
- [ ] **Step 2: Run** `cd examples && bun test --isolate`. Expect FAIL.
- [ ] **Step 3: Implement** the interfaces and providers; generate each `nano.json` once with `saveDoc` (a small
  script or a test helper writing it when an env flag is set) and commit it.
- [ ] **Step 4: Run** examples and `packages/nano` tests, plus root tsc. Expect PASS. Then rewrite `design.md`.
- [ ] **Step 5: Commit** `feat(examples): the external signer and messenger as end-to-end cases; design.md for the new model`

## Rulings made while planning (ledger)

- **Ruling:** a fresh package beside the old code, not a rewrite in place. Clean break without breaking the running
  host until plan 2 switches it. Cost if wrong: one package rename.
- **Ruling:** every op belongs to an interface (an implementation has no loose ops). Keeps the manifest and selectors
  one shape. Cost if wrong: a "local interface" helper later.
- **Ruling:** an instance calls out through its home runtime's subscriptions; it publishes into every runtime it is a
  member of. Matches the signer (calls the vault at home) and a client-side log (listens where it was placed). Cost if
  wrong: a per-runtime context per member.
- **Ruling:** instance ids are unique across an application; the coord is `<implementation>#<id>`. Cost if wrong: a
  runtime-qualified id.
- **Ruling:** placing across nested applications is out of scope; nesting is adoption only. Cost if wrong: a
  cross-application place later.
- **Ruling:** `workspaces` are opaque in the v2 document until plan 2.
