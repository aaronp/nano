# Raft cluster view Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** `<raft-cluster>` draws the chosen cluster as raft.github.io: nodes in a ring with a menu and a detail dialog, and the log grid.
**Architecture:** Lit elements in `examples/raft/views`, pure models in `views/model.ts`, tested with happy-dom over a real 3-node cluster on the sim clock (`views/views-setup.ts`: `cluster()`, `mount`, `wait`, `status`).
**Tech Stack:** TypeScript, Lit, bun test.
**Spec:** docs/superpowers/specs/2026-11-21-raft-cluster-view-design.md

## Global Constraints
- No file over 150 lines (`packages/nano/test/structure.test.ts` covers `examples/`); every new export named in `design.md`.
- No change outside `examples/raft`, `design.md`, and `e2e/` if an e2e test there breaks on the removed inline toggle.
- No interface change (`interfaces.ts` stays as is); node ids come from node `<name>-1`'s status (`id`, `peers`).
- Tests: `cd examples && bun test --isolate`; `bunx tsc --noEmit` at the root; `cd packages/nano && bun test --isolate test/structure.test.ts`.

## Review Focus
1. A cluster created before a reload (the pod forgot it; `list` is empty) is not drawn, and nothing throws; a chosen cluster that is removed disappears.
2. Swapping the chosen cluster unsubscribes the old nodes' `changed`/`written` (no leaks, no stale rows).
3. A refused request (a follower) shows the reason, not a silent nothing.
4. The dialog and menu close on Escape and on a click outside; only one menu open at a time.
5. A log longer than 10 grows the grid's columns; an empty log shows 10 empty columns.

### Task 1: `<raft-node>` as the reference: click → detail dialog, right-click → ops menu
**Files:** examples/raft/views/glyph.ts; views/views.test.ts (the "a click opens the detail panel" test, updated).
- [ ] Test: a click opens a `<dialog open>` in the shadow root, titled with the node id, holding `<raft-detail>` (its rows and peers as today); Escape/✕ closes it. A `contextmenu` event opens a `[role=menu]` with items stop, resume, restart, time out, request; each calls its op (assert as the existing test does) and closes the menu; request on a follower shows a `[role=alert]`.
- [ ] Implement: the op calls move out of `raft-detail`'s buttons into one helper both use, or the menu reuses `raft-detail`'s `act` pattern; keep `raft-detail`'s buttons (the reference's modal has them).
- [ ] Commit `feat(raft): a node opens its detail in a dialog and its ops in a right-click menu`.

### Task 2: the cluster's ring and log grid in `<raft-cluster>`
**Files:** examples/raft/views/model.ts (`gridModel`), views/ring.ts (new: `<raft-ring>` and `<raft-log>`, internal elements, or two files if over 150), views/cluster-view.ts, views/model.test.ts, views/views.test.ts, design.md.
- [ ] `gridModel(rows: { id: string; p: Persistent; commitIndex: number }[]): { columns: number; rows: { id: string; cells: ({ term: number; committed: boolean } | null)[] }[] }`: columns = max(10, longest log); test it with an empty log (10 nulls) and a 12-entry log.
- [ ] Test: after `cluster()`, `<raft-cluster>` lists `example`, draws three `raft-node` elements labelled example-1..3 and a log grid of three rows; after a leader takes a `request`, the grid shows the entry in the leader's row, committed once replicated (`advance`). Remove → the ring is gone.
- [ ] Commit `feat(raft): the cluster view draws its nodes in a ring and the log grid`.
