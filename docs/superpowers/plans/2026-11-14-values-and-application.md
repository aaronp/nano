# Values and a Live Application Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `packages/nano` as plain values (ops, interfaces, implementations, pods, deployments) plus one live
`Application` created from a deployment, so the 21 todo tests in `packages/nano/test/values-and-application.test.ts`
pass, the examples run on it, and the code shrinks.

**Architecture:** Everything except `Application` is a synchronous value; `checkDeployment` validates a deployment
strictly against a registry. `Application.create` holds one lazily (or eagerly) built instance per pod name, routes
every message through the runtime (a named section of the deployment) that carries it — policed, schema-checked,
timed out, recorded on one stream — and changes only by `apply(next)` or `restart(name)`.

**Tech Stack:** Bun, TypeScript (strict), TypeBox, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-11-14-values-and-application-design.md` (binding). Map: `design.md` (rewritten in Task 5).

## Global Constraints

- **No concept drift (CLAUDE.md).** No export, public member, option, event or failure type beyond this plan's
  Interfaces blocks and the spec. Anything else is `NEEDS_CONTEXT` to the controller, never a ruling.
- `packages/nano/test/structure.test.ts` passes at the end of every task: no `src` file over **150 lines**, no
  exported type over **10 members**, every export in `design.md` in backticks (add a terse mention when you add an
  export; Task 5 rewrites the file). `structure-baseline.json` may only shrink (by hand); never `NANO_BASELINE=1`.
- Never thrown: every public operation returns `NanoResult`. Failure types after Task 1: `threw`, `timeout`,
  `denied`, `invalid-input`, `invalid-output`, `unknown-op`, `ambiguous`, `not-found` (others removed).
- Limits: at most **50** runtimes, **5000** pods, **2000** subscriptions per runtime. Pod names and runtime ids follow
  the existing id rule `/^[^/\s#\x00-\x1f\x7f]{1,64}$/`.
- Default `timeoutMs` **30 000**, bounding each build and each handler.
- Commands: `cd packages/nano && bun test --isolate`; `cd examples && bun test --isolate`; `bunx tsc --noEmit` at the
  repo root. Never a bare `bun test` at the root. Branch `dev-examples`, never switched; never stage `kerits/`,
  `designs/`, `spikes/`. Commit trailer `Co-Authored-By: <model name> <noreply@anthropic.com>`.
- **Red window:** Task 1 deletes the old runtime, application, document and their tests. `examples/` stays red (tests
  and tsc) until Task 4; the nano suite and root tsc outside `examples/` are green at every commit.

## Review Focus

1. A host call to a pod whose eager build is still in progress (an `apply` adding it is still awaiting the build) waits for that same build, not a second one — test in Task 3.
2. Deployment names that break the id rule (`''`, `'a/b'`, a 65-character name) for pods or runtimes fail `invalid-input` — test in Task 1.
3. A client obtained from `ctx.one` before an `apply` removed its subscription: a later call through it is `not-found`, re-checked when sent — test in Task 3.
4. Two `apply` calls started together run one after the other in call order; the second sees the first's result as current — test in Task 3.
5. A pod removed by `apply` while a call to it is in flight: that call finishes; the next is `not-found` — test in Task 3.

---

## File structure (after Task 5)

| File | Responsibility |
|---|---|
| `src/schema.ts`, `src/iface.ts`, `src/op.ts` | schemas; interfaces with readable ports; ops: action \| event |
| `src/result.ts`, `src/policy.ts`, `src/provider.ts`, `src/registry.ts` | unchanged except the reduced `FailType` |
| `src/implementation.ts` | `implementation`, `provide`; `make(ctx, config)`; handlers take input only |
| `src/selector.ts` | `Selector`, `sel`, `matches` (+ `runtime`) |
| `src/pod.ts` | `Pod.lazy`, `Pod.eager`: values |
| `src/deployment.ts` | `Deployment`, `Subscription`, `checkDeployment` |
| `src/context.ts` | the `NanoContext` type |
| `src/application/index.ts` | `Application.create` and the five members |
| `src/application/instances.ts` | one build per pod name: lazy/eager, shared pending build, restart, timeout |
| `src/application/messages.ts` | one message: police, check, run with timeout, record; host clients |
| `src/application/context.ts` | the pod-scoped `NanoContext`: `one`, `all`, `publish` over the current deployment |
| `src/application/apply.ts` | diff of two deployments, policy on added subscriptions |
| `src/application/stream.ts` | `AppEvent` and the listener set (from `runtime/trace.ts`) |

Deleted by Task 1: `src/runtime/` (all), `src/application.ts`, `src/application-start.ts`, `src/document.ts`, and
tests `runtime`, `context`, `trace`, `provision`, `application`, `document`, `effect-pods`, `pod` (rewritten).

---

### Task 1: Values

**Files:**
- Modify: `src/op.ts`, `src/iface.ts`, `src/result.ts`, `src/implementation.ts`, `src/selector.ts`, `src/pod.ts` (rewrite), `src/context.ts` (rewrite), `src/index.ts`
- Create: `src/deployment.ts`
- Delete: the files listed above
- Test: `test/op.test.ts`, `test/selector.test.ts` (update), `test/pod.test.ts` (rewrite), `test/deployment.test.ts` (new), `test/values-and-application.test.ts` (flip behaviour 1 only)

**Interfaces:**
- Produces:
  - `op.action(name, input: SchemaDef, output: SchemaDef, opts?)`, `op.event(name, data: SchemaDef, opts?)`; `type OpKind = 'action' | 'event'`; an event's schema is its `output`; `fits(event, action)` as today's `fits`.
  - `port(i: Interface, o: Op): string` = `` `${i.coord}/${o.name}` `` (replaces `portKey`).
  - `type Handler = (input: unknown) => Promise<NanoResult<unknown>>`; `Handlers<I>` = the `Client<I>`'s actions as `(input) => Promise<NanoResult<…>>`; `provide(i, handlers): Provided`; `implementation(coord, { provides, dependencies?, config?, description?, make(ctx: NanoContext, config: any): Provided[] | Promise<Provided[]> }): Implementation` whose `make(ctx, config): Promise<ReadonlyMap<string, Handler>>` keeps today's checks (every action of every provided interface handled, nothing extra).
  - `type Pod = { implementation: string; config?: unknown; eager: boolean }` (`config` key absent when not given); `Pod.lazy(impl: Implementation, opts?: { config?: unknown }): Pod`; `Pod.eager(…)` likewise.
  - `type Subscription = { kind: 'call'; from: string; to: string } | { kind: 'event'; from: string; source: string; to: string; target: string }`; `type Deployment = { pods: Record<string, Pod>; runtimes: Record<string, { pods: string[]; subscriptions: Subscription[]; policy?: 'allow-all' }>; tags?: Record<string, string[]> }`; `checkDeployment(d: unknown, registry: Registry): NanoResult<Deployment>`.
  - `type SelectorData = { implements?: string; tags?: string[]; implementation?: string; provider?: string; runtime?: string }`; `type Target = { name: string; runtime: string; implementation: string; provider: string; provides: ReadonlySet<string>; tags: ReadonlySet<string> }`; `matches(s, t)`, `sel(I, s)`, `selectorData(s)`.
  - `type NanoContext = { readonly self: string; readonly runtimes: readonly string[]; one<I extends Interface>(s: I | SelectorData): NanoResult<Client<I>>; all<I extends Interface>(s: I | SelectorData): Client<I>[]; publish(o: Op, data: unknown): Promise<void> }`.
  - `FailType` = the eight types in Global Constraints.

- [ ] **Step 1: Write the failing tests.**
  - `test/op.test.ts`: `op.event('tick', Num).kind === 'event'`; `fits(op.event('t', Num), op.action('r', Num, Nothing))` true; with `Str` input false; `port(Log, Log.ops.record) === 'acme.Log/record'`.
  - `test/pod.test.ts`: behaviour 1's assertions, plus `Pod.lazy(counter)` has no `config` key and `Object.isFrozen` is not required.
  - `test/deployment.test.ts`, each `checkDeployment(d, registry)` → `{ ok: false, fail: { type } }` with a reason naming the offender: unknown pod in a runtime (`invalid-input`); subscription end not placed in its runtime (`invalid-input`); duplicate subscription in a runtime (`invalid-input`); event source not an event of `from` / target not an action of `to` / data not fitting (`invalid-input`); call target not providing an interface `from` declares as a dependency, when it declares any (`invalid-input`); unknown implementation (`not-found`); config not fitting the implementation's schema (`invalid-input`); 51 runtimes, 5001 pods, 2001 subscriptions (`invalid-input`); pod names / runtime ids `''`, `'a/b'`, 65 chars (`invalid-input`, Review Focus 2); a valid deployment → `success(d)` deep-equal.
  - `test/selector.test.ts`: `matches({ runtime: 'v2' }, target in 'v3')` false, in `'v2'` true.
  - Flip behaviour 1 in `values-and-application.test.ts` (leave the `@ts-nocheck` until Task 2).
- [ ] **Step 2: Run** `cd packages/nano && bun test --isolate test/op.test.ts test/pod.test.ts test/deployment.test.ts test/selector.test.ts` — expected FAIL (`op.event` / `Pod.lazy` / `checkDeployment` undefined).
- [ ] **Step 3: Implement.** Delete the old files and tests listed above. Keep `schema.ts` as is. `checkDeployment` validates shape with a TypeBox schema first, then the cross-references; it never throws. Update `src/index.ts` exports. Shrink the baseline (drop entries for deleted files and types).
- [ ] **Step 4: Run** the nano suite and `bunx tsc --noEmit` — expected: nano PASS (todos stay todo); tsc errors only under `examples/`.
- [ ] **Step 5: Commit** `feat(nano): values — ops, ports, pods, deployments; the old runtime goes`.

### Task 2: The live application: building, calls, context

**Files:**
- Create: `src/application/index.ts`, `instances.ts`, `messages.ts`, `context.ts`, `stream.ts`
- Test: `test/values-and-application.test.ts` (remove `@ts-nocheck` and the `nano as any` line; import directly; flip behaviours 2–11, 14, 15, 16)

**Interfaces:**
- Consumes: Task 1's values and `checkDeployment`.
- Produces:
  - `Application.create(d: unknown, opts: { registry: Registry; policies?: Record<string, Policy>; timeoutMs?: number }): Promise<NanoResult<Application>>`.
  - `type Application = { call(runtime: string, pod: string): Record<string, (input: unknown) => Promise<NanoResult<unknown>>>; apply(next: Deployment): Promise<NanoResult<void>>; restart(pod: string): Promise<NanoResult<void>>; deployment(): Deployment; listen(fn: (e: AppEvent) => void): () => void }` — `apply` returns `failure('invalid-input', 'not built yet')` until Task 3.
  - `type AppEvent = { type: 'built'; pod: string } | { type: 'restarted'; pod: string } | { type: 'applied'; added: string[]; removed: string[]; changed: string[]; rewired: string[] } | { type: 'sent'; id: string; runtime: string; from: string; to: string; port: string } | { type: 'delivered'; id: string; result: NanoResult<unknown>; ms: number } | { type: 'denied'; id: string; reason: string } | { type: 'failure'; pod?: string; reason: string } | { type: 'warning'; reason: string }`.

- [ ] **Step 1: Write the failing tests.** Flip the behaviours named above.
- [ ] **Step 2: Run** `cd packages/nano && bun test --isolate test/values-and-application.test.ts` — expected FAIL (`Application` undefined).
- [ ] **Step 3: Implement.**
  - `instances.ts`: `Map<name, Promise<Made>>`; a failed build deletes its entry so the next need retries; the build races `timeoutMs`; restart deletes the entry (and rebuilds an eager pod) without touching promises already handed out, so calls in flight finish on the old handlers.
  - `messages.ts`: one function sends one message in one runtime: id, `sent`, policy (`isAllowed(from, to, input)`; a throw denies), input check, build-or-get the target, run with timeout, output check, `delivered`/`denied`; `failure` for throws, timeouts and build failures. A host call is `from: 'host'`.
  - `context.ts`: the factory's ctx for pod `name`; `runtimes` and `one`/`all` read the *current* deployment at each call; `all` order is runtimes in deployment order, then subscriptions in order; a client's call re-checks its subscription still exists when sent (`not-found` otherwise); `publish(o, data)` sends one message per matching event subscription (source `port` equal to the event's port) in every runtime the pod is in.
  - `index.ts`: validate, build eager pods (`await` all, failures only on the stream), return the application.
- [ ] **Step 4: Run** the nano suite + structure test — expected PASS except behaviours 12, 13 and the second "changing" test (Task 3).
- [ ] **Step 5: Commit** `feat(nano): Application.create — lazy and eager pods, policed calls, a pod-scoped context`.

### Task 3: Changing a live application

**Files:**
- Create: `src/application/apply.ts`; Modify: `src/application/index.ts`
- Test: `test/values-and-application.test.ts` (flip behaviours 12, 13 and the refused-apply test)

**Interfaces:**
- Consumes: Task 2's instances, stream and `deployment()`.
- Produces: `apply(next)` per the spec; `diff(a: Deployment, b: Deployment): { added: string[]; removed: string[]; changed: string[]; rewired: string[] }` (pods by name; `changed` = same name, different pod value; `rewired` = runtime ids whose `pods` or `subscriptions` differ) — internal to `src/application/`.

- [ ] **Step 1: Write the failing tests.** Flip the three tests. Add Review Focus 3, 4 and 5 tests:
  - a client from `ctx.one(KV)` kept by a pod, `apply` removes that subscription, the pod's next send → `not-found`;
  - `Promise.all([app.apply(a), app.apply(b)])` → both resolve in order and `deployment()` equals `b`;
  - a gated call in flight to pod `x`, `apply` removes `x`, the gated call resolves `success`, the next `app.call(r, 'x')` → `not-found`;
  - (Review Focus 1) `apply` adds an eager pod whose factory waits on a gate; while that `apply` is pending, `app.call(r, name)` is issued; the gate opens; both resolve and the factory ran once.
- [ ] **Step 2: Run** the flipped tests — expected FAIL (`not built yet`).
- [ ] **Step 3: Implement.** `apply` runs in a queue (one at a time, in call order): `checkDeployment(next)`; for each added subscription ask that runtime's policy `isAllowed(from, to, 'subscribe')` (a throw denies); if any refuses → `denied`, nothing changes; else swap the current deployment, forget instances of removed and changed pods, build eager added or changed pods (await), emit one `applied`.
- [ ] **Step 4: Run** the nano suite — expected PASS with 0 todo.
- [ ] **Step 5: Commit** `feat(nano): apply reconciles a live application to a new deployment`.

### Task 4: Examples

**Files:** `examples/external-signer/*`, `examples/messenger/*` (incl. `send.test.ts`), `examples/etl/*`, `examples/migration/*`; each committed `nano.json` becomes a `Deployment` (regenerated through the tests' own `NANO_WRITE` path).

**Interfaces:** Consumes everything above.

- [ ] **Step 1:** Port each example's providers to `make(ctx, config)` with input-only handlers, and each test to a `Deployment` + `Application.create` + `app.call`. Keep every behavioural assertion; one deployment per example where possible, with pod names chosen for the story (`vault`, `signer`, `tester`, `send`, `db`, `etl`, …). Messenger's inbox fallback uses `ctx.all(KeyValueStore).length === 0`. List every changed assertion and why in the report.
- [ ] **Step 2: Run** `cd examples && bun test --isolate`, the nano suite and root tsc — expected all PASS, 0 errors.
- [ ] **Step 3: Commit** `feat(examples): every example is a deployment on a live application`.

### Task 5: Documentation

**Files:** `design.md`, `docs/decisions.md`, `CLAUDE.md`, `packages/nano/structure-baseline.json`

- [ ] **Step 1:** Rewrite `design.md` from the spec: one table of values and the live `Application`, "How it works" in the spec's order, an FAQ (values vs live; lazy vs eager; restart and state; sharing a pod across runtimes; cross-runtime calls and the `runtime` selector; what saving writes; strict validation; storage is a component). Every export in backticks.
- [ ] **Step 2:** `docs/decisions.md`: one decision per spec principle and per "Open" item (the "Open" items labelled "controller ruling, surfaced to the user"; the rest "decided with the user, 2026-11-14"), superseding D57–D69 where they conflict.
- [ ] **Step 3:** `CLAUDE.md`: point "The model" at the new spec; replace "A pod is the effect boundary a runtime invokes through; nothing is ever handed an instance" with "Pods and deployments are values; the `Application` is the one live thing".
- [ ] **Step 4:** Shrink the baseline to what remains. **Run** all three commands — expected PASS.
- [ ] **Step 5: Commit** `docs: design.md, decisions and CLAUDE.md for values and a live application`.
