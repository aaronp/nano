# Keyed layout and shared titles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Each client owns one `layout` key; `Page.title` is shared data; the workspace copes with reserved ids from other clients.
**Spec:** ADR-0039 (and `docs/superpowers/specs/2026-11-21-platform-design.md`, `docs/second-host-overlap.md` items A–C).

## Global Constraints
- `Page = { title?: string; slots; layout?: unknown; meta?: unknown }`; `layout` and `meta` are keyed by client by convention (documented, not enforced by the Platform).
- The workspace reads and writes only `page.layout.workspace` (golden-layout config, template, window style, restore point if it lives in layout) and `page.meta.workspace` for its own meta (icon, order, restore point); the title is `page.title`.
- A one-time, lossless move of existing stored pages: `layout` → `layout.workspace`, `meta.title` → `title`, the workspace's other `meta` keys → `meta.workspace`. A page already in the new shape is left as is.
- Reserved ids (FIXED) arriving in the document are not refused at boot: the workspace mounts such a page at a remapped route (e.g. `/p/<id>`), never clashing with its own routes. Main missing → recreated (as now).
- host-react: titles from `page.title`; writes `title` on new pages; its columns in `layout.react` only; remove its golden-layout guard.
- No new exports beyond `Page.title`; no file over 150 lines; workspace-dock.ts ≤226; every export in design.md.
- Tests: `bun test --isolate` in packages/platform, nano, ui, ui-workspace, host-react, examples; `bunx tsc --noEmit`.

## Review Focus
1. React host columns survive a visit to the page in the workspace, and a page whose layout holds only `react` opens in the workspace.
2. An old stored document (layout at the top, title in meta) loads with nothing lost: dock arrangement, template, window style, restore point, icon, order, title.
3. A page with id `ring` made by another client opens in the workspace at its remapped route; the Ring page still works.

### Task 1: Page.title in the Platform
**Files:** packages/platform/src (document schema and type), tests, design.md, the Platform spec's model block.
- [ ] Steps: failing tests (title round-trips, optional, must be a string), implement, all suites + tsc, commit `feat(platform): a page's title is shared data (ADR-0039)`.

### Task 2: The workspace keeps to its own keys; the React host uses title
**Files:** packages/ui-workspace (page-docks storage, nav/meta helpers, migrate/boot move, route remap), packages/host-react, docs (design.md, overlap report: mark A–C resolved).
- [ ] Steps: failing tests for Review Focus 1–3, implement, all suites + tsc + workspace build, commit `fix(ui-workspace): keep to its own layout and meta keys; remap reserved ids from other clients`.
