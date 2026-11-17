# Pods, Runtimes and an Application Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `packages/nano` into one deployment and one `create` per level — `Pods`, `Runtime`, `Application`
— with closing, pipes from events and action results, and selections that call and subscribe, so every todo test in
`test/pods-runtimes.test.ts` and `test/runtimes-and-closing.test.ts` passes and the examples run on it.

**Architecture:** `Pods.create` and `Runtime.create` are pure: they validate their own deployment and return immutable
values (a scoped lookup of pod descriptions; placement and wiring over a scope). `Application.create(runtimes)` is the
only live step: it mounts pods (the factory is the mount), routes calls through call edges, delivers emissions along
pipes and `on` subscriptions, and closes instances (running their close listeners) on restart, change, removal and
`close()`. Today's `src/application/` is split and extended, not rewritten.

**Tech Stack:** Bun, TypeScript (strict), TypeBox, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-11-14-pods-runtimes-application-design.md` (binding), on top of
`2026-11-14-values-and-application-design.md` (its "Closing an instance" section and everything not revised).

## Global Constraints

- **No concept drift (CLAUDE.md).** New public names are exactly: `Pods`, `Runtime` (value + type each),
  `PodDeployment`, `RuntimeDeployment`, `AppDeployment`, `assemble`, `Selection`. Removed: `Deployment`,
  `checkDeployment`. Anything else public is `NEEDS_CONTEXT`. Internal helpers under `src/application/` are allowed
  (not re-exported from `src/index.ts`; one mention each in `design.md`).
- `test/structure.test.ts` passes every commit: no `src` file over **150 lines**, no exported type over **10 members**,
  every export in `design.md` in backticks; the baseline stays empty.
- Member counts: `NanoContext` 6 (`self`, `runtimes`, `one`, `all`, `publish`, `addOnCloseListener`); `Application` 6
  (`call`, `apply`, `restart`, `deployment`, `listen`, `close`); `Pods` 4; `Runtime` 3; `Selection` 4.
- Never thrown: every public operation and every `Selection` method returns a `NanoResult` or resolves; FailTypes stay
  the eight in use.
- Limits and id rule unchanged (50 runtimes, 5000 pods, 2000 subscriptions per runtime; `/^[^/\s#\x00-\x1f\x7f]{1,64}$/`).
- Commands: `cd packages/nano && bun test --isolate`; `cd examples && bun test --isolate`; `bunx tsc --noEmit` at the
  repo root. **All three green at every commit** (each task updates the examples it breaks). Branch `dev-examples`;
  never stage `kerits/`, `designs/`, `spikes/`; never a bare `bun test` at the root. Trailer
  `Co-Authored-By: <model name> <noreply@anthropic.com>`.

## Decisions this plan makes (for the user to confirm before execution)

1. `pods.select` with a duplicate name is `invalid-input`.
2. Pipe cycles are allowed (decided with the user): the runtime records `correlation` and `cause` on every `sent` where
   it can see the chain, for a later monitor; nothing is refused.
3. After `app.close()`, emissions already being delivered finish; nothing new is delivered.

## Review Focus

1. `pods.select(['a', 'a'])` → `invalid-input` — test in Task 1.
2. Two runtimes built from different `Pods` holding the same name with different pod values → `Application.create` is `invalid-input` — test in Task 2.
3. A pipe cycle stops when a step fails, and its messages share one `correlation` with `cause` links — test in Task 4 (spec behaviour 15).
4. An `on` subscription whose call edge `apply` removes stops hearing; a later emission doesn't reach it — test in Task 4.
5. `app.close()` while a pipe delivery is in flight: the delivery settles, and a later emission is not delivered — test in Task 4.

---

## File structure (after the plan)

| File | Responsibility |
|---|---|
| `src/pods.ts` | `PodDeployment`, `Pods.create`, `select` (descriptions, scoped lookup) |
| `src/runtime.ts` | `RuntimeDeployment`, `Subscription`, `Runtime.create` (placement, edges, pipes, port fit, cycles) |
| `src/deployment.ts` | `AppDeployment`, `assemble` |
| `src/context.ts` | `NanoContext`, `Selection` types |
| `src/application/index.ts` | `Application.create(runtimes, opts)` and its six members |
| `src/application/instances.ts` | builds, restart, close listeners |
| `src/application/messages.ts` | one policed message; host clients |
| `src/application/context.ts` | the pod's context: selections over call edges, `publish` |
| `src/application/emit.ts` | emissions: pipes and `on` subscriptions, in every runtime the pod is placed in |
| `src/application/apply.ts`, `stream.ts` | diff; events |

---

### Task 1: Pods and Runtime as validated values

**Files:**
- Create: `src/pods.ts`, `src/runtime.ts`; Modify: `src/deployment.ts` (becomes `AppDeployment` + `assemble`), `src/index.ts`, `src/application/*` (use `assemble` inside today's `Application.create(deployment, opts)`; the `'event'` kind becomes `'pipe'`)
- Modify: `examples/**` (subscription kind `'event'` → `'pipe'` in tests and `nano.json`)
- Test: `test/pods-runtimes.test.ts` (flip behaviours 1–3), `test/deployment.test.ts` (rename to `test/assemble.test.ts`; each validation case now asserted at the level that owns it)

**Interfaces:**
- Produces:
  - `type PodDeployment = Record<string, Pod>`; `Pods.create(d: unknown, opts: { registry: Registry }): NanoResult<Pods>`; `type Pods = { names(): string[]; get(name: string): Pod | undefined; select(names: string[]): NanoResult<Pods>; deployment(): PodDeployment }` — `Pods` also carries its `registry` internally (not a member) for `Runtime.create` to resolve implementations.
  - `type Subscription = { kind: 'call'; from: string; to: string } | { kind: 'pipe'; from: string; source: string; to: string; target: string }`; `type RuntimeDeployment = { pods: string[]; subscriptions: Subscription[]; policy?: 'allow-all' }`; `Runtime.create(id: string, d: unknown, pods: Pods): NanoResult<Runtime>`; `type Runtime = { readonly id: string; readonly pods: Pods; deployment(): RuntimeDeployment }`.
  - `type AppDeployment = { pods: PodDeployment; runtimes: Record<string, RuntimeDeployment>; tags?: Record<string, string[]> }`; `assemble(d: unknown, registry: Registry): NanoResult<Record<string, Runtime>>`.
  - A pipe's source is an event **or an action** of `from`; its target an action of `to` whose input fits the source's data (event data, or the action's output).

- [ ] **Step 1: Write the failing tests.** Flip behaviours 1–3. In `test/assemble.test.ts`, port every `deployment.test.ts` case to the level that owns it (pods: names, implementation, config, 5000; runtime: placed pods within scope, ends placed, duplicates, ports fit incl. action-result sources, dependency rule, 2000; app: 50 runtimes, runtime ids), keeping each reason assertion. Add Review Focus 1, and: a runtime with a pipe cycle is accepted; and a pipe from an action result whose output doesn't fit the target's input → `invalid-input`.
- [ ] **Step 2: Run** `cd packages/nano && bun test --isolate test/pods-runtimes.test.ts test/assemble.test.ts` — expected FAIL (`Pods` undefined).
- [ ] **Step 3: Implement.** Move validation out of `deployment.ts` into `pods.ts` and `runtime.ts`; values are frozen copies (`structuredClone` in, clones out). Keep today's `Application.create(appDeployment, opts)` working by calling `assemble` and reading the deployments back from the runtimes.
- [ ] **Step 4: Run** all three commands — expected all PASS (todos stay todo).
- [ ] **Step 5: Commit** `feat(nano): Pods and Runtime are validated values; pipes may come from action results`.

### Task 2: Application over runtimes

**Files:**
- Modify: `src/application/index.ts` (+ whatever the split needs), `src/index.ts`
- Modify: `examples/**` (create via `assemble` + `Application.create(runtimes, opts)`)
- Test: `test/values-and-application.test.ts` (port to `assemble` + `Application.create(runtimes, opts)`; behaviour 12 of the spec), `test/pods-runtimes.test.ts` (flip 4, 5, 6, 13), `test/runtimes-and-closing.test.ts` (flip revised behaviour 17)

**Interfaces:**
- Consumes: Task 1.
- Produces: `Application.create(runtimes: Record<string, Runtime>, opts: { policies?: Record<string, Policy>; timeoutMs?: number }): Promise<NanoResult<Application>>`; `Application` keeps `call`, `apply(next: AppDeployment)`, `restart`, `deployment(): AppDeployment`, `listen` (`close` arrives in Task 3). `apply` uses the registry carried by the runtimes' `Pods`.

- [ ] **Step 1: Write the failing tests.** Port and flip as listed. Add Review Focus 2. Add: `Application.create({})` (no runtimes) succeeds and `deployment()` is `{ pods: {}, runtimes: {} }`.
- [ ] **Step 2: Run** the nano suite — expected FAIL in the flipped tests.
- [ ] **Step 3: Implement.** The application's pod table is the union of the runtimes' scopes (a name must mean the same pod everywhere); `deployment()` rebuilds the `AppDeployment` from it and the runtimes; `apply(next)` calls `assemble(next, registry)` and reconciles as today.
- [ ] **Step 4: Run** all three commands — expected all PASS.
- [ ] **Step 5: Commit** `feat(nano): Application.create composes runtimes`.

### Task 3: Closing

**Files:** Modify `src/application/instances.ts`, `index.ts`, `stream.ts`, `context.ts`, `src/context.ts`; Test `test/runtimes-and-closing.test.ts` (flip 18–24).

**Interfaces:**
- Produces: `ctx.addOnCloseListener(fn: (e: { reason: 'restarted' | 'removed' | 'changed' | 'closed' }) => void | Promise<void>): void`; `app.close(): Promise<NanoResult<void>>`; `AppEvent` gains `{ type: 'closed'; pod: string; reason: … }`; an internal per-instance "closed" hook Task 4 uses to drop `on` subscriptions.

- [ ] **Step 1: Flip** behaviours 18–24.
- [ ] **Step 2: Run** `cd packages/nano && bun test --isolate test/runtimes-and-closing.test.ts` — expected FAIL.
- [ ] **Step 3: Implement** per "Closing an instance": each build has its own listener list; restart, apply (removed/changed), a failed build and `close()` run them in order, each awaited within `timeoutMs`, failures on the stream; close before rebuild; after `close()`, calls are `not-found`, `apply`/`restart` are `invalid-input` (`application is closed`), and a second `close()` is a no-op success.
- [ ] **Step 4: Run** all three commands — expected all PASS.
- [ ] **Step 5: Commit** `feat(nano): instances close — listeners, reasons and app.close()`.

### Task 4: Emissions and selections

**Files:** Create `src/application/emit.ts`; Modify `src/application/context.ts`, `messages.ts`, `stream.ts`, `src/context.ts`; Modify `examples/**` (`ctx.one(X).value.op(…)` → `ctx.one(X).call.op(…)`); Test `test/pods-runtimes.test.ts` (flip 7–11, 14, 15).

**Interfaces:**
- Consumes: Task 3's per-instance closed hook.
- Produces: `type Selection<I> = { readonly ok: boolean; readonly fail?: Fail; readonly pod?: string; readonly runtime?: string; readonly call: Client<I>; on(op: Op, fn: (data: unknown) => void | Promise<void>): () => void }` — on a failed selection `call.<op>` resolves to its `Fail` and `on` is a no-op returning a no-op; `ctx.one(s): Selection`, `ctx.all(s): Selection[]`; `sent` gains `kind: 'call' | 'pipe' | 'on'`, `correlation: string` and `cause?: string` (spec "Messages and the stream").

- [ ] **Step 1: Write the failing tests.** Flip 7–11, 14, 15. Add Review Focus 4 and 5. Add: a host call's `sent` has `correlation` equal to its own `id` and no `cause`.
- [ ] **Step 2: Run** `cd packages/nano && bun test --isolate test/pods-runtimes.test.ts` — expected FAIL.
- [ ] **Step 3: Implement.** An emission (an event published, or a successful action result whoever called it) is handed to `emit.ts`, which sends one message per matching pipe and per live `on` subscription, in every runtime the pod is placed in, in deployment order then subscription order; each delivery's `sent` carries the chain (a delivery of an action's result: `correlation` from that call, `cause` = its id; an event published from code: a new chain, per the spec); the caller's result is returned without awaiting deliveries (keep the promises so `close()` can let in-flight ones settle). `on` subscriptions belong to the subscribing instance and are dropped when it closes, when its returned function is called, or when the call edge they were selected through is gone at delivery time.
- [ ] **Step 4: Run** all three commands — expected all PASS, 0 todo anywhere.
- [ ] **Step 5: Commit** `feat(nano): pipes carry events and action results; selections call and subscribe`.

### Task 5: Documentation

**Files:** `design.md`, `docs/decisions.md`, `CLAUDE.md`.

- [ ] **Step 1:** `design.md`: the three levels (data / assembled / live) as one table; "How it works" in the new spec's order (deployments per level → assemble → create → mount → calls through edges → emissions → change → close → save); FAQ adds: call edges vs pipes vs `on`; scoping with `select`; why `Pods`/`Runtime` are inert; closing. Every export in backticks.
- [ ] **Step 2:** `docs/decisions.md`: one entry per spec item (decided with the user, 2026-11-14) and one per "Open" item and per "Decisions this plan makes" (controller ruling, surfaced to the user), each naming what it supersedes (D70–D89 where they conflict).
- [ ] **Step 3:** `CLAUDE.md` "The model" points at the new spec (and the previous one for what it doesn't revise).
- [ ] **Step 4: Run** all three commands — expected PASS. **Commit** `docs: design.md, decisions and CLAUDE.md for pods, runtimes and an application`.
