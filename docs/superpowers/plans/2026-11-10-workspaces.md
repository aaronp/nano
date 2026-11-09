# Named workspaces in systems, with a components drawer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Workspaces grouped in the nav with a `+` to create one in a chosen or new system; each workspace page is a components drawer beside its dock; a workspace's panels and wiring view live in its system.

**Architecture:** The platform exports `runtimeOf`. Saved workspaces gain `system`; start-up creates their systems before docks load. The dock gets a `registry` and hands it to panels in its mount path, can start empty, and lets other elements register drag sources. `<component-drawer>` (light DOM, no golden-layout import) lists a dock's palette. `<c-wires>` takes a `host` runtime for platform calls and selection. The nav gets a Workspaces group with a `+` that opens the new-workspace dialog.

**Tech Stack:** Bun, TypeScript, Lit 3, golden-layout 2, happy-dom.

**Spec:** `docs/superpowers/specs/2026-11-10-workspaces-design.md`

## Global Constraints

- No changes to `packages/core`, `runes` or `elements` (published).
- Main: route `/workspace`, dock id `workspace`, system `host`; it is never a saved workspace.
- golden-layout can't load under `bun test` (its CJS build needs `tslib`): anything tested must not import `workspace-dock.ts`; the dock is driven through duck-typed methods.
- Files ≤ ~200 lines; every export has a 1–2 line purpose comment. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A panel in a non-host workspace places its component in that system,** including panels restored from a saved layout (Task 3).
2. **Systems exist before any dock restores its layout** after a reload (Task 4).
3. **Connections made in a non-host workspace's ⇄ Connections go to that system,** and selection still syncs (Task 5).
4. **An empty workspace** saves, restores, and accepts a drag or click from the drawer (Task 3/4).
5. **Route clashes and bad names in the `+` dialog are refused with the input kept** (Task 6).

---

### Task 1: `runtimeOf` in the platform
- Create `runtimeOf(registry: Registry, system: string, platform = 'platform'): Runtime | undefined` in `packages/platform/src/platform.ts` (reads the platform instance's `systems` map); export it.
- Test (`platform.test.ts`): after `create-system 'lab'`, `runtimeOf(host.registry, 'lab')!.registry.id === 'lab'`; `runtimeOf(host.registry, 'host') === host`; unknown → `undefined`.
- [ ] RED, GREEN, commit `feat(platform): runtimeOf finds a system's runtime`.

### Task 2: Saved workspaces carry a system; pages are drawer + dock
- `src/lib/saved-workspaces.ts`: `SavedWorkspace` gains `system?: string` (missing = `host`); `add` validates system names like routes' segments (`/^[a-z0-9][a-z0-9-]*$/`).
- `src/components/saved-workspaces.ts` `mountWorkspace(doc, ws)`:
  - **Nav:** a sub-item (`a[slot=nav][data-sub][data-saved]`, icon + title) inserted after the last workspace sub-item under the Workspaces group (`[data-workspaces]`).
  - **Page:** `app-route[path][bleed] > split-pane[direction=row][sizes="22,78"][storage-key="ws:<path>"] > component-drawer[for=<dock id>] + c-wires > workspace-dock[id][label][storage-key][system]` with the main dock's templates cloned.
- Tests (extend `test/saved-workspaces.test.ts`): `system` defaults to host and bad system names are refused; mounting puts the sub-item under Workspaces after Main and builds the split page with the drawer pointing at the dock and `system="lab"`.
- [ ] RED, GREEN, commit `feat(ui-workspace): saved workspaces have a system; each page is a drawer beside its dock`.

### Task 3: The dock — registry, empty layouts, registered sources
- `workspace-dock.ts`: property `registry?: Registry`; in `mount`, before attaching the panel content, set `registry` on every element in it (`for (const e of [root, ...root.querySelectorAll('*')]) if (e.localName.includes('-')) e.registry = this.registry` when `this.registry` is set). `open=""` → an empty layout (`root: undefined`), with an empty hint element shown while no panels are open. `addSource(el)` public (the body of today's `connectSources` for one element); `connectSources` keeps scanning the document. `dock:save-as` detail gains `system` (`this.getAttribute('system') ?? 'host'`).
- `src/lib/dock-layout.ts`: `initialLayout([])` returns `{ root: undefined }` instead of throwing; test it (and that `panelIds(undefined)` is `[]`).
- [ ] RED (dock-layout test), GREEN, commit `feat(ui-workspace): docks can start empty, hand their registry to panels, and take drag sources from elsewhere`.

### Task 4: `<component-drawer>`, the nav, and start-up order
- `src/components/component-drawer.ts` (light DOM, `HTMLElement`): `for` = dock id. Renders a toolbar (title "Components", Import button `disabled` with title "Import from a URL — coming next", a filter input, a collapse button), and two sections, **Components** (templates with `data-catalog`) and **Widgets** (the rest), each entry an `a[data-dock-add][data-widget]` with the template's title. After render, calls `dock.addSource(a)` for each entry when the dock has `addSource` (waits for `customElements.whenDefined('workspace-dock')`). Collapsed state in `localStorage` under `drawer:<dock id>`; collapsed shows only a reopen button. Filter hides non-matching entries and empty sections.
- `composable.ts`: generated catalog templates get `data-catalog`; stop generating nav links.
- `public/index.html`: drop the "+ …" nav items; the Workspace nav item becomes `<div slot="nav" class="nav-row" data-workspaces>` holding `<a href="#/workspace">…Workspaces</a>` and `<button data-new-workspace aria-label="New workspace">+</button>`, followed by `<a slot="nav" data-sub href="#/workspace">Main</a>`; Main's route becomes the split page (drawer `for="workspace"` + its `c-wires`).
- `app-shell.ts`: `markNav` also marks anchors inside `.nav-row`; styles for `.nav-row` (in `app.css`).
- `boot-saved-workspaces.ts`: top-level `await` creating missing systems through the platform (`create-system`), then mount; `main.ts` keeps it before the shell and dock imports.
- Tests (`test/drawer.test.ts`, happy-dom, a stub dock element with `addSource` recording calls): sections and entries from templates; filter; collapse remembered; Import disabled; every entry registered with the dock. `host.test.ts`: the page has no "+ X" nav items, the Workspaces group and Main exist, Main's route holds a drawer for `workspace`.
- [ ] RED, GREEN, commit `feat(ui-workspace): the components drawer, and the Workspaces nav group`.

### Task 5: `<c-wires>` in a system
- `packages/wires/src/wires.ts`: property `host?: Runtime` (defaults to `runtime`); platform calls (`call`) go through `host`; the trace listener for `selection-changed` attaches to `host` (and the packet trace to `runtime`); `system` defaults to `runtime.registry.id`. Detail's tree uses `host`'s registry.
- `saved-workspaces.ts` mount: `c-wires` gets `runtime = runtimeOf(host.registry, system)`, `host = host runtime`, `system`; the dock gets `registry`.
- Test (`wires.test.ts`): a `lab` system with r and d; `<c-wires>` with `runtime` = lab's, `host` = host; dragging r.value → d.enqueue makes the subscription in `lab` (not host); picking selects `{ system: 'lab', … }`.
- [ ] RED, GREEN, commit `feat(wires): a connection view over any system, with platform calls through the host`.

### Task 6: The new-workspace dialog
- `saved-workspaces.ts`: clicking `[data-new-workspace]` opens the dialog: name, route (filled from the name until edited), icon, System (`select` of the platform's systems plus "New system…" showing a name field). On save: refusals shown with input kept; a new system via `create-system`; `add({ path, title, icon, system })`; mount with an empty layout (storage key gets `{ root: undefined }` layout); navigate. Save workspace… (from a dock) passes that dock's system.
- Tests (`test/saved-workspaces.test.ts`): the dialog (driven in happy-dom) creates a workspace in a new system `lab` (platform lists it; nav sub-item; route; dock `system="lab"`); a taken route is refused and the fields keep their values.
- [ ] RED, GREEN, commit `feat(ui-workspace): + creates a workspace in a chosen or new system`.

Finish: all package tests, root `tsc`, ui-workspace build.
