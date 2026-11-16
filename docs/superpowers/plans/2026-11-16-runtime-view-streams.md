# One Delivery Primitive, Four Use Cases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every delivery in a runtime goes through `send`. Emissions carry `{ input, output }`. Listeners can be
`AsyncIterable`s, and sources are methods. Pods hear other pods added and removed. Each runtime has its own filtered
stream. Each use case is proven by its own test file.

**Architecture:** `Hear` is deleted, and the host's `subscribe` becomes an `On` (`application/messages.ts`) owned by
`'host'`. `emit` passes an emission object, so pipes keep sending `output` while `On`s get the whole emission. The
iterable form, source methods, the pod-change listener and `RuntimeView.listen` are thin layers over `live.ons`,
`publish`, `apply`'s diff and `trace`.

**Tech Stack:** Bun, TypeScript, TypeBox.

**Spec:** `docs/superpowers/specs/2026-11-16-runtime-view-streams-design.md`

## Global Constraints

- CLAUDE.md: no new exported name, public method or option beyond the spec's "New public names". Reviewers report any other export.
- Every source file stays ≤150 lines, every exported object type ≤10 members, and every export is listed in `design.md`.
  `packages/nano/structure-baseline.json` may only shrink.
- No new `AppEvent` type, and no second stream: `RuntimeView.listen` filters `trace`.
- Each message is policed by `send` as it is today. The `'subscribe'` and `'lifecycle'` questions are asked once, when
  a listener connects, and again on `apply`.
- An action emission is `{ input, output }` and an event emission is `{ output }`. A pipe passes only `output` to its target.
- Tests: `cd packages/nano && bun test --isolate`; `cd packages/ui && bun test --isolate`;
  `cd packages/ui-workspace && bun test --isolate && bun run build`; `cd examples && bun test --isolate`;
  `cd templates/nano-template && bun test`; root `bunx tsc --noEmit`. Never a bare root `bun test`; never `git add -A` at the root.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A listener on a pod that `apply` later removes:** iteration ends, and nothing is left in `live.ons`. Task 2's test.
2. **Breaking out of `for await` before anything arrives:** the listener is removed. Task 2's test.
3. **A source method that throws mid-way:** a `failure` for that pod appears on the stream, and the pod's other actions keep working. Task 3's test.
4. **A policy that denies `'subscribe'`:** `on` or `subscribe` returns a no-op unsubscribe, an iterable that ends at once, and one `denied` on the stream. Task 1's test.
5. **A pod placed in two runtimes:** each runtime's `listen` sees that pod's lifecycle events. Task 4's test.

---

### Task 1: One primitive. `Hear` goes, emissions are `{ input, output }`, and subscribe is policed once

**Files:**
- Modify: `packages/nano/src/application/messages.ts` (delete `Hear`; `On.fn` takes an emission; `On.from` is the source pod; `ons: Set<On>`)
- Modify: `packages/nano/src/application/emit.ts` (delete `hear`; `act` emits `{ input, output }`; `emit(live, from, port, emission, chain?)`, where pipes get `emission.output`)
- Modify: `packages/nano/src/application/context.ts` (`on` asks `refusal(runtime, self, to, 'subscribe')` once and gets the emission; `publish` emits `{ output: data }`)
- Modify: `packages/nano/src/application/resolve.ts` (`subscribe(op, fn)` finds the one pod through `placement`, asks `'host'`→pod `'subscribe'` once, and adds an `On` with `to: 'host'`)
- Modify: `packages/nano/src/application/index.ts` (`reconcile` re-asks `'subscribe'` for every `On` when the policy changes; a refused one is deleted and traced `denied`)
- Modify: `packages/nano/src/context.ts` (`Selection.on`'s `fn` gets `Emission<O>`: `{ input: In; output: Out }` for an action, `{ output: Out }` for an event)
- Modify: callers of `selection.on` in `packages/nano/test`, `packages/ui/src`, `packages/ui-workspace/src` (`d => …` becomes `({ output }) => …`)
- Test: `packages/nano/test/use-cases/subscription.test.ts`

**Interfaces:**
- Produces: `type Emission<O>` (internal to `context.ts`, used by Tasks 2–3). `On = { runtime; from; port; to; gone(); fn(e: { input?: unknown; output: unknown }): unknown }`. `emit(live, from, port, e: { input?: unknown; output: unknown }, chain?)`.

- [ ] **Step 1: Write the failing tests** in `test/use-cases/subscription.test.ts`:
  - `'a pipe Subscription delivers each emission's output to the target action'`: deploy `ticker` (event `tick: Number`) piped to `sink.record(Number)`. `ctx.publish(tick, 3)` makes `sink` record `3`.
  - `'apply removing the pipe ends it'`: after `apply` without the subscription, publishing `4` records nothing.
  - `'on gets { input, output } for an action and { output } for an event'`: a pod wired by a call edge to `store` gets `{ input: {key,value}, output: null }` on `put`.
  - `'a denied subscribe is asked once, at connect: no-op unsubscribe, one denied event'`: a policy counting `'subscribe'` questions that denies them. `on` is asked exactly once, the stream has one `denied`, and later puts deliver nothing.
- [ ] **Step 2:** `cd packages/nano && bun test --isolate test/use-cases/subscription.test.ts`. Expected: the `on` and policy tests FAIL.
- [ ] **Step 3:** Implement as the Files list says. `send` stays the only delivery path, and an `On` delivery uses `work` as today.
- [ ] **Step 4:** Run every suite and `bunx tsc --noEmit`. Expected: all green. `examples/todo`'s host-subscriber tests pass unchanged.
- [ ] **Step 5:** Commit `refactor(nano)!: one delivery primitive: Hear is an On; emissions are { input, output }; subscribe policed once`.

### Task 2: The no-callback form is an `AsyncIterable`

**Files:**
- Create: `packages/nano/src/application/iterate.ts`, with `iterate<T>(listen: (fn: (v: T) => void) => () => void, ended: (stop: () => void) => void): AsyncIterable<T>`. It buffers without a bound (`// ponytail: unbounded buffer, add backpressure when a slow consumer matters`). `return()` unsubscribes.
- Modify: `packages/nano/src/application/context.ts` (`on(op)` without `fn` → `iterate`; it ends when the build closes or `gone()`)
- Modify: `packages/nano/src/application/resolve.ts` (`subscribe(op)` without `fn` → `iterate`)
- Modify: `packages/nano/src/context.ts` (the `on` overload)
- Test: `packages/nano/test/use-cases/programmatic.test.ts` (first part)

**Interfaces:**
- Produces: `Selection.on(op): AsyncIterable<Emission<O>>`, and `subscribe(op): AsyncIterable<{ input; output }>` on the runtime view.

- [ ] **Step 1: Failing tests:**
  - `'on(op) iterates emissions made after it starts; break removes the listener'`: puts `a` then `b`, iterate, then put `c`. The loop sees only `c`. After `break`, the size of `live.ons` is back to what it was before (assert through a later put reaching nothing: a counting listener).
  - `'break before anything arrives removes it'`.
  - `'a removed pod ends the iteration'`: `apply` removing the source → the `for await` finishes.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** All suites and tsc green.
- [ ] **Step 5:** Commit `feat(nano): on(op) and subscribe(op) without a callback are AsyncIterables`.

### Task 3: Sources are methods

**Files:**
- Modify: `packages/nano/src/iface.ts` (`Interface.Type` maps an event `K` to `() => AsyncIterable<Out<I,K>>`)
- Modify: `packages/nano/src/plain.ts` (`plain<T>(i: Interface, client)`: an event name returns an iterable of `output`s from the client's `on`/`subscribe`; `handlers` skips events)
- Modify: `packages/nano/src/implementation.ts` (after a plain `make`, for each event op with a method: run it once per build, `publish` each yielded value, stop it at close (`return()` on the iterator), and trace a throw as `failure` for that pod)
- Modify: callers of `plain(` (`resolve.ts`, `implementation.ts` deps)
- Test: `packages/nano/test/use-cases/programmatic.test.ts` (second part)

- [ ] **Step 1: Failing tests:**
  - `'Interface.Type gives items(): AsyncIterable<Todo>'`: a type-level assertion (`expectTypeOf`-style, as in existing tests).
  - `'a source method built from a listener is published as the pod's event (hot)'`: `todos.items()` is an `async *` over `one(store).on(put)` keeping `['todos', …]` keys. The host does `frontend.get(api).items()`, add `a` (before) is unseen, and add `b` is seen as the Todo.
  - `'a throwing source traces failure; the pod's actions still work'`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** All suites and tsc green.
- [ ] **Step 5:** Commit `feat(nano): a source is a method: Interface.Type maps events to AsyncIterable, plain make sources are published`.

### Task 4: `RuntimeView`, and its own stream

**Files:**
- Modify: `packages/nano/src/application/resolve.ts` (rename `Entry`→`RuntimeView` and `entry`→`runtimeView`; add `listen(fn): () => void`)
- Modify: `packages/nano/src/application/index.ts` (types follow the rename)
- Test: `packages/nano/test/use-cases/observability.test.ts`

`listen` filters `trace.listen`. It keeps `sent` whose `runtime` is the id (and records its `id`), `delivered`/`denied` whose `id` was recorded (and then forgets it), `built`/`closed`/`restarted`/`failure` whose `pod` is placed in the runtime now, and `applied`. It drops `warning`s.

- [ ] **Step 1: Failing tests:**
  - `'frontend's listen sees todos → host traffic, not backend's todos → store'`.
  - `'each runtime sees the lifecycle of a pod placed in both'`.
  - `'app.listen still sees everything'`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** All suites and tsc green.
- [ ] **Step 5:** Commit `feat(nano): Entry is RuntimeView; RuntimeView.listen is the one stream filtered to its runtime`.

### Task 5: `ctx.addOnPodChangeListener`

**Files:**
- Modify: `packages/nano/src/context.ts` (`addOnPodChangeListener(fn: (e: { type: 'added' | 'removed'; runtime: string; pod: string; implementation: string }) => void | Promise<void>): void`)
- Modify: `packages/nano/src/application/context.ts` (registers in a new `live.podChanges: Set<…>`, removed at close)
- Modify: `packages/nano/src/application/messages.ts` (`Live.podChanges`)
- Modify: `packages/nano/src/application/index.ts` (`reconcile` compares each runtime's `pods` before and after, and for each other pod added or removed tells each listening pod placed in that runtime whose policy allows `isAllowed(listener, pod, 'lifecycle')`. Each call runs through `attempt`, and a refusal is traced `denied` once per listener.)
- Modify: `packages/ui-workspace/src/sandbox/frame-context.ts` (its `NanoContext` gains the member: a no-op until sandboxes need it)
- Test: `packages/nano/test/use-cases/lifecycle.test.ts`

- [ ] **Step 1: Failing tests:**
  - `'a pod hears another added to and removed from its runtime'`.
  - `'it hears nothing about its own runtime's pods that were there before it registered, nor about other runtimes'`.
  - `'a policy denying lifecycle stops it'`.
  - `'the listener ends when its build closes'`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** All suites and tsc green.
- [ ] **Step 5:** Commit `feat(nano): ctx.addOnPodChangeListener: a pod hears pods added to or removed from its runtimes`.

### Task 6: The todo case study and the map

**Files:**
- Modify: `examples/todo/todo/contract.ts` (`items: Op.event(Todo)`)
- Modify: `examples/todo/todo/kv.ts` (`items` is an `async *` over `deps.store`'s `put` listener, as in Task 3's test)
- Modify: `examples/todo/todo.test.ts` (add `'2. the runtime: the frontend iterates items() as todos are added'`)
- Modify: `design.md` (each new name; `Hear` and `Entry` gone; the operator convention: "whoever holds `app` is the operator; components get a `RuntimeView` or `deps`")
- Modify: `docs/superpowers/specs/2026-11-14-pods-runtimes-application-design.md` only where it names `Hear`/`Entry`

`deps.store` is a plain object without `on`. Use `ctx.one(KeyValueStoreDef.api)` to get the selection's `on`.

- [ ] **Step 1:** Write the failing example test. Run `cd examples && bun test --isolate`. Expected: FAIL.
- [ ] **Step 2:** Implement, then update `design.md`.
- [ ] **Step 3:** All suites, tsc, the structure test, and `bunx playwright test` (with `dangerouslyDisableSandbox: true`).
- [ ] **Step 4:** Commit `feat(examples): todo items() is a source over the store's puts; design.md maps the new names`.
