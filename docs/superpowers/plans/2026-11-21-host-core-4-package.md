# Host core, plan 4 of 8: @pritzlaff/nano-host, with the React host on it

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A framework-free host core owns the host document and the live mechanics; the React host is rebuilt on it (its size is the measure).
**Spec:** `docs/superpowers/specs/2026-11-21-host-core-design.md` §3, §6, "Settled after the builder check" and "Decided by the user"; ADR-0041. Overlap items: `docs/second-host-overlap.md`.

## Global Constraints
- Package `packages/host` = `@pritzlaff/nano-host` (approved), depends on nano-core and nano-outline only (no DOM, no nano-ui).
- `HostDocument = { app: AppDeployment; outline: Outline; host?: { views?: Record<string, string>; layout?: Record<string, unknown> } }` (approved name). `app` here is a plain document; `views`/`layout` that arrive inside it are moved into `host` on read (core still accepts them until plan 7).
- Storage: one key `nano-host.document`, holding the `HostDocument` JSON. Reading: the new key; when absent, the old forms (`nano-workspace.document` + `nano-workspace.outline`, else `nano-workspace.platform`, flat outlines, `views`/`layout` inside the app document) through one internal migration module, plus an optional host hook for host-specific old forms. Writing only the new key; the old keys are removed only after a good save of the new one. The another-tab guard watches the new key and the old ones.
- `Host.boot(storage, opts)` (approved name) → `Promise<NanoResult<Host>>`. `opts`: `load?(modules, base)` (default `Registry.load`), `base`, `providers?` (the host's own, e.g. nano.ui, added before loading), `create?` options for `Application.create` (`isolate`, `deploymentPolicy`), `hostPods?` (placed in `main` and left out of the saved document), `migrate?` (the host's old-forms hook), `onStop?`.
- `Host` (≤10 members): `app`, `registry`, `exports` (each module's namespace, for `views`), `document()` (the `HostDocument` as saved), `outline` (live: `document`, `apply(next, { base })`, `listen` with `{ added, removed, changed, moved, resolved }`, `resolve(page)` and `open(page)` built on the Outline's pure `resolve`), `pick(page, implementation, runtime)`, `setHost(patch)` (views/layout writes), `stopped()`.
- Page edits are pure functions in the package returning the next Outline: `addPage(o, title, parent?)`, `removePage(o, id)` (subtree), `movePage(o, id, parent, index)`, `retitle(o, id, title)`, `addSlot(o, page, slot)`, `removeSlot(o, page, slot)`; ids from titles, unique (the slug rule).
- `pick`: deploy a lazy pod (`<kind><n>` free name, the implementation's starting config, host access in a `rules` runtime, one at a time), auto-connect its dependencies (moved here from host-react's `connect.ts`, which the workspace's `auto-connect.ts` matches), then add a `pod` slot.
- Saving: on `applied` and on every outline/host change; `host.views` drops overrides for pods that are gone (on `applied`).
- The live outline is the host core's; `Outline.create` stays in the Outline package until plan 5 moves the workspace off it, then plan 5 removes it.
- No file over 150 lines; exported object types ≤10 members; every export in design.md (structure test covers packages/*/src).
- Interim: until plan 5, the workspace still writes the old keys; both hosts share data again after plan 5 (same PR).
- Tests: `bun test --isolate` in packages/host, outline, nano, ui, ui-workspace, host-react, examples; `bunx tsc --noEmit`; the workspace build.

## Review Focus
1. Boot from every old form gives the same `HostDocument`; a second boot reads only the new key; the old keys go only after a good save.
2. `pick` into a `rules` runtime the host can then reach; a pick whose deploy fails adds no slot.
3. `open` starts each shown pod once, reuses running ones, and re-resolves on `applied` (a slot going missing and coming back).
4. The React host keeps every behaviour (pages tabs per level, picks, columns, remove, missing, tools) and shrinks: report its line count before and after.

### Task 1: the package — document, storage, migration, boot
**Files:** `packages/host/{package.json,src,test}`; root dependency wiring; design.md.
- [ ] Failing tests for Review Focus 1, the another-tab guard, storage that throws, `exports`, host pods left out of `document()`; implement; all suites + tsc; commit `feat(host): the host document, storage and boot (ADR-0041)`.

### Task 2: the live outline, pick and page edits
**Files:** `packages/host/src` (outline-live, pick, connect, edits), tests, design.md.
- [ ] Failing tests for Review Focus 2–3 and each page edit (tree kept valid); implement; commit `feat(host): live outline, pick and page edits`.

### Task 3: the React host on the host core
**Files:** `packages/host-react/src` (boot.ts, stored.ts, catalog.ts, connect.ts, slots.ts go or shrink), tests, `docs/second-host-overlap.md` (what moved, before/after lines).
- [ ] Failing tests where behaviour is now the host core's; rebuild; all suites + build; commit `refactor(host-react): on the host core`.
