# Second host Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A small React host on the same data seam, and a written overlap report.
**Architecture:** `packages/host-react` (React TSX, bun-built into the workspace's public/react/), importing only nano-core, nano-platform, nano-ui and React.
**Tech Stack:** React, TypeScript, bun build/test.
**Spec:** `docs/superpowers/specs/2026-11-21-second-host-design.md`

## Global Constraints
- Imports: only `@pritzlaff/nano-core`, `@pritzlaff/nano-platform`, `@pritzlaff/nano-ui`, `react`, `react-dom`. Nothing from ui-workspace; no copied code.
- No changes to nano-core, nano-platform, nano-ui or ui-workspace in this plan except: the workspace build/serve may gain one step to build host-react into public/react/, and the report file.
- No source file over 150 lines; exported object types ≤10 members (the structure test covers packages/*/src).
- Its layout lives under `page.layout.react` only; never touches the workspace's layout keys.
- Tests: `bun test --isolate` in packages/host-react and the existing five suites; `bunx tsc --noEmit` at the root.

## Review Focus
1. A page created in the workspace appears in /react/, and one created in /react/ appears in the workspace, both after a reload.
2. A pick in /react/ deploys a lazy pod into the chosen runtime and its view renders; nothing starts for an unshown page.
3. The workspace keeps working unchanged after /react/ writes the shared documents (its layout keys untouched).

### Task 1: The React host and the overlap report
**Files:** `packages/host-react/**` (package.json, src, test, build script), one step in the workspace build to emit /react/, `docs/second-host-overlap.md`.
- [ ] Step 1: failing tests for the non-React logic (boot from stored documents, catalog of implementations with their view tags, add slot = deploy then apply, remove slot).
- [ ] Step 2: run, see them fail.
- [ ] Step 3: implement the host; keep a running list of every piece you had to rewrite that the workspace has (file, lines, what), and write `docs/second-host-overlap.md` from it with a recommended home per item and anything the seam made awkward.
- [ ] Step 4: all suites and tsc; build the workspace (`cd packages/ui-workspace && bun run build`) and check public/react/ exists.
- [ ] Step 5: commit `feat(host-react): a second host on the data seam, and what it had to rewrite`.
