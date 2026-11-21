# Host core, plan 2 of 8: core exports its loader

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** `Registry.load(modules, base)` is public; `Application.load(url)` is rebuilt on it; nothing else changes.
**Spec:** `docs/superpowers/specs/2026-11-21-host-core-design.md` §1 and "Decided by the user"; ADR-0041.

## Global Constraints
- `Registry.load(modules: Record<string, string>, base: string | URL): Promise<NanoResult<{ registry: Registry; exports: Record<string, Record<string, unknown>> }>>` — imports each module relative to `base`, adds its default export (a `Provider`) to a new registry, returns each module's namespace under its key. First failure is the result: `not-found` (import failed), `invalid-input` (no default Provider, or `registry.add` refused). Never throws.
- `Application.load(url)` keeps its exact behaviour and errors (shape check before any import, then `Registry.load` with `base = url`), so every existing caller and test passes unchanged.
- No change to `AppDeployment`'s shape (that is plan 7). `Registry` gains one static member; check the 10-member cap on its exported object type.
- design.md names `Registry.load`; core's structure test passes.
- Tests: `bun test --isolate` in packages/nano, ui, ui-workspace, outline, host-react, examples; `bunx tsc --noEmit`.

## Review Focus
1. A module that fails to import, has no default export, or exports a non-Provider gives the right failure and adds nothing.
2. `exports` carries each module's namespace (a test module with a `views` export).
3. `Application.load` behaves exactly as before (existing tests, plus one for a relative module path).

### Task 1: Registry.load
**Files:** `packages/nano/src/registry.ts` (or a new `registry-load.ts` it re-exports), `packages/nano/src/application/load.ts`, tests, design.md.
- [ ] Failing tests for Review Focus 1–3; implement; all suites + tsc; commit `feat(nano-core): Registry.load — a document's modules as a registry, with their exports (ADR-0041)`.
