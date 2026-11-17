# Effect Pods Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `packages/nano` around standalone pods that are the effect boundary a runtime invokes through, so
the 17 todo tests in `packages/nano/test/effect-pods.test.ts` and the 5 in `examples/` pass, and the guardrail
baseline shrinks.

**Architecture:** A `Pod` wraps one instance of one implementation (`implementation.make(config)`), knows only the
names of the runtimes it is registered in, and is invoked only with a `NanoContext` a runtime makes. A runtime is a
map of coords to pods plus subscriptions, policy and one stream; a handler's verbs search its pod's subscriptions in
every runtime the pod is in. The application defines runtimes over one document-level `pods` table and starts them on
demand; there are no gateways, homes, pod ids or instance counts.

**Tech Stack:** Bun, TypeScript (strict), TypeBox, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-11-13-runtime-model-design.md`, section "The pod is the effect boundary" and
its behaviours 1–12 (supersedes the pods revision wherever they disagree). Map: `design.md`.

## Global Constraints

- **No concept drift (CLAUDE.md).** No export, public method, option, event or failure type beyond the ones this plan
  names. Anything else is a question for the user, reported as `NEEDS_CONTEXT`, never a ruling.
- `packages/nano/test/structure.test.ts` must pass at the end of every task: no `src` file over **150 lines**, no
  exported interface/object type over **10 members**, every export in `design.md` (in backticks), except what
  `packages/nano/structure-baseline.json` lists. The user has agreed to the baseline **shrinking** in this plan: edit it
  by hand to lower a number or drop an entry; never raise a number or add an entry, and never run `NANO_BASELINE=1`.
- Never-thrown results: every public operation returns `NanoResult`; failure types are the existing `FailType`s only.
- A coord is `<implementation>#<n>`; `n` is per implementation per runtime, starts at 0, never reused.
- Limits kept from D54/D56: per runtime at most **500** pods and **2000** subscriptions; at most **49** runtimes
  besides the root; a document at most **5000** pods.
- Tests: `cd packages/nano && bun test --isolate`; `cd examples && bun test --isolate`; types: `bunx tsc --noEmit` at
  the repo root. Never a bare `bun test` at the root. Never switch branches; never stage `kerits/`, `designs/`, `spikes/`.
- Commit trailer: `Co-Authored-By: <your model name> <noreply@anthropic.com>`.

## Decisions this plan makes (approved by the user before execution)

1. **`Pod`** (`pod.ts`): `Pod.create(implementation, { config? })` → `Pod` with exactly `implementation` (its coord, a
   string), `config`, `state` (`'starting' | 'running' | 'failed' | 'stopped'`), `runtimes` (names), `invoke(ctx,
   port, input)`, `call` (`pod.call.<op>(ctx, input)`, by op name), `swap({ config? })`, `dispose()`, and
   `join(runtime, changed)` → leave function (how a runtime adds its name and hears state changes). `createHostPod` goes.
2. **`Implementation.make(config)`**, no context. `ctx.config` is removed (a handler closes over the config `make`
   got), which keeps `NanoContext` at 13 members with `runtimes` added.
3. **A starting pod is available.** `invoke` waits for the make in progress; a subscription is `waiting` only while an
   end is `failed`, `stopped` or not registered. This makes the provisioning pass-gate unnecessary.
4. **`Runtime`** has exactly 18 members: `id`, `policy`, `register(pod, coord?)`, `unregister(coord)`, `pod(coord)`,
   `pods()`, `next()`, `call(coord)`, `subscribe`, `unsubscribe`, `retarget`, `reorder`, `subscriptions()`,
   `status`, `books`, `listen`, `warn`, `provision(coord)`. Gone: `create`, `addInstance`, `add`, `scale`,
   `removeInstance`, `restart`, `remove`, `swap`, `record`, `instances`, `target`, `registry`, `connect`, `settling`.
5. **One way to add an edge:** `subscribe` takes each end as a coord or an `EndSelector`, now
   `{ coord } | { implements, tags? } | { implementation, tags? }` matching exactly one registered pod (no instance part).
6. **Provisioning is synchronous** (`rt.provision(coord)` → `NanoResult<Unsatisfied[]>`): pods are created and
   registered, then subscribed, in one turn, so no call can interleave.
7. **Stream:** `pod-created { coord, implementation }`, `pod-removed { coord }`, `pod-swapped { coord }`, and
   `pod-state { coord, state, reason? }` replacing `instance`. Host calls are `from: 'host'`.
8. **Application:** `place` goes (register `a.pod(c)` into `b`); `define({ pods, runtimes })` takes the document's pod
   table and runtime definitions together; starting a runtime makes each pod key once, application-wide, and registers
   it at its saved coord; `RuntimeOpts.next` restores counters.
9. `rt.call(coord).<op>` and `pod.call.<op>`: an op name offered by two of the pod's interfaces is `ambiguous`.

## Review Focus

1. A pod registered twice in the same runtime: the second `register` fails `invalid-input` (`already here as <coord>`); test in Task 2.
2. A pod unregistered while a call through that runtime is in flight: the call finishes; the next is `not-found`; test in Task 2.
3. `dispose()` on a pod in two runtimes: `pod-state stopped` on both streams, their subscriptions wait, calls give `missing`; test in Task 2.
4. Two overlapping swaps: the last asked wins; the earlier resolves `invalid-input` and never becomes the instance; test in Task 1.
5. A publish from a pod in two runtimes whose subscriber is subscribed in both: delivered once per subscription (twice), each on its own stream; test in Task 2.

---

## File structure

| File | Responsibility after this plan |
|---|---|
| `src/implementation.ts` | `make(config)` |
| `src/pod.ts` | `Pod`: one instance, invoke with checks/timeouts/failure capture, swap, dispose, state, runtimes |
| `src/context.ts` | `NanoContext` type (+ `runtimes`, − `config`) |
| `src/selector.ts` | `SelectorData` + `runtime`; `EndSelector` without an instance part |
| `src/runtime/index.ts` | assembles a `Runtime` from the parts below (≤150 lines) |
| `src/runtime/pods.ts` | coords, counters, register/unregister, the module-level map pod → its runtimes' wiring |
| `src/runtime/subscriptions.ts` | subscriptions as data, status, edits (subscribe/unsubscribe/retarget/reorder), cascade |
| `src/runtime/calls.ts` | one policed, recorded message; host `call` |
| `src/runtime/verbs.ts` | the context a runtime makes: verbs over the pod's subscriptions in all its runtimes, publish |
| `src/runtime/connect.ts` | `EndSelector` → one coord |
| `src/runtime/provision.ts` | the synchronous pass |
| `src/runtime/trace.ts` | the stream (event union updated) |
| `src/application.ts`, `src/application-start.ts` | runtimes, definitions, start; the pod table |
| `src/document.ts` | `nano.json` with a `pods` section |

Every file stays ≤150 lines; the four baseline line entries disappear by the end of Task 4.

---

### Task 1: The pod

**Files:**
- Modify: `src/implementation.ts` (make takes config), `src/pod.ts` (rewrite), `src/runtime/index.ts` (call
  `Pod.create` where it called `createHostPod`; only enough to stay green), `src/context.ts` (remove `config`)
- Test: `test/pod.test.ts` (rewrite), `test/effect-pods.test.ts` (flip the pod-only tests)

**Interfaces:**
- Produces: `Pod.create(impl: Implementation, opts?: { config?: unknown; timeoutMs?: number }): Pod`;
  `type PodState = 'starting' | 'running' | 'failed' | 'stopped'`;
  `type Pod = { readonly implementation: string; readonly config: unknown; readonly state: PodState; readonly runtimes: readonly string[]; invoke(ctx: NanoContext, port: string, input: unknown): Promise<NanoResult<unknown>>; readonly call: Record<string, (ctx: NanoContext, input: unknown) => Promise<NanoResult<unknown>>>; swap(opts?: { config?: unknown }): Promise<NanoResult<void>>; dispose(): Promise<void>; join(runtime: string, changed: (state: PodState, reason?: string) => void): () => void }`;
  `Implementation.make(config: unknown): Promise<ReadonlyMap<string, Handler>>`.

- [ ] **Step 1: Write the failing tests.** In `test/pod.test.ts`, keep every existing host-pod behaviour (unknown op,
  invalid input/output, throw → `threw` + reported, timeout, late settle ignored) rewritten against `Pod.create` with a
  stub ctx (`{ runtime: 't', instance: 'x#0', runtimes: ['t'] } as NanoContext`). Add:
  - `pod.state` is `'starting'` synchronously after create, `'running'` after `await settle()`; a throwing make → `'failed'` and `invoke` gives `{ ok: false, fail: { type: 'missing' } }` whose reason contains the make's message;
  - `invoke` before the make settles waits for it and succeeds;
  - `join('a', fn)`, `join('b', fn)` → `runtimes` is `['a', 'b']`; calling the first leave function → `['b']`; `changed` receives `'running'` when the make settles;
  - two overlapping `swap({ config: 1 })`, `swap({ config: 2 })` with a slow make: the first resolves `invalid-input`, the second `success(undefined)`, and the pod answers with config 2 (Review Focus 4);
  - `dispose()` → `state` `'stopped'`, `changed('stopped')`, `invoke` → `missing`, `swap` → `{ ok: false }`.
  In `test/effect-pods.test.ts` flip to `test(...)`: "given an implementation and config, when a pod is created…" only if
  it passes without a runtime change; otherwise leave it for Task 2. Remove nothing else.
- [ ] **Step 2: Run** `cd packages/nano && bun test --isolate test/pod.test.ts` — expected FAIL (`Pod` is undefined).
- [ ] **Step 3: Implement** `Pod` in `src/pod.ts` and `make(config)` in `src/implementation.ts`. `Pod` is a value with
  a `create` function (`export const Pod = { create }` plus `export type Pod`). The instance is held as a promise of
  its handlers; `swap` makes the new one off to the side and switches only if it is still the latest swap asked;
  calls already inside the old instance finish there. Update the old runtime's call site so the rest of the suite
  stays green; tests that used the context inside `make` (`application`, `trace`, `context`, `pods`, `provision`)
  change only that `make` to take config.
- [ ] **Step 4: Run** `cd packages/nano && bun test --isolate` and `bunx tsc --noEmit` at the root — expected PASS (todos stay todo).
- [ ] **Step 5: Commit** `feat(nano): a standalone pod around one instance made from config`.

### Task 2: The runtime around pods

**Files:**
- Modify (rewrite): `src/runtime/index.ts`, `src/runtime/pods.ts`, `src/runtime/subscriptions.ts`,
  `src/runtime/calls.ts`, `src/runtime/connect.ts`, `src/runtime/provision.ts`, `src/runtime/trace.ts`,
  `src/selector.ts`, `src/context.ts`
- Create: `src/runtime/verbs.ts`
- Test: `test/effect-pods.test.ts` (flip behaviours 1–8 and the runtimes, not-found, throw, policy, ambiguous tests;
  remove the `@ts-nocheck` line and the `nano as unknown` cast, importing `Pod` directly), `test/runtime.test.ts`,
  `test/context.test.ts`, `test/trace.test.ts`, `test/provision.test.ts` (port), `test/pods.test.ts` (delete)

**Interfaces:**
- Consumes: Task 1's `Pod`.
- Produces: `createRuntime(id: string, opts: { registry: Registry; policy?: Policy; tagsOf?: (coord: string) => ReadonlySet<string>; next?: Record<string, number>; pod?: { timeoutMs?: number } }): Runtime` with the 18 members of decision 4:
  `register(pod: Pod, coord?: string): NanoResult<string>` (a given coord must be `<pod.implementation>#<n>` and free; the counter becomes at least n+1);
  `unregister(coord: string): NanoResult<void>`; `pod(coord: string): Pod | undefined`; `pods(): readonly string[]` (register order);
  `next(): Readonly<Record<string, number>>`; `call(coord: string): Record<string, (input: unknown) => Promise<NanoResult<unknown>>>`;
  `subscribe(s: NewSubscription | NewConnection): NanoResult<SubscriptionData>` where `NewConnection` ends are `string | EndSelector`;
  `provision(coord: string): NanoResult<Unsatisfied[]>`; the rest keep today's signatures.
  `SelectorData` gains `runtime?: string`. `NanoContext` gains `readonly runtimes: readonly string[]`.
  `RuntimeEvent` per decision 7.

- [ ] **Step 1: Write the failing tests.** Flip the effect-pod tests named above. Add to `test/runtime.test.ts` the
  Review Focus tests:
  - registering the same pod twice in one runtime → second is `{ ok: false, fail: { type: 'invalid-input' } }` with reason containing `already here as acme/keys/vault#0`;
  - unregister while a gated call is in flight → that call resolves `success`, the next `rt.call` → `not-found`;
  - a pod in `a` and `b`, each with a subscriber, `dispose()` → `pod-state` `stopped` on both streams, both statuses `waiting`, `rt.call` → `missing`;
  - a source pod in `a` and `b` with one sink pod subscribed in both → one publish gives two `delivered` sink calls, one on each stream.
  Port the remaining tests of `runtime`, `context`, `trace` and `provision` whose behaviour the spec keeps; delete
  those about counts, scaling, placing, homes, instance indices, pass waiting and calls during `make`. List every
  deleted test name in the report.
- [ ] **Step 2: Run** `cd packages/nano && bun test --isolate test/effect-pods.test.ts test/runtime.test.ts` — expected FAIL (`rt.register` is not a function).
- [ ] **Step 3: Implement.** Approach where the tests leave a choice:
  - `runtime/pods.ts` keeps a module-level `WeakMap<Pod, Map<string, Wiring>>` (runtime id → what verbs need of that runtime), set on register and cleared on unregister alongside `pod.join`'s leave function;
  - `verbs.ts` builds the context a runtime passes on each invocation: for a pod, the candidates are, across every runtime in that map, the live call subscriptions from the pod's coord there whose target matches the selector (including `runtime`); each call is sent through the runtime that holds that subscription; `publish` delivers in every runtime the pod is in;
  - unregister cascades only that runtime's subscriptions naming the coord, emits `pod-removed`, calls the leave function;
  - provisioning per spec "Provisioning, precisely", with `Pod.create(impl)` + `register` standing for "make".
- [ ] **Step 4: Run** `cd packages/nano && bun test --isolate test/effect-pods.test.ts test/runtime.test.ts test/context.test.ts test/trace.test.ts test/provision.test.ts test/pod.test.ts test/structure.test.ts` — expected PASS except behaviours 9 and 12 (Task 3). `application.ts`, `document.ts`, their tests and `examples/` are knowingly red until Tasks 3–4; say so in the report.
- [ ] **Step 5: Shrink the baseline** for `runtime/index.ts`, `runtime/calls.ts` and `Runtime` (to 18), and drop removed names from `undocumented`.
- [ ] **Step 6: Commit** `feat(nano): runtimes register pods; verbs search every runtime a pod is in`.

### Task 3: Application and document

**Files:**
- Modify (rewrite): `src/application.ts`, `src/document.ts`
- Create: `src/application-start.ts` if `application.ts` would pass 150 lines
- Test: `test/application.test.ts`, `test/document.test.ts` (port), `test/effect-pods.test.ts` (flip behaviours 9, 12)

**Interfaces:**
- Consumes: Task 2's `Runtime`, `register(pod, coord)`, `pod`, `pods`, `next`, `RuntimeOpts.next`.
- Produces: `type PodDef = { implementation: string; config?: unknown }`;
  `type RuntimeDef = { id: string; policy?: 'allow-all'; pods: { coord: string; pod: string }[]; next: Record<string, number>; subscriptions: SubscriptionData[] }`;
  `Application.define(d: { pods: Record<string, PodDef>; runtimes: RuntimeDef[] }): NanoResult<void>`;
  `NanoDoc` = `{ nano: 2, title, providers, pods: Record<string, PodDef>, runtimes: RuntimeDef[], tags, start?, workspaces? }`;
  `saveDoc` writes pod keys `p0`, `p1`, … in first-registered order across runtimes (root first, then children in creation order).

- [ ] **Step 1: Write the failing tests.** Flip behaviours 9 and 12. Port `application` and `document` tests whose
  behaviour the spec keeps (define/start/notes/warning/adopt/tags/limits/round-trip/checkDoc errors); delete those
  about placing, members, homes and instance indices, listing them in the report. Add: a document whose runtime refers
  to an unknown pod key → that entry is skipped with a note containing the key; a document with 5001 pods → `checkDoc`
  returns a string containing `5001`.
- [ ] **Step 2: Run** `cd packages/nano && bun test --isolate` — expected FAIL in the flipped tests.
- [ ] **Step 3: Implement.** The application keeps the pod table and a `Map<key, Pod>` of pods made so far, so a key
  starting in a second runtime registers the same pod object. Starting registers each entry at its saved coord, then
  adds subscriptions (skipping with a note what cannot be added); it never provisions and never starts another runtime.
- [ ] **Step 4: Run** `cd packages/nano && bun test --isolate` — expected PASS, 0 todo in `effect-pods.test.ts`.
- [ ] **Step 5: Shrink the baseline** (`application.ts`, `document.ts`, `Application`), then commit `feat(nano): one pods table; runtimes refer to it`.

### Task 4: Examples

**Files:**
- Modify: `examples/external-signer/*`, `examples/messenger/*` (both `nano.json` regenerated by their tests' save
  path), `examples/etl/etl.test.ts`, `examples/migration/migration.test.ts`, `examples/messenger/send.test.ts`
- Create: `examples/etl/{interfaces,providers}.ts`, `examples/migration/{interfaces,providers}.ts` (move the
  definitions out of the tests); `Send` and its implementation move into `examples/messenger/{interfaces,providers}.ts`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1:** Flip the five example todos, remove their `@ts-nocheck` lines and casts, and move definitions out of the test files.
- [ ] **Step 2:** Port `external-signer.test.ts` and `messenger.test.ts` to `Pod.create`/`register`/`subscribe`/`rt.call`
  (the `press` helper becomes `rt.call(coord).<op>(input)`). The signer pod is registered in `signer` (wired to its
  vault) and in `signer-client`; the vault never is in `signer-client`.
- [ ] **Step 3: Run** `cd examples && bun test --isolate` and `bunx tsc --noEmit` at the root — expected PASS, 0 todo.
- [ ] **Step 4: Commit** `feat(examples): ETL, migration and shared send on effect pods`.

### Task 5: Documentation and the guardrail

**Files:** `design.md`, `docs/decisions.md`, `packages/nano/structure-baseline.json`

- [ ] **Step 1:** Rewrite `design.md`'s domain table, "How they work together" and FAQ for this model: no
  placing/homes/scaling/gateways; sharing is registering; verbs across runtimes; the `runtime` selector; saving with a
  `pods` table. Every export appears in backticks.
- [ ] **Step 1b:** In the spec, bring the rows that still describe the old model in line with decisions 3–5: the
  `EndSelector` block (no instance part), "Unavailable vs deleted" (a starting pod is available), and the "Can change
  at run time" table (no scaling or counts).
- [ ] **Step 2:** Append decisions 57+ to `docs/decisions.md`, one per item of "Decisions this plan makes", each citing the user's approval.
- [ ] **Step 3:** Shrink `undocumented` in the baseline to what is still undocumented.
- [ ] **Step 4: Run** all three verification commands — expected PASS.
- [ ] **Step 5: Commit** `docs: design.md and decisions for effect pods`.
