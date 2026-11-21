# Host core, plan 5 of 8: the workspace on the host core

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The workspace boots, saves and edits pages through `@pritzlaff/nano-host`; one storage key for both hosts; `Outline.create` and the workspace's copies of the mechanics go.
**Spec:** `docs/superpowers/specs/2026-11-21-host-core-design.md` (§3, §6, "Settled", "Decided"); ADR-0041.

## Global Constraints
- The workspace boots through `Host.boot` with: its gated loader (probe, foreign-code confirm, sandbox stand-ins: today's `importApp` path, ADR-0034), nano.ui and its own host provider as `providers`, `isolate` and the approval `deploymentPolicy` as `create`, its host pods (`ui`, `deploy`, `outline`) as `hostPods`, and its old forms (dock keys, `meta.workspace.order`, legacy layout reading, `placeOld` as a pure data edit using the registry) as the `migrate` hook.
- One key `nano-host.document` for both hosts; after a good save the old `nano-workspace.*` keys are removed (the host core's removal comes back, now that the workspace no longer writes them; the `ponytail:` note goes).
- `views` (per-pod overrides, the app bar's view picker) live in `host.views`; the Desk in `host.layout.workspace.desk`, the Ring filter in `host.layout.workspace.ring`. nano-ui's `viewFor` takes the override map as its own argument instead of reading `deployment.views` (its callers: the workspace's pod panels, the React host, ring-view; shadow.ts adjusted).
- The workspace's live outline, picks and page edits are the host core's: `host.outline`, `host.pick`, the pure edits. `Outline.create` is deleted from the Outline package (its tests move or go); the workspace's duplicates go (`addPod`'s deploy path, `auto-connect.ts`, the `starts` table, tree helpers the host core now has; the workspace keeps only its own rules: Main first, the tool table, nav moves UI).
- File › Save writes the `HostDocument` (the `{ app, outline, host }` file); Open/Import keep today's behaviour in this plan (plan 6 changes them), reading old files as now.
- History (the time machine) records the Application as before; host pods stay out of the saved document.
- The workspace's `Host` type (host.ts, 10 members) is replaced or thinned around the host core's `Host`; host.ts may only shrink.
- No file over 150 lines (workspace-dock.ts ≤226); no new public names beyond the plan; internal helpers fine.
- Tests: `bun test --isolate` in packages/host, outline, nano, ui, ui-workspace, host-react, examples; `bunx tsc --noEmit`; the build. The controller runs e2e and a browser check of both hosts on one key.

## Review Focus
1. Both hosts read and write `nano-host.document`; a page made in either shows in the other after a reload.
2. A workspace with only old keys (every old form) boots into the same pages, pods, views, Desk and Ring filter; the old keys are gone after a good save.
3. Trust: a stored document naming a foreign provider still asks once per session; sandboxed pods still run in frames.
4. The app bar's view picker, the Desk, the Ring filter and Save/Open behave as before.

### Task 1: boot and storage on the host core
**Files:** ui-workspace `host.ts`, `boot-host.ts`, `boot-pages.ts`, `persist.ts`, `migrate.ts`, `main.ts`, desk and ring readers, `boot-app-bar.ts`; nano-ui `viewFor` and its callers; host core (old-key removal back); tests; design.md.
- [ ] Failing tests for Review Focus 1–4; implement; all suites + tsc + build; commit `feat(ui-workspace): boot and save through the host core`.

### Task 2: live outline, picks and edits from the host core; Outline.create goes
**Files:** ui-workspace nav, docks, pods, page edits, host-outline-pod, import-pages; outline package (`Outline.create` removed); host-react if it used it; tests; design.md.
- [ ] Failing tests where behaviour moves; implement; all suites + tsc + build; commit `refactor: one live outline, in the host core; Outline.create goes`.
