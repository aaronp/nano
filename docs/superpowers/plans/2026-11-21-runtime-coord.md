# RuntimeCoord Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add `RuntimeCoord`; `PodCoord.runtime` and `SelectorData`'s fields become coordinates; saved forms unchanged.
**Architecture:** coord.ts gains the runtime kind; selector.ts's data and `matches` use coordinates; every call site moves.
**Tech Stack:** TypeScript, TypeBox, bun test.
**Spec:** `docs/superpowers/specs/2026-11-21-runtime-coord-design.md` (ADR-0037)

## Global Constraints
- No concept drift: new names are `RuntimeCoord`, `Coord.runtime`, and the `'runtime'` kind of `Coord.parse`; nothing else.
- No file over 150 lines; an exported object type at most 10 members; every export in design.md; baseline only shrinks.
- Boundary: runtime ids as keys/names (`runtimes` keys, `app.runtime(id)`, `ctx.runtimes`, `Target.runtime`) and the
  `runtime` field of `AppEvent`s and `Ask`s stay strings.
- Saved forms unchanged: nano.json, the registry manifest, recordings, observed calls.
- Tests: the four suites with `bun test --isolate`, `bunx tsc --noEmit` at the root.

## Review Focus
1. An existing nano.json and an existing recording load unchanged.
2. A dependency declared with `Selector.of(I, { runtime })` resolves exactly as before.
3. The registry manifest (and anything JSON-stringifying a selector) writes strings, not coordinate objects.

### Task 1: RuntimeCoord and coordinate selectors
**Files:** `packages/nano/src/coord.ts`, `selector.ts`, and every caller across packages/nano, ui, ui-workspace, examples;
design.md (Coord and Selector rows); tests `packages/nano/test/coord-runtime.test.ts`.
- [ ] Step 1: failing tests per the spec's Testing section and the Review Focus.
- [ ] Step 2: run, see them fail.
- [ ] Step 3: implement; move every call site (tsc lists them).
- [ ] Step 4: all four suites and tsc.
- [ ] Step 5: commit `feat(nano-core): runtime coordinates; selectors built from coordinates (ADR-0037)`.
