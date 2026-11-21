# Host core, plan 1 of 8: every page at #/p/<id>

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Pages get their own route namespace, `#/p/<id>`, so they never collide with the app's screens; the reserved-id machinery goes.
**Spec:** `docs/superpowers/specs/2026-11-21-host-core-design.md` §4 and "Settled after the builder check" (Routes); ADR-0041.
**Tech Stack:** TypeScript, Lit, bun test (happy-dom), Playwright e2e.

## Global Constraints
- `routeOf(id)` is always `/p/<id>`. Main's static route in `public/index.html` becomes `/p/workspace`; every hard-coded link to `#/workspace` (nav row, the three Connections links, the not-found link, `main.ts` `bootWiring`'s `{ id: '/workspace' }`, `workspace-pages.ts`, app-shell's doc example) moves to `#/p/workspace`.
- A hash rewrite runs before app-shell's first `applyRoute` and on `hashchange`: `#/workspace` → `#/p/workspace`; `#/<id>` → `#/p/<id>` when `<id>` is a page in the Outline and not one of the app's own routes. (`replaceState`, so Back isn't polluted.)
- Removed: `FIXED`, the reserved-id refusal in `refusal`, the `FIXED` guards in `workspace-pages.ts` `taken` and `import-pages.ts`, and their tests (rewritten to the new rule: any page id is allowed; ids are only unique).
- The app's own screens keep their routes (`#/ring`, `#/desk`, `#/systems`, `#/messages`, `#/components`, `#/themes`, `#/settings`, `#/inbox`); a page may now be called `ring` (`#/p/ring`) with no remap.
- HostOutline's guard keeps Main (present, first root) and drops only the reserved-id part.
- host-react is unaffected (it has no routes); the e2e files' page URLs (`#/workspace`, `#/workspace-2`, …) move to `#/p/…`.
- No file over 150 lines (workspace-dock.ts ≤226); internal helpers are fine; design.md updated.
- Tests: `bun test --isolate` in packages/outline, nano, ui, ui-workspace, host-react, examples; `bunx tsc --noEmit`; the workspace build. The controller runs e2e.

## Review Focus
1. Old bookmarks `#/workspace` and `#/<page-id>` land on the page; `#/ring` still opens the Ring screen even when a page `ring` exists.
2. A page named `ring`, `desk` or `inbox` can be made, renamed into, imported and opened, and never shadows a screen.
3. Every in-app link to Main works (nav, Connections, not-found, wiring's open-panel fallback).

### Task 1: Routes at #/p/<id>
**Files:** `src/lib/pages.ts`, `src/components/workspace-pages.ts`, `src/components/nav-tree.ts`, `src/components/app-shell.ts` (or a small `src/lib/route-rewrite.ts` it calls), `src/import-pages.ts`, `src/host-outline-pod.ts`, `src/main.ts`, `public/index.html`, `design.md`, tests, `e2e/*.e2e.ts`.
- [ ] Step 1: failing tests for Review Focus 1–3 (happy-dom: set `location.hash`, boot, assert the shown route) and the removed rules (a page `ring` is accepted by `applyPages` and by HostOutline).
- [ ] Step 2: run, see them fail.
- [ ] Step 3: implement; update the e2e page URLs.
- [ ] Step 4: all suites, tsc, build.
- [ ] Step 5: commit `feat(ui-workspace): every page at #/p/<id>; the reserved-id rules go (ADR-0041)`.
