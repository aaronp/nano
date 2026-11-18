# Op-level calls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Handlers know which op they are; calls made from them carry it; implementations declare their op calls and call edges record them; the workspace observes the live calls, draws them op to op, and reconciles them on request.

**Architecture:** The runtime invokes each handler with an invocation context (the pod's context plus `callingOp`, its clients continuing the invoking message's chain), so a call's `sent` event has `cause` = the invoking message and the observer reads the sender op from it. `calls` (Implementation) and `ops` (call edge) are plain data, checked where their neighbours are. The observer is a workspace module over `app.listen`.

**Tech Stack:** TypeScript, Bun tests, TypeBox, Lit, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-18-op-level-calls-design.md`

## Global Constraints

- New public names are exactly: `calls` (Implementation spec and value), `ops` (call edge), `callingOp` (context). No other new exports from `@pritzlaff/nano-core`.
- `packages/nano`: source files ≤150 lines; exported object types ≤10 members; every export described in `design.md`; `structure-baseline.json` only shrinks.
- A handler that ignores its second argument behaves exactly as today (a call through the pod's factory `ctx` starts a new chain, no `cause`).
- Tests: `cd packages/nano && bun test --isolate`; `cd packages/ui && bun test --isolate`; `cd packages/ui-workspace && bun test --isolate`; `cd examples && bun test --isolate`; `bunx tsc --noEmit` at the root; e2e `bunx playwright test` at the root (needs the sandbox disabled). Never a bare root `bun test`.
- Commit on `dev`; trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; never `git add -A` at the root.

## Review Focus

1. A handler that calls after an `await`, with another invocation of the same op in flight: each call's `cause` is its own invoking message (Task 1 test "concurrent").
2. An action called by a pipe delivery (not a call): its handler's calls are caused by the pipe message, and the observer names the handler's op as sender (Task 1, Task 5).
3. A call edge re-pointed by `apply` while a handler is mid-flight: the invocation context reads the deployment now, like the pod context (`not-found` after removal) (Task 1).
4. A sandboxed pod (frame) calling its dependency from a handler: attributed to its op, not to the pod (Task 4).
5. An old saved deployment with no `ops` and implementations with no `calls`: loads, draws pod-level call edges as today, nothing marked "not declared" until a call is seen (Tasks 3, 5).

---

### Task 1: The invocation context (core)

**Files:**
- Modify: `packages/nano/src/implementation.ts` (`Handler`, `make`'s deps per invocation)
- Modify: `packages/nano/src/context.ts` (`callingOp`)
- Modify: `packages/nano/src/application/context.ts` (`contextFor(live, name, onClose, chain?)`)
- Modify: `packages/nano/src/application/emit.ts` (`client(..., chain?)` passes `correlation`/`cause`)
- Modify: `packages/nano/src/application/messages.ts` (`deliver` builds the invocation ctx)
- Modify: `design.md` (Context, Implementations rows)
- Test: `packages/nano/test/invocation-context.test.ts`

**Interfaces:**
- Produces: `type Handler = (input: unknown, ctx?: Omit<NanoContext, 'deps'>) => Promise<NanoResult<unknown>>`.
- Produces: `NanoContext.callingOp?: string` (the port being handled; absent in the factory's ctx).
- Produces: `contextFor(live, name, onClose, invoked?: { id: string; correlation: string; port: string })`: with `invoked`, `callingOp = invoked.port`, and every `call` / `publish` / `deps` call through it is sent with `correlation = invoked.correlation`, `cause = invoked.id`. `on`, pod-change and close listeners are the build's (same as the pod ctx; they are lifecycle).
- Produces: in `implementation.ts` `make`, each handler is wrapped so `h(input, inv)` gets `inv` plus `deps` built from `inv` (same `plain(...)` construction as the factory's, over `inv.one`).
- Handler typing for authors: the plain-object form's methods and `provide`'s handlers accept an optional second parameter typed `NanoContext<D>` (plain form) / `NanoContext` (`provide`). `Client<I>` (callers' type) is unchanged: define `Handlers<I>` as its own mapped type rather than an alias of `Client<I>`.

- [ ] **Step 1: Write the failing tests** in `invocation-context.test.ts` (fixtures: interfaces `Front { send(Str): Str }`, `Store { save(Str): Str }`; impl `front` with dependency `store: Store` whose `send` is `async (x, ctx) => { await tick(); return ctx!.deps.store.save(x) }`; a second impl `lazyFront` whose `send` ignores ctx and uses the factory's `deps`):
  - `concurrent`: two `app.call('r','front').send` in parallel → the two `sent` events with `port: 'Store/save'` (use the real port string) each have `cause` equal to the id of the `sent` for their own `Front/send`, and that send's `correlation`.
  - `ignored`: with `lazyFront`, the `Store/save` `sent` has no `cause` and its `correlation` equals its own `id`.
  - `callingOp`: a handler that returns `success(ctx!.callingOp)` returns the port `'<Front coord>/send'`; the factory's ctx has `callingOp === undefined`.
  - `pipe`: a pipe into `Front/send` → the `Store/save` call's `cause` is the pipe delivery's id.
  - `gone`: `apply` removes the `front→store` edge while `send` awaits → its `save` result is `not-found`.
- [ ] **Step 2: Run** `cd packages/nano && bun test --isolate test/invocation-context.test.ts` — Expected: FAIL (ctx undefined / no cause).
- [ ] **Step 3: Implement** per Interfaces. `deliver` gets the delivering message's `{ id, correlation }` from `send` (thread it through `How`) and calls `h(input, contextFor(live, to, onCloseOfThatBuild, { id, correlation, port: p }))`; `live.instance(to)` must expose the build's `onClose` (add it to the made value if absent). Keep `messages.ts` and `application/context.ts` ≤150 lines (split a helper file if needed and list it in `design.md`).
- [ ] **Step 4: Run** the new test, then the whole package: `bun test --isolate` — Expected: all pass, `structure.test.ts` included.
- [ ] **Step 5: Commit** `feat(core): handlers get an invocation context (callingOp); their calls continue the invoking chain`.

### Task 2: `calls` on Implementation

**Files:**
- Modify: `packages/nano/src/implementation.ts`
- Modify: `design.md`
- Test: `packages/nano/test/implementation-calls.test.ts`

**Interfaces:**
- Consumes: Task 1's `Handler`.
- Produces: spec `calls?: { [op: string]: string[] }` (op name of a provided interface → `'role.op'` names); value `Implementation.calls: Readonly<Record<string, readonly string[]>>` (always present, `{}` when none). Keep `Implementation` ≤10 members (it has 7 today plus `make`).

- [ ] **Step 1: Write the failing tests:**
  - `{ calls: { send: ['store.save'] } }` with dependency `store: Store` → `impl.calls` deep-equals `{ send: ['store.save'] }`; with none → `{}`.
  - `{ calls: { nope: ['store.save'] } }` → `define` throws `/nope is not an op this implementation provides/`.
  - `{ calls: { send: ['db.save'] } }` (no role `db`) → throws `/db is not a dependency/`.
  - `{ calls: { send: ['store.nope'] } }` with `store: Store` → throws `/Store has no op nope/` (use the interface coord in the message).
  - role given as `SelectorData` without an interface → `'x.anything'` accepted (not checkable).
- [ ] **Step 2: Run** `bun test --isolate test/implementation-calls.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** checks in `define` (op names across `spec.provides`; role in `spec.dependencies`; op name in the role's interface `ops` when `isInterface`).
- [ ] **Step 4: Run** package tests — Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): implementations declare which of their ops call which dependency ops (calls)`.

### Task 3: `ops` on a call edge

**Files:**
- Modify: `packages/nano/src/runtime.ts` (type, schema, check)
- Modify: `design.md`
- Test: `packages/nano/test/runtime-call-ops.test.ts`

**Interfaces:**
- Produces: `{ kind: 'call'; from: string; to: string; ops?: { source: string; target: string }[] }`. Check in `Runtime.create`: each `source` is a port of `from`'s implementation (any op kind is fine: the sender is an action handler), each `target` an action port of `to`'s; duplicates `invalid-input`. The duplicate-edge key stays `[from, to]`.
- Deriving pairs from `calls` is not core's job: it lives in the workspace (Task 5's `declaredOps`), so core gains no export.

- [ ] **Step 1: Write the failing tests:** an edge with `ops: [{ source: '<Front>/send', target: '<Store>/save' }]` creates; a `target` the `to` pod lacks → `invalid-input` naming the port; `source` the `from` pod lacks → `invalid-input`; the schema rejects `ops: [{ source: 1 }]`; an `apply` that only changes `ops` reports the runtime in `rewired` and restarts nothing.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.** Check `application/apply.ts`'s `diff` treats an `ops` change as a rewire (it compares subscriptions; confirm, adjust only if not).
- [ ] **Step 4: Run** nano and examples suites — Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): a call edge can record its op pairs (ops), checked like a pipe's ports`.

### Task 4: Frames carry the invocation

**Files:**
- Modify: `packages/ui-workspace/src/sandbox/protocol.ts`, `stand-in.ts`, `serve.ts`, `frame-context.ts`
- Test: `packages/ui-workspace/test/sandbox-invocation.test.ts` (follow the existing stand-in tests' harness)

**Interfaces:**
- Consumes: Task 1's `Handler` second argument.
- Produces: protocol `{ type: 'call'; id; port; input }` from host to frame is unchanged; the frame's outgoing dependency call message gains `via?: number` (the host-side call `id` it is made under). The stand-in keeps `id → inv` for calls in flight and sends a frame call with `via` through `inv`'s clients; without `via` (or after it settled) through the pod ctx.
- `serve.ts` runs each handler with a frame-side ctx whose dependency clients stamp `via`.

- [ ] **Step 1: Write the failing test:** a sandboxed `front` (stand-in over a fake port pair, as existing tests do) whose `send` calls `store.save` after an `await` → the host stream's `Store/save` `sent` has `cause` = the `Front/send` message id.
- [ ] **Step 2: Run** `cd packages/ui-workspace && bun test --isolate test/sandbox-invocation.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.** Validate `via` in the protocol checker like the other numeric ids.
- [ ] **Step 4: Run** the workspace suite — Expected: PASS.
- [ ] **Step 5: Commit** `feat(workspace): a sandboxed pod's calls from a handler carry that invocation`.

### Task 5: The observer

**Files:**
- Create: `packages/ui-workspace/src/observed-calls.ts`
- Test: `packages/ui-workspace/test/observed-calls.test.ts`

**Interfaces:**
- Consumes: Task 1 (`cause`), Task 2 (`Implementation.calls`), Task 3 (`ops`).
- Produces:
  - `type OpCall = { runtime: string; from: string; to: string; source: string | null; target: string; declared: boolean; seen: boolean }` (`source` null: from the pod, no op).
  - `declaredOps(d: AppDeployment, registry: Registry): OpCall[]` — every call edge's `ops`, else derived from `from`'s implementation `calls` (role → the edge's `to` when `to` provides the role's interface; `'role.op'` → `<iface coord>/<op>`; source = `<provided iface coord>/<op>`), `declared: true, seen: false`.
  - `observeCalls(app: Application, registry: Registry): { calls(): OpCall[]; reconciled(): AppDeployment; listen(fn: () => void): () => void; stop(): void }` — reads `app.listen`; keeps `sent` by id (`to`, `port`) to resolve a call's `cause` to its sender port (only when that cause message's `to` is this call's `from`; else `source: null`); a call with `kind: 'call'` from a pod (not `'host'`) that was not denied adds/marks `seen`; `reconciled()` is `app.deployment()` with each edge's `ops` = declared ∪ seen pairs with a non-null source. Host calls and denied calls appear in `calls()` with `declared: false` and never in `reconciled()`.
  - Live `on`: `calls()` does not include them; Connections already draws `on` (leave as is).

- [ ] **Step 1: Write the failing tests** (an app from nano-core with `front`/`store`, `front` declaring `calls: { send: ['store.save'] }` and also calling `store.drop` from `send`):
  - before any call: `calls()` = `[{ from:'front', to:'store', source:'<Front>/send', target:'<Store>/save', declared:true, seen:false, runtime:'r' }]`.
  - after one `send`: save is `seen: true`; drop appears `declared:false, seen:true, source:'<Front>/send'`.
  - a call from a timer (factory ctx): `source: null`.
  - `reconciled()` edge `ops` contains both save and drop; not the null-source one.
  - an edge with no `ops` and an implementation with no `calls`: `calls()` is `[]` until a call is seen.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.** Bound the `sent` map (drop entries once `delivered`/`denied` and no longer a possible cause: keep the last 1000; `// ponytail:` the bound).
- [ ] **Step 4: Run** the workspace suite — Expected: PASS.
- [ ] **Step 5: Commit** `feat(workspace): observe op-level calls (declared, seen, not declared) and reconcile them into the deployment`.

### Task 6: Views and Save / Reconcile

**Files:**
- Modify: `packages/ui-workspace/src/wires/model.ts`, `render-back.ts` (op-to-op call lines)
- Modify: `packages/ui/src/explorer-details.ts` (pod: "calls" / "called by" op rows; operation: "called by" / "calls")
- Modify: the workspace File menu (where Save is) — add "Reconcile and save"
- Modify: `packages/ui-workspace/src/host.ts` (one observer per app; expose `host.calls()`)
- Test: unit tests beside each; e2e `e2e/examples.e2e.ts`

**Interfaces:**
- Consumes: Task 5 `observeCalls`, `OpCall`.
- Connections: a call with `source` draws from that op's coordinate to the target op's, under the existing "Call edges" checkbox; `declared && !seen` solid, `seen && declared` solid and bright, `!declared` amber dashed with a "not declared" title; `source: null` keeps today's pod-level line.
- Systems (explorer): the explorer gets `calls?: OpCall[]` on its target (optional; absent = today). Pod details: rows "calls" (`send → chatStore.save`) and "called by"; operation details: "called by" / "calls"; not-declared ones `.warn`.
- File menu: "Save" as today; "Reconcile and save" saves `reconciled()`.

- [ ] **Step 1: Write the failing tests:** model test — a `snapshotOf` with one `OpCall` yields a call cord whose endpoints are the two op coordinates; explorer test — pod details list `send → store.save` and a `.warn` "not declared" row for drop; e2e — chat example imported, a message sent, Connections shows a call cord between `messaging`'s `send` and `chatStore`'s `save` port markers, and Systems → `messaging` lists it.
- [ ] **Step 2: Run** the unit tests — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** ui, workspace and e2e — Expected: PASS.
- [ ] **Step 5: Commit** `feat(workspace): Connections and Systems show calls op to op; Reconcile and save`.

### Task 7: Examples and case study

**Files:**
- Modify: `examples/chat/*` (messaging declares `calls`, uses the handler ctx), `examples/todo/*` (todos declares `add → store.put`; a refresh timer calls `store.list` through the factory ctx)
- Create: `examples/drift/` (`index.ts`, `nano.json`, `drift.test.ts`): `submit` declared to call `store.save`, also calls `store.delete`.
- Modify: the examples combine/build lists so `drift` is served and importable.

- [ ] **Step 1: Write the failing tests:** chat — after `alice.say`, the stream has `Messaging/send` → `Store/save` with one correlation and the save's `cause` = the send; todo — `observeCalls` marks `list` with `source: null`; drift — `observeCalls` shows `delete` `declared:false`, `reconciled()` includes it.
- [ ] **Step 2: Run** `cd examples && bun test --isolate` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** all suites, `tsc`, e2e — Expected: PASS.
- [ ] **Step 5: Commit** `feat(examples): chat and todo declare their calls; a drift case study`.
