# Host core, plan 3 of 8: the Outline's pure resolve, and tool slots

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The Outline gains a pure `resolve`, and pod-less slots become host-neutral tools.
**Spec:** `docs/superpowers/specs/2026-11-21-host-core-design.md` §2, "Settled" (Legacy readers) and "Decided by the user"; ADR-0041.

## Global Constraints
- `resolve(outline: Outline, page: string, deployment: AppDeployment, registry: Registry): Record<string, Resolved>` — exported from `@pritzlaff/nano-outline`, pure (no app), same results as today's instance `resolve`. `Outline.create`'s `resolve` is rebuilt on it. `Outline.create` itself stays in this plan (it moves to the host core in plan 4).
- `Slot = { kind: 'pod', pod } | { kind: 'select', select } | { kind: 'tool', tool: string }`; `Resolved`'s third kind is `{ kind: 'tool', tool }`. `parse` (and HostOutline's written schema) reads a legacy `{ kind: 'view', view }` as `{ kind: 'tool', tool: view }` until the legacy removal date; it never writes `view`.
- Tool ids: `systems`, `wiring`, `activity`, `chart`, `metrics`, `gallery`, `notes`. The workspace maps each to its dock widget (`systems` → `nano-explorer`, `wiring` → `nano-wiring`, `gallery` → `nano-gallery`, the others same-named) in one internal table; old slots holding widget ids (`nano-explorer`, …) read as their tool ids through that table.
- The React host shows a tool slot as "<tool>: not available here" (as it does for views today).
- No other changes. No file over 150 lines (workspace-dock.ts ≤226). Names: `resolve` and the `tool` kind are user-approved.
- Tests: `bun test --isolate` in packages/outline, nano, ui, ui-workspace, host-react, examples; `bunx tsc --noEmit`; the workspace build.

## Review Focus
1. A stored document with view slots (`{ kind: 'view', view: 'nano-explorer' }`) loads as tool slots and shows the same widgets in the workspace.
2. Pure `resolve` equals the instance's for pod, select (zero / one / several across runtimes), missing and tool slots.
3. Nothing writes `view` any more (round-trip a document through every write path).

### Task 1: pure resolve and tool slots
**Files:** `packages/outline/src` (document.ts, outline.ts, host-outline.ts, index.ts), ui-workspace (dock/page-slots.ts, dock/page-docks.ts, dock/page-pods.ts, migrate.ts, import-pages.ts, a tool table in lib/), host-react (slot.tsx), design.md, tests.
- [ ] Failing tests for Review Focus 1–3; implement; all suites + tsc + build; commit `feat(outline): pure resolve, and host-neutral tool slots (ADR-0041)`.
