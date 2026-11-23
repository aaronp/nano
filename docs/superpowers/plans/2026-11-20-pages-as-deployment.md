# Pages as deployment data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pages (containers of slots) become deployment data in `layout.pages`. A `HostPages` capability changes
them and the host persists the document. Opening a page `getOrCreate`s its pods through a new explicit core `start`.
The picker becomes an inline grid grouped by provider, with runtime pills.

**Architecture:**
- Core gains `start` and `getOrCreate` on `RuntimeView`, with a traced `start` message kind.
- nano-ui gains the `Page` and view-slot types, `pagesOf` and the `HostPages` interface.
- ui-workspace gets a page store that is the run-time truth for pages, persistence of the whole document, and a host
  pod `pages`.
- The dock persists through a `Storage` backed by its page, so slots are the truth and engine state a hint.
- A pick deploys a lazy pod in the chosen runtime, then adds a slot.

**Tech Stack:** TypeScript, TypeBox, Lit, golden-layout 2.6, bun test with happy-dom.

**Spec:** `docs/superpowers/specs/2026-11-20-pages-as-deployment-design.md` (ADR-0031 to ADR-0035 in
`docs/adr/decisions.md`)

## Global Constraints

- No concept drift (CLAUDE.md): every new export or public option not named in the spec is listed under "New names"
  below. Anything beyond that list is a question for the user, not a ruling.
- Sources of truth (spec): presentation reads the system and never writes it. A pick is two steps: deploy, then
  `setPage`. Pages never start, stop, count or remove pods; a closed panel removes a slot, not a pod. Core knows
  nothing of pages.
- No source file over 150 lines. `packages/ui-workspace/src/components/workspace-dock.ts` is at its 226 cap, and
  `host.ts` (151) and `structure-baseline.json` may only shrink. An exported object type has at most 10 members
  (`Application` and `Host` are at 10).
- Every export goes in `design.md` (the structure test checks packages/nano).
- Tests: `cd packages/nano && bun test --isolate`; `cd packages/ui && bun test --isolate`;
  `cd packages/ui-workspace && bun test --isolate`; `cd examples && bun test --isolate`; `bunx tsc --noEmit` at the
  root. Never a bare `bun test` at the root.
- Commits on `dev`, ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- A contentious decision made mid-build gets a full record in `docs/adr/decisions.md` (ADR-0036 on).

## New names (for the user's sign-off; spec-approved names not repeated)

- `pagesOf(layout)` and `ViewSlot` (nano-ui)
- `pageStore(...)` (ui-workspace `lib/pages.ts`)
- `persisted(...)` (ui-workspace `persist.ts`)
- `WorkspaceDock.storage` (a `Storage`, default `localStorage`)
- `HOST_PODS` grows to three
- `addPod(h, coord, runtime)` replaces `addPod(h, coord, name?)`

## Review Focus

1. **A reload with a stored document holding a foreign provider:** the pages and pods come back, and the foreign code
   asks once.
2. **Two pages showing one pod:** closing it on one leaves the other; opening the second starts nothing
   (`started: false`).
3. **Undeploying a pod shown on two pages:** both slots go and both pages are saved; nothing throws.
4. **Renaming a page keeps its id and route:** `open({ id })` and the URL still work, and Main stays first.
5. **A slot whose pod fails to start:** that slot shows the reason in place, and the page's other slots open.
6. **Storage unavailable or full:** the app runs in memory, with one status message, and no throw.

---

### Task 1: Core `start` and `getOrCreate`

**Files:**
- Create `packages/nano/src/application/start.ts`
- Modify `application/resolve.ts` (RuntimeView, runtimeView), `application/stream.ts` (`sent` kind),
  `policy.ts` (`Ask.kind`, the `Kind` schema), `design.md` (Application row, FAQ "Lazy vs eager?" and the "no
  `start()`" lines, pointing to ADR-0031)
- Test `packages/nano/test/start.test.ts`

**Interfaces:**
- Produces, on `RuntimeView`:
  - `start(pod: string): Promise<NanoResult<void>>`
  - `getOrCreate(pod: string): Promise<NanoResult<{ started: boolean; pod: Client }>>`, where `pod` is `call(pod)`'s
    client.
- A `sent` of kind `'start'`, from `'host'`, to the pod, with **no `port`**: a separate `AppEvent` variant, so `port`
  stays required on the others. Then `delivered` (with the build's result) or `denied`.
- `Ask.kind` gains `'start'`, and `PolicyRules` accepts `allow: 'start'`.

- [ ] Step 1: Failing tests in `test/start.test.ts`:
  - `start` builds a lazy pod: `built` on the stream; status goes from `not started` to `running`.
  - A running pod → `invalid-input` "already running".
  - A pod not placed in the runtime → `not-found`.
  - A `rules` policy without `allow: 'start'` → `denied`, with `sent` then `denied` on the stream.
  - A `failed` pod can be started again.
  - `getOrCreate` on a running pod → `{ started: false }`. On a stopped pod → `{ started: true }`.
  - Two racing `getOrCreate`s → one `true` and one `false`, with one `built` event.
  - `r.value.pod.<op>(x)` equals `call(pod).<op>(x)`.
  - `subscribe` to a lazy pod still leaves it `not started`.
- [ ] Step 2: Run `cd packages/nano && bun test --isolate test/start.test.ts`. Expect it to fail.
- [ ] Step 3: Implement in `start.ts`, building through `live.instance(name)`, the existing once-only build. resolve.ts
  only wires the two members, since it is at 143 lines. Then update every consumer of `sent.kind` across packages
  that `bunx tsc --noEmit` flags.
- [ ] Step 4: Run all four suites and tsc. The structure test must pass, with `RuntimeView` at 8 members.
- [ ] Step 5: Commit `feat(nano-core): start and getOrCreate a pod, explicitly (ADR-0031)`.

### Task 2: nano-ui pages and `HostPages`

**Files:**
- Modify `packages/ui/src/layout.ts`, `packages/ui/src/interfaces.ts`, `packages/ui/src/index.ts`
- Test `packages/ui/test/pages.test.ts`

**Interfaces:**
- Types:
  - `ViewSlot = { id: string; view: string }`
  - `Slot = LayoutSlot | ViewSlot`
  - `Page = { id: string; title: string; icon?: string; slots: Slot[]; geometry?: Record<string, LayoutBox>; [engine: string]: unknown }`
  - `LayoutData` gains `pages?: Page[]`
- `pagesOf(layout: unknown): Page[]`:
  - returns `layout.pages`, dropping any page that fails the shape check, each with one `console.warn`;
  - with no `pages`, a legacy top-level `slots` / `geometry` becomes one page
    `{ id: 'workspace', title: 'Workspace', slots, geometry }`, and a legacy `layout.workspace` becomes that page's
    `workspace` key;
  - otherwise it returns `[]`.
- `HostPages = ns.interface('HostPages', {...})`:
  - `pages: Op.action(Nothing, Pages)`
  - `setPage: Op.action(PageAt, Nothing)`, where `PageAt` is `{ page, index? }`
  - `removePage: Op.action(PageId, Nothing)`
  - `open: Op.action(PageId, Nothing)`
  - The schemas are TypeBox, like `Addition`.

- [ ] Step 1: Failing tests:
  - `pagesOf` on pages, on the legacy single page, on legacy `layout.workspace`, and on a bad page (dropped and
    warned);
  - `HostPages`' four ops exist, with schemas that accept a page holding pod and view slots.
- [ ] Step 2: Run `cd packages/ui && bun test --isolate test/pages.test.ts`. Expect it to fail.
- [ ] Step 3: Implement. The id is checked against core's id rule. Ids are lower-case and dashes only when the
  workspace makes them (Task 3); `pagesOf` accepts any id that passes the core rule.
- [ ] Step 4: Run the ui suite and tsc.
- [ ] Step 5: Commit `feat(nano-ui): pages in the layout, and HostPages`.

### Task 3: The page store, persistence and the `pages` host pod (ui-workspace)

**Files:**
- Create `src/lib/pages.ts` (the store), `src/persist.ts` (save and boot, and the one-time migration),
  `src/host-pages.ts` (the HostPages provider and pod)
- Modify `src/host-deploy.ts` (`HOST_PODS`), `src/main.ts` (boot from storage; Save composes `layout.pages` from the
  store)
- Tests `test/pages-store.test.ts`, `test/persist.test.ts`, `test/host-pages.test.ts`

**Interfaces:**
- `pageStore(initial: Page[], placed: (runtime: string, pod: string) => boolean)` returns:
  - `list(): Page[]`
  - `get(id): Page | undefined`
  - `set(page, index?): NanoResult<void>`
  - `remove(id): NanoResult<void>`
  - `prune(placed)`, which drops pod slots no longer placed and reports whether anything changed
  - `subscribe(fn): () => void`
- `set` and `remove` refuse with `invalid-input` when:
  - the id is a fixed route (`ring`, `desk`, `settings`, `systems`, `messages`, `components`, `themes`, `inbox`);
  - a pod slot is not placed;
  - an index would move Main (`workspace`) from first;
  - asked to remove Main.
- New ids are made by `slugPath(title, taken)`, without the leading `/`. A rename keeps the id.
- `persisted(storage: Storage, key: string)`:
  - `load(): AppDeployment | null`
  - `save(d: AppDeployment): void` (a try/catch; one status message on failure)
  - `migrate(storage): Page[]`, which reads the old saved-workspaces list, per-dock layout keys and `.template`
    keys into pages once, then removes them.
- At boot the stored document is applied as the app's own (ADR-0034): no prompt for same-origin providers, and a
  foreign provider asks once per session as now. Then the store is seeded with
  `pagesOf(layout)`, or `migrate()`, or `[{ id: 'workspace', title: 'Workspace', slots: [] }]`.
- `?src=` imports into the stored document.
- Saving: debounced on `applied` and on store changes, writing `{ ...h.saved(), layout: { ...h.saved().layout, pages: store.list() } }`.
  The store is the run-time truth for pages; `h.data().layout.pages` is never read after boot.
- `host-pages.ts` places pod `pages` (HostPages) in `main`, as `deploy` is.
  - A pod's `setPage` or `removePage` asks `HostUI.approve` with a one-line summary; no answer in 20 s is a no.
  - `pages` and `open` are not asked.
  - `open` sets `location.hash = '#/<id>'`.
  - On `applied`, `store.prune(...)`.

- [ ] Step 1: Failing tests:
  - store: the rules above; rename keeps the id; prune.
  - persist: round-trip; storage that throws; migration of each old key shape, then the keys gone.
  - host pod: a pod's `setPage` asks approve (yes, no, timeout); `removePage('workspace')` is refused; `open` sets
    the hash.
  - Review Focus 3 (undeploying a pod shown on two pages) and 6 (storage unavailable).
- [ ] Step 2: Run the three test files. Expect them to fail.
- [ ] Step 3: Implement. `host.ts` must not grow.
- [ ] Step 4: Run the ui-workspace suite and tsc.
- [ ] Step 5: Commit `feat(ui-workspace): pages are deployment data, saved with the document`.

### Task 4: Nav and pages driven by the store

**Files:**
- Modify `src/components/workspace-pages.ts`, `src/components/nav-edit.ts`
- Delete `src/lib/saved-workspaces.ts` (its `ICONS` and `slugPath` move to `src/lib/pages.ts`, or to a small
  `lib/icons.ts` if pages.ts would pass 150 lines)
- Tests: update `test/workspace-pages.test.ts`, `test/nav-edit*.test.ts`

**Interfaces:**
- Consumes the store from Task 3.
- One nav row, route and dock per page, in store order; Main is the page `workspace`, mounted at `/workspace`.
- `+` → `store.set({ id: slugPath('New workspace'), title: 'New workspace', icon: 'window', slots: [] })`, then
  rename.
- Edit mode writes `store.set` with a new title or icon, keeping the id, and reorders with `index`.
- The store's `subscribe` re-renders the nav: added and removed pages mount and unmount; a title change relabels.
- "Save as workspace…" → `store.set` of a copy with the same slots and `workspace` key, titled "<title> copy".

- [ ] Step 1: Failing tests:
  - `+` adds a page to the store and the nav;
  - a rename keeps the route (Review Focus 4);
  - reorder goes through `index`, and Main can't move;
  - a page added through the store (as a pod would) appears in the nav;
  - a page removed through the store unmounts.
- [ ] Step 2: Run them. Expect them to fail.
- [ ] Step 3: Implement.
- [ ] Step 4: Run the suite and tsc.
- [ ] Step 5: Commit `feat(ui-workspace): the nav shows the pages`.

### Task 5: The dock on its page: storage, slots, opening, picks

**Files:**
- Modify `src/components/workspace-dock.ts` (≤226: replace `localStorage` with `this.storage`; nothing else grows),
  `src/dock/panels.ts`, `src/dock/template-mode.ts`, `src/components/workspace-pages.ts`
- Create `src/dock/page-slots.ts`
- Tests `test/page-slots.test.ts`, `test/dock-pods.test.ts` (rewritten)

**Interfaces:**
- `WorkspaceDock.storage: Storage` (default `localStorage`). workspace-pages hands each dock a `Storage` whose
  `getItem` and `setItem` read and write that page's `workspace` key through `store.set`.
- `page-slots.ts`:
  - `slotsOf(panels: PanelState[], runtimeOf: (pod) => string | undefined): Slot[]`: a pod panel gives a pod slot,
    any other panel a view slot whose `view` is its widget id.
  - `reconcile(engine: unknown, slots: Slot[]): { engine: unknown; add: Slot[] }`: entries with no slot are dropped,
    and slots the engine lacks are returned in `add`, to be split in. Slots win.
- On each `dock:layout`, the page's `slots` are rewritten from the dock's panels.
- **Opening** (on navigation to the page, and on `HostPages.open`): for each pod slot,
  `h.app.runtime(slot.runtime).getOrCreate(slot.pod)`. A failure shows the `Fail`'s reason in that panel; the others
  open (Review Focus 5). Pods aren't started at boot or for pages that aren't shown.
- **Picks**: `addPod(h, coord, runtime)`:
  - places a **lazy** pod `<kind><n>` through `AppDeployment.edit(...)`, with `connected()` for its call edges as now;
  - in a `rules` runtime, it adds the rule that lets `host` reach the pod (`call`, `subscribe`, `start`);
  - it is serialised as now, and returns the name;
  - then the slot is added, and the page opens it.
- Removed: the named-remake path in `addPod`, the late-`host` remount in workspace-dock (pods now come from the
  document), and the File-menu "first input" workaround in main.ts if the remakes were its only reason.

- [ ] Step 1: Failing tests:
  - `slotsOf` / `reconcile`, pure;
  - a reload (new host from the stored document) opens the same pods: no new names, `started` true once and then
    false on a second page (Review Focus 2);
  - a pick places a lazy pod in the chosen runtime, and opening starts it;
  - a slot whose pod fails shows the reason;
  - a page changed through the store (a slot added) shows it in the dock;
  - closing a panel removes the slot, not the pod.
- [ ] Step 2: Run them. Expect them to fail.
- [ ] Step 3: Implement. If workspace-dock.ts can't stay at 226, extract to `dock/` files; never raise the cap.
- [ ] Step 4: Run all four suites and tsc.
- [ ] Step 5: Commit `feat(ui-workspace): docks keep their page; opening a page gets or creates its pods`.

### Task 6: The picker as a grid with runtime pills

**Files:**
- Modify `src/components/picker.ts`
- Create `src/components/picker-grid.ts` (the tiles, groups and pills, shared by both forms)
- Modify `src/dock/template-view.ts`, `src/components/workspace-dock.ts` (an empty position, or an empty dock,
  mounts the inline grid instead of `+`)
- Test `test/picker.test.ts` (extended)

**Interfaces:**
- `pick(anchor, entries)` is unchanged (the popover, for a header's `+`). The inline form is `pickerGrid(host:
  HTMLElement, entries): Promise<{ state: PanelState; runtime?: string } | null>`, an internal export of
  picker-grid.ts.
- `Entries` gains `runtimes: string[]`.
- The result carries the chosen runtime for implementation tiles.
- Layout, top to bottom:
  - the filter (focused in the popover, not when inline);
  - `Runtime:` pills (`role=radiogroup`), starting on `main` or the session's last choice;
  - the groups: Hidden (from an empty position), then each provider (nano.ui first, then imports, with ✕ and failed
    imports as now), then Views. The pills are disabled while focus is in Views.
- Keyboard: arrow keys move between tiles in a grid; Enter picks; Esc closes the popover.

- [ ] Step 1: Failing tests:
  - groups by provider, with Views last;
  - the filter narrows every group and hides empty groups;
  - the pills list the runtimes, and the choice comes back in the result and is remembered;
  - an empty position shows the inline grid, and a pick fills it;
  - the arrow keys move focus.
- [ ] Step 2: Run them. Expect them to fail.
- [ ] Step 3: Implement.
- [ ] Step 4: Run the suite and tsc.
- [ ] Step 5: Commit `feat(ui-workspace): the picker is a grid of providers with a runtime choice`.

### Task 7: Docs, e2e and the hand check

**Files:**
- `design.md`: rewrite the "Views and layout" paragraph for pages, the store, HostPages, the persisted document,
  opening, and the grid; add every new export
- e2e files that use the `+` flow
- Headers of the touched files

- [ ] Step 1: Write the docs. Update the e2e files to the inline grid.
- [ ] Step 2 (controller): build and drive the page:
  - two pages sharing a pod;
  - a reload;
  - a rename;
  - a pick into a non-`main` runtime (import an example that brings one);
  - undeploying a shared pod;
  - storage blocked.
- [ ] Step 3: Run every suite.
- [ ] Step 4: Commit `docs: pages as deployment data`.
