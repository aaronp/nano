# Systems: runtimes only, and Delete runtime — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** the explorer lists only runtimes; a runtime's details offer "Delete runtime", which the workspace confirms and applies.
**Architecture:** `packages/ui` trims the tree and fires `nano-delete` `{ runtime }`; `packages/ui-workspace` confirms (`askConfirm`) and applies `removeFrom` through the host.
**Tech Stack:** TypeScript, Lit, bun test with happy-dom.
**Spec:** docs/superpowers/specs/2026-11-22-systems-runtimes-only-design.md

## Global Constraints
- No new export beyond the `nano-delete` event (pending the user's sign-off); source files ≤150 lines (explorer-details.ts is at 146: move code out if needed); design.md describes the tree and the event.
- Tests: `cd packages/ui && bun test --isolate`; `cd packages/ui-workspace && bun test --isolate`; `bunx tsc --noEmit` at the root; `cd packages/nano && bun test --isolate test/structure.test.ts`; e2e (`bunx playwright test`, outside the sandbox) where a test reads the removed groups.

## Review Focus
1. A link to an interface or implementation (a pod's "implementation", a runtime's Implementations entry) still shows its details with the global groups gone.
2. Deleting `main` asks nothing and says why (`removeFrom`'s reason).
3. Cancel (or Escape) changes nothing; Delete removes the runtime and the pods only it placed, keeps those placed elsewhere, and the details no longer show the deleted runtime.
4. The filter's namespaces and kinds still work without the groups.

### Task 1: the explorer: runtimes only, and a Delete button
**Files:** packages/ui/src/explorer-nodes.ts, explorer-details.ts (or explorer.ts), their tests in packages/ui/test, design.md.
- [ ] Test: `nodes(...)` returns only runtime nodes (no `g:ops`, `g:interfaces`, `g:implementations`); selecting `m:<impl>` and `i:<iface>` (via `go`) still renders their details.
- [ ] Test: a runtime's details have a button "Delete runtime"; clicking it fires `nano-delete` with `{ runtime: 'raft' }`, bubbling and composed.
- [ ] Implement; update the module comments and design.md's explorer line; fix any e2e that reads the removed groups.
- [ ] Commit `feat(ui): the explorer lists runtimes only; a runtime's details ask to delete it (nano-delete)`.

### Task 2: the workspace confirms and deletes
**Files:** packages/ui-workspace/src (where `nano-open` is handled at document level, e.g. boot-app-bar.ts, or main.ts); a test in packages/ui-workspace/test.
- [ ] Test: `nano-delete` `{ runtime: 'edge' }` (a runtime placing `a`, and `shared` also placed in main) opens a dialog naming "edge", "a" as going and "shared" as staying; Cancel → deployment unchanged; Delete → `edge` gone, `a` gone, `shared` kept.
- [ ] Test: `nano-delete` `{ runtime: 'main' }` opens no dialog and shows removeFrom's reason (a toast).
- [ ] Implement with `removeFrom`, `askConfirm`, `h.apply`; a failure a toast.
- [ ] Commit `feat(ui-workspace): Delete runtime asks first, then removes it and the pods only it placed`.
