# Nav edit mode and layouts filled from a picker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Edit workspace pages in place in the nav (rename, icon, reorder; `+` = empty page), and fill any layout's empty positions or dock splits from one picker that replaces the components drawer; panels that don't fit are parked behind a "Bring back" notice.

**Architecture:** Pure helpers in `src/lib/` (`saved-workspaces.ts` gains order/Main/slug; `layout-templates.ts` gains nulls, `parked`, compaction, bring-back choice). Nav edit mode lives in `components/workspace-pages.ts` (light DOM, buttons slotted beside the title — no `<app-shell>` API change). `<nano-picker>` is a popover the dock opens and awaits. The dock's template mode moves out of `workspace-dock.ts` into `dock/` to make room.

**Tech Stack:** TypeScript, Lit, golden-layout 2.6, bun test + happy-dom.

**Spec:** `docs/superpowers/specs/2026-11-19-nav-edit-and-layout-picker-design.md` (revises `docs/superpowers/specs/2026-11-19-workspace-layout-templates-design.md`).

## Global Constraints

- All code in `packages/ui-workspace`; no change to nano-core or nano-ui.
- No source file over 150 lines; `components/workspace-dock.ts` may not exceed 226 (it is at 225 — move code out first).
- New public names, exactly: `<nano-picker>`; `parked` in `TemplateState`; the nav edit mode; the "Bring back" notice. Exported helpers named in a task's Interfaces are approved; any other new export is a finding.
- Template places are **positions** (never "slots": `LayoutData.slots` is another concept).
- Routes follow titles: `/` + slug; clash → `-2`, `-3`…; Main keeps `/workspace` and stays first.
- Empty position in `order` is `null`; old states (no nulls, no `parked`) read as valid with `parked: []`.
- Narrow breakpoint `(max-width: 840px)`; hover-revealed controls also on `:focus-within` and always visible under `@media (hover: none)`.
- Tests: `cd packages/ui-workspace && bun test --isolate`; types: `bunx tsc --noEmit` at the root; structure: `cd packages/nano && bun test --isolate test/structure.test.ts`.

## Review Focus

- A panel is never lost silently: parking always shows the notice; adding from outside never parks.
- Cancelling the picker (Esc / outside click) changes nothing: no split, no write.
- Renaming to a title whose slug is taken gets a suffix and keeps the page's layout (keys moved, not dropped).
- Edit mode is fully keyboard usable: Tab to names/icons/handles, Enter/Esc, Alt+↑/↓.
- A page whose stored template predates this change still opens in that template.

---

### Task 1: Saved pages: order, Main, slugs (pure)

**Files:** Modify `src/lib/saved-workspaces.ts`; Test `test/saved-workspaces.test.ts`

**Interfaces — Produces:**
- `slugPath(title: string, taken: readonly string[]): string` — `/` + lower-case dash slug (empty slug → `/workspace-page`); appends `-2`, `-3`… until not in `taken`.
- `savedWorkspaces(storage)` gains `move(path: string, index: number): boolean` (reorders the list; false if unknown or unchanged), `main(): { title: string; icon: string } | null` and `setMain(m: { title: string; icon: string }): string | null` (Main's own title/icon, key `${KEY}.main`; refusal for empty title or unknown icon).

- [ ] Step 1: failing tests — `slugPath('My Desk', ['/my-desk'])` → `'/my-desk-2'`; `slugPath('  ', [])` → `'/workspace-page'`; `move` reorders and returns false for unknown/unchanged; `setMain` stores and `main()` reads; `setMain({title:''})` refused.
- [ ] Step 2: run `bun test --isolate test/saved-workspaces.test.ts` — FAIL.
- [ ] Step 3: implement.
- [ ] Step 4: run — PASS.
- [ ] Step 5: commit `feat(ui-workspace): saved pages order, Main's title and icon, slugged routes`

### Task 2: Nav edit mode

**Files:** Modify `src/components/workspace-pages.ts` (split into `components/nav-edit.ts` if over 150), `public/index.html` (drop the Workspaces row's `+`; title slot gets the two buttons, added by code), `public/app.css`; Delete `src/components/workspace-dialog.ts` if unused afterwards (also its test, if any); Test `test/workspace-pages.test.ts`

**Interfaces — Consumes:** Task 1's `slugPath`, `move`, `main`, `setMain`, `update`, `add`. **Produces:** `bootWorkspacePages(doc: Document): void` (the `ask` parameter goes); `mountWorkspace` unchanged.

Behaviour (spec Part 1): two buttons appended to `[slot="title"]`'s parent area as `<button data-new-workspace>` (`+`, "New workspace") and `<button data-edit-nav aria-pressed>` (✎, "Edit workspaces"), revealed on hover/focus-within of the title area. `+` → `add({ path: slugPath('New workspace', taken), title: 'New workspace' (+ ' 2'… matching the suffix), icon: 'window' })`, mount, navigate, start rename. ✎ toggles `data-editing` on `app-shell`; Esc leaves. In edit mode each workspace row (Main `[data-workspaces]` and `[data-saved]`) shows a drag handle (`<button data-handle aria-label="Move <title>">`, saved rows only), its name becomes clickable to an `<input>` (Enter/blur save via `update` with `slugPath`, or `setMain` for Main; Esc cancels; empty keeps old), its icon clickable to a popover grid of `ICONS` (`role="listbox"`, Esc closes). Reorder: drag a handle onto another saved row, or Alt+↑/↓ on a focused handle; announce "Moved <title> up/down" in a polite live region; nav order follows `list()`. Remove the ⧉/✎ per-row buttons. "Save as workspace…" (`dock:save-as`) still copies the page: new page titled "<title> copy", then starts rename. Main's stored title/icon applied at boot.

- [ ] Step 1: failing tests — `+` adds `/new-workspace` and navigates, a second `+` adds `/new-workspace-2`; edit mode toggles `data-editing`; renaming a saved row to "Desk" moves keys to `/desk` and updates link/route/dock id (existing edit-test assertions); rename to a taken slug suffixes; Esc in the input restores; picking an icon in the popover updates the row; Alt+↓ on a handle reorders `list()` and the DOM; Main rename persists via `main()`; `dock:save-as` makes "<title> copy".
- [ ] Step 2: run `bun test --isolate test/workspace-pages.test.ts test/nav.test.ts` — FAIL.
- [ ] Step 3: implement.
- [ ] Step 4: run, then full suite + tsc — PASS.
- [ ] Step 5: commit `feat(ui-workspace): edit workspace pages in place in the nav`

### Task 3: Template state with empty positions and parked panels (pure)

**Files:** Modify `src/lib/layout-templates.ts`; Test `test/layout-templates.test.ts`

**Interfaces — Produces:**
- `TemplateState = { template: TemplateId; order: (PanelState | null)[]; parked: PanelState[]; dock: unknown }`
- `place(panels: readonly PanelState[], positions: number): { order: (PanelState | null)[]; parked: PanelState[] }` — first `positions` panels in order, padded with `null`, the rest parked.
- `relayout(s: TemplateState, to: TemplateId): TemplateState` — compacts: placed (non-null, reading order) then `s.parked`, through `place`.
- `bringBackTo(count: number, current: TemplateId): TemplateId` — smallest `positions >= count`; ties prefer `current`, else `TEMPLATES` order; none → `'dock'`.
- `templateState.get()` accepts nulls in `order`, defaults missing `parked` to `[]`.
- `enabledFor` is removed (callers updated in Tasks 5–6).

- [ ] Step 1: failing tests — `place([a,b,c,d], 2)` → order `[a,b]`, parked `[c,d]`; `place([a], 3)` → `[a,null,null]`; `relayout({template:'two-cols',order:[a,null],parked:[b]}, 'grid')` → order `[a,b,null,null]`, parked `[]`; `bringBackTo(4,'two-cols')` → `'grid'`; `bringBackTo(3,'three-cols')` → `'three-cols'`; `bringBackTo(3,'one')` → `'main-two'`; `bringBackTo(5,'grid')` → `'dock'`; stored old-format state reads with `parked: []`; nulls accepted; wrong length still null.
- [ ] Step 2–4: run `bun test --isolate test/layout-templates.test.ts` FAIL → implement → PASS.
- [ ] Step 5: commit `feat(ui-workspace): template state keeps empty positions and parked panels`

### Task 4: `<nano-picker>` replaces the components drawer

**Files:** Create `src/components/picker.ts`; Delete `src/components/component-drawer.ts`, `test/drawer.test.ts`; Modify `src/components/workspace-pages.ts` and `public/index.html` (no `component-drawer` in pages), `src/components/workspace-controls.ts` (drop the Components drawer button), `src/main.ts` (imports), `public/app.css` / `app-shell-styles.ts` (drawer CSS, `.ws-page` grid); Test `test/picker.test.ts`

**Interfaces — Produces:** `pick(anchor: HTMLElement, entries: { templates: HTMLTemplateElement[]; hidden?: PanelState[] }): Promise<{ widget: string; name?: string } | null>` exported from `picker.ts`, which defines `<nano-picker>` (light DOM, a popover positioned at `anchor`): a focused filter input; sections Hidden (from `hidden`, only when given and non-empty), Components (`data-catalog`, no `data-package`), Widgets (no `data-catalog`), Imported (by `data-package`, each with ✕ firing the existing `imports:remove` event; failed imports from `importFailures()`). Click resolves with that entry; Esc / outside click resolves `null` and removes the popover. Re-reads on `catalog:changed`.

- [ ] Step 1: failing tests — sections and their entries from given templates; filter hides non-matching entries and empty sections; click resolves `{ widget }`; a Hidden entry resolves `{ widget, name }`; Esc resolves null and removes the element; ✕ on an imported package dispatches `imports:remove` with its url.
- [ ] Step 2–4: run `bun test --isolate test/picker.test.ts` FAIL → implement (move drawer logic: sections, filter, imported) → PASS; full suite (update tests that referenced the drawer or its toggle) + tsc.
- [ ] Step 5: commit `feat(ui-workspace): a picker replaces the components drawer`

### Task 5: The dock fills from the picker; parking and Bring back

**Files:** Create `src/dock/template-mode.ts` (move `show`/template bookkeeping out of the dock); Modify `src/components/workspace-dock.ts` (≤226), `src/dock/template-view.ts` (empty-position `+`, ✕), `src/dock/palette.ts` (`split` gains a target), `src/dock/sources.ts` (drag sources go with the drawer — delete if unused), `src/components/workspace-controls.ts` (no disabled thumbnails; `enabledFor` gone); Test `test/dock-template.test.ts`, `test/workspace-controls.test.ts`, `test/dock-split.test.ts`

**Interfaces — Consumes:** Task 3 (`place`, `relayout`, `bringBackTo`, `TemplateState`), Task 4 (`pick`). **Produces:** dock behaviour only; `setTemplate(id)` now always switches (returns false only while a new pod is being made); `split(layout, state, title, target?: ComponentItem)` splits `target` when given.

Behaviour (spec Part 2): switching places via `place`/`relayout`; any parked → notice `.dock-notice` "N panels hidden — Bring back" with a dismiss ✕ (hidden until the parked count changes); Bring back → `setTemplate(bringBackTo(placed+parked, current))`. Empty position `+` → `pick(btn, { templates, hidden: parked })` → mount there (a Hidden choice leaves `parked`). Filled position ✕ → that position becomes `null` (panel destroyed). Dock: a `+` in each stack header's controls → `pick` → on a choice `split(layout, state, title, thatStack's active item)`; an empty dock (no root content) shows a large `+` overlay → `pick` → adds the panel. Add from outside in a template: shown → focus; else first `null` position; else flip to dock and add. Back to dock: kept tree minus panels emptied in the template, plus template-added panels split in (reading order). Save/`arrangement()` include `parked`.

- [ ] Step 1: failing tests — 4 panels → `setTemplate('two-cols')` → 2 positions filled, `arrangement().template.parked.length === 2`, notice says "2 panels hidden"; Bring back → `template === 'grid'`, no notice; 1 panel → `two-cols` → one empty position with `+`; clicking it with `pick` stubbed to `{widget:'plain'}` fills it; stub `null` → unchanged; ✕ empties a position; in two-cols with an empty position, `addWidget('plain')` fills it; with none empty, flips to dock; back to dock after filling/emptying → dock panels match; dock header `+` with stub choice splits that stack, stub null → panel count unchanged; empty dock shows the `+`; controls: all 8 thumbnails enabled.
- [ ] Step 2–4: run `bun test --isolate test/dock-template.test.ts test/dock-split.test.ts test/workspace-controls.test.ts` FAIL → implement → PASS; full suite, tsc, structure test.
- [ ] Step 5: commit `feat(ui-workspace): fill layouts from the picker; park what doesn't fit`

### Task 6: Docs and hand check

**Files:** Modify `design.md` ("Views and layout": replace the drawer/hover-button/enabledFor sentences with the picker, `parked`, Bring back, nav edit mode); headers of touched files.

- [ ] Step 1: write the docs.
- [ ] Step 2: (controller) build and drive the page: nav `+`, edit mode rename/icon/reorder, 1→two-cols fill via picker, 4→two-cols park + Bring back, dock header `+`, empty dock `+`, narrow width.
- [ ] Step 3: all CLAUDE.md suites pass.
- [ ] Step 4: commit `docs: nav edit mode and the layout picker`
