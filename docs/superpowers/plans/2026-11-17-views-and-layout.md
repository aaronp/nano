# Views and Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A saved `nano.json` says which pods are on the page and where, in an engine-neutral form any host can read, beside the workspace's own golden-layout state.

**Architecture:** No change to `packages/nano`. The layout convention (`layout.slots`, `layout.geometry`) is types in nano-ui, the shared kit a non-workspace host would also use. The workspace writes both on Save from the dock (reusing `dockPlacements`) and, opening a file with slots but no workspace state, opens a panel per slot. The todo example proves the "two displays = two pods + a pipe" rule headlessly with `side-by-side.json`.

**Tech Stack:** Bun, TypeScript, TypeBox, Lit, golden-layout.

**Spec:** `docs/superpowers/specs/2026-11-17-host-shell-views-layout-design.md`, section 1 only.

## Global Constraints

- CLAUDE.md: no concept drift; new exports below are the ones the user approves with this plan, no others; every export in `design.md`; files ≤150 lines in `packages/nano` (not touched here).
- Tests: `cd packages/ui && bun test --isolate`; `cd packages/ui-workspace && bun test --isolate`; `cd examples && bun test --isolate`; root `bunx tsc --noEmit`; root `bunx playwright test` (needs `dangerouslyDisableSandbox: true`). Never a bare root `bun test`; never `git add -A` at root.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Don't push.
- At most one view per pod; the layout's key is the pod's instance coordinate (`runtime` + `pod`).
- `AppDeployment.layout` stays a plain object; `layout.<engine>` is the engine's own state (`layout.workspace` for the dock, as today).

**Rulings made in planning (user to confirm on review):**
- `geometry` is **absolute boxes only** this round — each slot's `{ x, y, w, h }` as fractions of the page (0..1) — because `dockPlacements` already computes exactly that; nested rows/cols are deferred until a transform needs them.
- New exports (proposed): nano-ui `type LayoutSlot = { id: string; runtime: string; pod: string }`, `type LayoutBox = { x: number; y: number; w: number; h: number }`, `type LayoutData = { slots?: LayoutSlot[]; geometry?: Record<string, LayoutBox> }` (geometry keyed by slot id). Example-only: a `put(Todo)` action on `example.todo.TodoList` (the "setState" the user described: a second list fed from the first).
- The rule "the implementation names its view" is already how the host works (`import.ts` merges a provider module's `views` export); this plan only documents it.

## Review Focus

- A file whose `slots` name a pod that is not in `pods` → the workspace skips that slot and toasts nothing fatal; the rest opens.
- A file with both `layout.workspace` and `slots` → the workspace uses its own state (`layout.workspace`), ignoring slots.
- Saving with an empty dock → `slots: []`, no `geometry` entries; reopening gives an empty dock, not an error.
- A slot whose pod has no view → it opens with the generic `nano-pod-view`.
- Pipe from list A into list B must not loop: B's `put` must not re-emit into A (only A→B is piped).

---

### Task 1: Layout types in nano-ui, documented

**Files:**
- Create: `packages/ui/src/layout.ts`
- Modify: `packages/ui/src/index.ts` (export the three types), `design.md` (nano-ui section: the types, the `layout` convention, and the rule "a provider module's `views` export names each implementation's view; `AppDeployment.views` overrides one pod; at most one view per pod")

**Interfaces:**
- Produces: `LayoutSlot`, `LayoutBox`, `LayoutData` (shapes in Global Constraints).

- [ ] **Step 1:** Write `layout.ts` with the three types and a header comment showing a `nano.json` `layout` example with `slots`, `geometry` and `workspace`.
- [ ] **Step 2:** Export from `index.ts`; add the `design.md` rows.
- [ ] **Step 3:** Run `bunx tsc --noEmit` at root and `cd packages/ui && bun test --isolate` (structure/design checks if any). Expected: clean, all pass.
- [ ] **Step 4:** Commit `feat(ui): the layout convention: slots and geometry, engine-neutral`.

### Task 2: side-by-side.json, headless

**Files:**
- Modify: `examples/todo/todo/contract.ts` (add `put: Op.action(Todo, Todo)` — "adds or replaces this todo by id, as given"), `examples/todo/todo/kv.ts` (implement `put`; it emits `items` like `add`/`update`)
- Create: `examples/todo/side-by-side.json`, `examples/todo/side-by-side.test.ts`

**Interfaces:**
- Consumes: `LayoutData` (Task 1) for typing the test's read of `layout`.

`side-by-side.json`: runtime `backend` with two kv stores `storeA`, `storeB` (`example.kv/memory`); runtime `frontend` with `listA`, `listB` (`example.todo/kv`), call edges listA→storeA, listB→storeB (in `backend`, as `nano.json` today places them — copy its policy shape), a pipe in `frontend` `{ kind: 'pipe', from: 'listA', source: 'example.todo.TodoList/items', to: 'listB', target: 'example.todo.TodoList/put' }`, `modules` as `nano.json`, and `layout: { slots: [{ id: 'a', runtime: 'frontend', pod: 'listA' }, { id: 'b', runtime: 'frontend', pod: 'listB' }], geometry: { a: { x: 0, y: 0, w: 0.5, h: 1 }, b: { x: 0.5, y: 0, w: 0.5, h: 1 } } }`.

- [ ] **Step 1: Failing tests** in `side-by-side.test.ts`:
  - `'it loads, and its slots name pods placed in their runtimes'` — `Application.load(url)`; for each slot, `app.deployment().runtimes[slot.runtime].pods` contains `slot.pod`; geometry has a box per slot id.
  - `'adding to listA shows in listB, through the pipe'` — `add('milk')` on listA; `listB.list()` titles equal `['milk']`.
  - `'updating in listA updates listB'` — `update({ id, done: true })` on A; B's todo has `done: true`.
  - `'listB is not piped back: adding to listB leaves listA alone'` — add 'eggs' to B; A's titles equal `['milk']` (from a fresh app: `[]`).
- [ ] **Step 2:** `cd examples && bun test --isolate todo/side-by-side.test.ts` → FAIL (no file / no `put`).
- [ ] **Step 3:** Add `put`, write the JSON.
- [ ] **Step 4:** Rerun → PASS; full `cd examples && bun test --isolate` → all pass (existing todo tests unaffected; `nano.json` equality tests must still hold).
- [ ] **Step 5:** Commit `feat(examples): side-by-side.json: two displays are two pods and a pipe, with a neutral layout`.

### Task 3: The workspace writes and reads slots

**Files:**
- Modify: `packages/ui-workspace/src/main.ts` (Save; Open/Import's `shown`), reuse `dockPlacements` from `src/circuit/model.ts`
- Create: `packages/ui-workspace/src/layout-data.ts` (pure: `layoutFromDock(root, runtimeOf: (pod: string) => string | undefined): LayoutData` and `dockFromSlots(slots: LayoutSlot[]): unknown` — a golden-layout config of one row of stacks, one panel per slot, in slot order, each `componentState: { name: pod }` as the dock's pod panels use)
- Test: `packages/ui-workspace/test/layout-data.test.ts`, and extend `e2e/workflow.e2e.ts`

**Interfaces:**
- Consumes: `LayoutData`, `LayoutSlot` (Task 1); `dockPlacements(screen, root)` (exists).
- Produces: `layoutFromDock`, `dockFromSlots` (module-internal to ui-workspace; not package exports).

- [ ] **Step 1: Failing unit tests:**
  - `'a dock of two side-by-side panels gives two slots and half-width boxes'` — root row with two stacks (`name: 'input1'`, `'log1'`), `runtimeOf = () => 'main'` → slots `[{id:'input1',runtime:'main',pod:'input1'},{id:'log1',…}]`, boxes `{x:0,y:0,w:0.5,h:1}` and `{x:0.5,…}`.
  - `'an empty dock gives no slots'` → `{ slots: [], geometry: {} }`.
  - `'a panel whose pod is not placed is left out'` — `runtimeOf` returns undefined for it.
  - `'dockFromSlots opens a panel per slot, in order'` — the config's components' `componentState.name` equal the slots' pods.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement (slot `id` = pod name). **Step 4:** Run → PASS.
- [ ] **Step 5: Wire it:** Save writes `layout: { ...saved.layout, workspace: <dock state>, ...layoutFromDock(...) }`. On Open/Import, if the file has `slots` but no `layout.workspace`, restore the dock from `dockFromSlots(slots filtered to placed pods)`; if it has `layout.workspace`, behave as today.
- [ ] **Step 6: e2e:** in `workflow.e2e.ts`, assert the downloaded `demo.json` has `layout.slots` with the four pods and a `geometry` box each; add a test `'opens a file with slots but no workspace state: a panel per slot'` importing `examples/todo/side-by-side.json`'s shape adapted to nano.ui pods (a fixture under `packages/ui-workspace/test/fixtures/import/slots.json`: input1 → log1 pipe, slots for both, no `workspace`) and asserting two panels titled with those pods.
- [ ] **Step 7:** Run `cd packages/ui-workspace && bun test --isolate && bun run build`, root `bunx tsc --noEmit`, root `bunx playwright test` → all pass.
- [ ] **Step 8:** Commit `feat(ui-workspace): save and open the neutral layout: slots and geometry beside the dock's own state`.
