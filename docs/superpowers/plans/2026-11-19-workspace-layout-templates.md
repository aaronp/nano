# Workspace pages and layout templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Duplicate/edit workspace pages from the nav, and flip any page's dock between golden-layout and fixed responsive templates whose positions hold the dock's panels.

**Architecture:** Pure helpers in `src/lib/` (template table, reading order, swap, template state, saved pages). `<workspace-dock>` gains a template mode rendered by `src/dock/template-view.ts`, mounting panels with the existing `mountPanel` through a container stand-in. Saved pages are mounted from localStorage before `<app-shell>` reads its routes.

**Tech Stack:** TypeScript, Lit, golden-layout 2.6, bun test + happy-dom.

**Spec:** `docs/superpowers/specs/2026-11-19-workspace-layout-templates-design.md`

## Global Constraints

- All code in `packages/ui-workspace`; no change to nano-core or nano-ui.
- No source file over 150 lines (`packages/nano/test/structure.test.ts`); the baseline may only shrink. `components/workspace-dock.ts` is already over (226): it may not grow — move code out to `dock/` to make room.
- New public names, exactly: template ids `dock one two-cols two-rows main-two three-cols grid main-drawer`; `<workspace-dock>`'s `template`, `setTemplate(id)`, `arrangement()`; nav actions Duplicate and Edit. No others without asking the user.
- Template state key: `${storageKey}.template` = `{ template, order, dock }`. Saved page dock key: `${mainKey}.saved.${path}`.
- A template is enabled iff panel count === its positions; `dock` always.
- Narrow breakpoint: `(max-width: 840px)` (as `workspace-controls.ts`).
- Tests: `cd packages/ui-workspace && bun test --isolate`; types: `bunx tsc --noEmit` at the repo root.

## Review Focus

- Switching to a template and back leaves the dock exactly as arranged (same panels, same tree) — even across a reload.
- A pod panel is never mounted twice (no second view, no second `addPod`).
- A stored template whose count no longer fits (panels changed, or a corrupt/unknown id) opens as Dock, not a broken page.
- Editing a page's route to one already taken is refused; the old route's storage isn't lost on a refused edit.
- Hover actions are reachable by keyboard (focus-within), not hover-only.

---

### Task 1: Template table and pure helpers

**Files:**
- Create: `packages/ui-workspace/src/lib/layout-templates.ts`
- Test: `packages/ui-workspace/test/layout-templates.test.ts`

**Interfaces:**
- Produces:
  - `type TemplateId = 'dock' | 'one' | 'two-cols' | 'two-rows' | 'main-two' | 'three-cols' | 'grid' | 'main-drawer'`
  - `TEMPLATES: readonly { id: TemplateId; title: string; positions: number | null; areas: string[] }[]` (`positions: null` for dock; `areas` are the position names, e.g. `['main','drawer']`, `['1','2']`)
  - `type PanelState = { widget: string; name?: string }`
  - `panelsInOrder(root: unknown): PanelState[]` — component states in reading order (row → left to right, column → top to bottom, stack → tab order)
  - `enabledFor(count: number): Set<TemplateId>`
  - `swap<T>(order: readonly T[], i: number, j: number): T[]`
  - `type TemplateState = { template: TemplateId; order: PanelState[]; dock: unknown }`
  - `templateState(storage: Pick<Storage,'getItem'|'setItem'|'removeItem'>, key: string): { get(): TemplateState | null; set(s: TemplateState | null): void }` — `get` returns null for missing, unparsable, unknown id, `dock`, or `order.length !== positions`; storage throwing reads as null.

- [ ] **Step 1: Write the failing tests**

```ts
test('panels come in reading order', () => {
  const c = (w: string) => ({ type: 'component', componentState: { widget: w } })
  const root = { type: 'row', content: [c('a'), { type: 'column', content: [c('b'), { type: 'stack', content: [c('c'), c('d')] }] }] }
  expect(panelsInOrder(root).map(p => p.widget)).toEqual(['a', 'b', 'c', 'd'])
})
test('a pod panel keeps its name', () => expect(panelsInOrder({ type: 'component', componentState: { widget: 'pod', name: 'up1' } })).toEqual([{ widget: 'pod', name: 'up1' }]))
test('enabled templates match the count exactly; dock always', () => {
  expect([...enabledFor(2)].sort()).toEqual(['dock', 'main-drawer', 'two-cols', 'two-rows'])
  expect([...enabledFor(4)].sort()).toEqual(['dock', 'grid'])
  expect([...enabledFor(5)]).toEqual(['dock'])
})
test('swap exchanges two positions without mutating', () => { const o = ['a','b','c']; expect(swap(o, 0, 2)).toEqual(['c','b','a']); expect(o).toEqual(['a','b','c']) })
test('template state: unknown id, wrong count and junk read as null', () => {
  const s = templateState(localStorage, 'k')
  s.set({ template: 'two-cols', order: [{ widget: 'a' }, { widget: 'b' }], dock: { root: null } })
  expect(s.get()?.template).toBe('two-cols')
  localStorage.setItem('k.template', JSON.stringify({ template: 'nope', order: [], dock: null })); expect(s.get()).toBeNull()
  localStorage.setItem('k.template', JSON.stringify({ template: 'grid', order: [{ widget: 'a' }], dock: null })); expect(s.get()).toBeNull()
  localStorage.setItem('k.template', '{'); expect(s.get()).toBeNull()
  s.set(null); expect(localStorage.getItem('k.template')).toBeNull()
})
```

- [ ] **Step 2: Run** `cd packages/ui-workspace && bun test --isolate test/layout-templates.test.ts` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `src/lib/layout-templates.ts` with the signatures above. Positions: one 1, two-cols 2, two-rows 2, main-two 3, three-cols 3, grid 4, main-drawer 2.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui-workspace): layout template table, reading order, swap, template state`

### Task 2: Template view and the dock's template mode

**Files:**
- Create: `packages/ui-workspace/src/dock/template-view.ts` (render + CSS + container stand-in)
- Modify: `packages/ui-workspace/src/components/workspace-dock.ts` (net lines may not grow: move `connectSources`/`addSource` or save/restore/reset bodies into `dock/` as needed)
- Test: `packages/ui-workspace/test/dock-template.test.ts` (uses `test/dock-setup.ts`'s `mount`)

**Interfaces:**
- Consumes: Task 1's `TEMPLATES`, `panelsInOrder`, `enabledFor`, `swap`, `templateState`; `mountPanel` from `dock/panels.ts`.
- Produces on `WorkspaceDock`:
  - `get template(): TemplateId`
  - `setTemplate(id: TemplateId): boolean` — false (and a `dock:status` message) when not enabled for the current count, or an implementation panel has no name yet
  - `arrangement(): { root?: unknown; template?: TemplateState } & Record<string, unknown>` — golden-layout's resolved config (the kept one while a template shows) plus `template` when not dock
- `dock/template-view.ts`: `renderTemplate(host: HTMLElement, t: TemplateId, order: PanelState[], mount: (el: HTMLElement, state: PanelState) => () => void, onSwap: (i: number, j: number) => void): () => void` — builds a `.dock-template[data-template=t]` grid with one `.tpl-pos` per area (header: title + `<select aria-label="Position">` of area names), returns a dispose that calls every unmount.

- [ ] **Step 1: Write the failing tests** (two `plain` panels via `dock.addWidget('plain')` twice after `mount()` with `open=""`):

```ts
test('two panels flip to two-cols and back to the same tree', async () => {
  const { dock } = await mount(); dock.addWidget('plain'); dock.addWidget('plain'); await tick()
  const before = JSON.stringify(dock.arrangement().root)
  expect(dock.setTemplate('two-cols')).toBe(true)
  expect(dock.querySelectorAll('.dock-template .tpl-pos').length).toBe(2)
  expect(dock.arrangement().template?.template).toBe('two-cols')
  expect(dock.setTemplate('dock')).toBe(true)
  expect(JSON.stringify(dock.arrangement().root)).toBe(before)
})
test('a template that does not fit the count is refused', async () => { const { dock } = await mount(); dock.addWidget('plain'); await tick(); expect(dock.setTemplate('grid')).toBe(false); expect(dock.template).toBe('dock') })
test('swapping positions reorders the panels', async () => { /* two-cols, set first select to '2', expect arrangement().template.order reversed */ })
test('a reload in a template comes back in it, and flips back to the hand-made dock', async () => { /* setTemplate, remove dock, mount again with same storage-key, expect template 'two-cols', setTemplate('dock') root equals before */ })
test('opening a pod panel in a template flips back to dock and adds it', async () => { /* setTemplate('two-cols'); dock.addWidget('plain'); expect(dock.template).toBe('dock'); panelsInOrder(dock.arrangement().root).length === 3 */ })
```

- [ ] **Step 2: Run** `bun test --isolate test/dock-template.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.** `setTemplate(id)`: from dock → keep `saveLayout()`, `order = panelsInOrder(root)`, `layout.clear()`, `renderTemplate(...)`, store via `templateState`; the mount callback calls `mountPanel` with a stand-in `{ element, on(e, f) { if (e === 'destroy') destroys.push(f) }, focus() {}, stateRequestEvent: undefined }` and returns a function running `destroys`. To dock → dispose, `load(LayoutConfig.fromResolved(kept))`, clear stored state. In `connectedCallback`, after loading, a valid stored `templateState` re-enters its template. `addWidget`/`openPod` while in a template: if the pod is already shown, focus its position; else `setTemplate('dock')` then proceed. `main-drawer`: a toggle button `aria-expanded` on the drawer; at ≤840px the drawer is a slide-over. `dock:focus` reports a clicked position's instance as the dock does.
- [ ] **Step 4: Run** the dock tests: `bun test --isolate test/dock-template.test.ts test/dock-focus.test.ts test/dock-split.test.ts test/dock-style.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui-workspace): workspace-dock template mode and arrangement()`

### Task 3: Save and import use `arrangement()`

**Files:**
- Modify: `packages/ui-workspace/src/main.ts:40-48` (the `arrangement` reach-in and `shown`)
- Test: `packages/ui-workspace/test/layout-data.test.ts`

**Interfaces:**
- Consumes: `dock.arrangement()`, `dock.setTemplate()`.
- Produces: `savedLayout(saved, dockId, arrangement, runtimeOf, desk?)` unchanged in signature; it now carries `arrangement.template` through under `layout[dockId]`.

- [ ] **Step 1: Failing test:** `savedLayout({}, 'workspace', { root: R, template: T }, main)` has `.workspace.template` equal `T` and slots computed from `R`.
- [ ] **Step 2: Run** `bun test --isolate test/layout-data.test.ts` — Expected: FAIL only if `savedLayout` drops it; if it already passes (spread), keep the test as a pin and continue.
- [ ] **Step 3: Implement:** in `main.ts` replace the private reach-in with `dock?.arrangement()`; in `shown`, after `restore()`, if `l.template` is a valid `TemplateState` call `dock.setTemplate(l.template.template)` with its `order` (write it to `templateState` before `restore()` so the dock re-enters it).
- [ ] **Step 4: Run** `bun test --isolate` (whole package) and `bunx tsc --noEmit` at root — Expected: PASS.
- [ ] **Step 5: Commit** `refactor(ui-workspace): Save reads the dock's arrangement(); imports keep a template`

### Task 4: Layout picker in the workspace controls

**Files:**
- Modify: `packages/ui-workspace/src/components/workspace-controls.ts`
- Test: `packages/ui-workspace/test/workspace-controls.test.ts`

**Interfaces:**
- Consumes: `TEMPLATES`, `enabledFor`; the dock's `template`, `setTemplate`, and the count as `panelsInOrder(dock.arrangement().root).length`; re-renders on the bus `dock:layout` topic.

- [ ] **Step 1: Failing tests:** the controls render a `role="radiogroup" aria-label="Layout"` with one radio per template (8), the current one checked; with 2 panels, `grid` is `disabled` and its `title` says it needs 4 panels; clicking `two-cols` calls `setTemplate('two-cols')`; Tabs/Clear group is absent when `template !== 'dock'`.
- [ ] **Step 2: Run** `bun test --isolate test/workspace-controls.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement:** a row of small inline-SVG thumbnails (one rect per area, drawn from the template's grid) before the view group; in the narrow menu the row comes first. Keep the file ≤150 lines (thumbnail SVGs may go in `lib/layout-templates.ts` or a small `components/layout-thumbs.ts`).
- [ ] **Step 4: Run** the same — Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui-workspace): layout picker in the workspace controls`

### Task 5: Saved pages store (pure)

**Files:**
- Modify: `packages/ui-workspace/src/lib/saved-workspaces.ts`
- Test: `packages/ui-workspace/test/saved-workspaces.test.ts` (new; the retired one is reference only)

**Interfaces:**
- Produces:
  - `SavedWorkspace = { path: string; title: string; icon: string }` (`system` removed; `SYSTEM` removed if nothing else uses it)
  - `layoutKey(mainKey: string, path: string): string` = `${mainKey}.saved.${path}`
  - `savedWorkspaces(storage)` gains `add(ws: SavedWorkspace, taken: readonly string[]): string | null` (refusal or null; appends) and `update(path: string, ws: SavedWorkspace, taken: readonly string[], mainKey: string): string | null` (refusal or null; on a route change moves `layoutKey`, `.template` and `.window-style` keys to the new path; `refusal` ignores the page's own old path)

- [ ] **Step 1: Failing tests:** add then list; add with taken path refused; update title/icon keeps path; update path moves `m.saved./a`, `m.saved./a.template`, `m.saved./a.window-style` to `/b`; update to a taken path is refused and leaves keys at `/a`.
- [ ] **Step 2: Run** `bun test --isolate test/saved-workspaces.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui-workspace): saved workspace pages store with add and update`

### Task 6: Workspace pages in the nav (mount, duplicate, edit, +, Save as)

**Files:**
- Create: `packages/ui-workspace/src/components/workspace-pages.ts` (mount + hover actions + handlers; split if over 150)
- Create: `packages/ui-workspace/src/boot-workspace-pages.ts` (mounts saved pages; imported in `main.ts` before `./components/app-shell.ts`)
- Modify: `packages/ui-workspace/src/main.ts:100-102` (remove the two "not available yet" stubs), `packages/ui-workspace/src/components/workspace-dialog.ts` (no `systems` path needed for these callers; leave the option), `packages/ui-workspace/public/app.css` (hover actions)
- Test: `packages/ui-workspace/test/workspace-pages.test.ts`

**Interfaces:**
- Consumes: Task 5's store and `layoutKey`; `askWorkspace(doc, { heading, error?, prev? })`; `dock.arrangement()`.
- Produces: `mountWorkspace(doc: Document, ws: SavedWorkspace): void` (nav `<a slot="nav" data-saved=path>` after Main/last saved, `<app-route path bleed>` with `.ws-page` > `component-drawer[for=id]` + `c-wires` > `workspace-dock#ws-<path> storage-key=layoutKey(main,path) open=""` with Main's `template[data-widget]` cloned — retired `mountWorkspace` minus the system/registry lines); `bootWorkspacePages(doc: Document): void`.
- Hover actions: each workspace nav entry gets `<button data-duplicate aria-label="Duplicate <title>">` and (saved only) `<button data-edit aria-label="Edit <title>">`, visible on `:hover` and `:focus-within`, hidden when `app-shell[collapsed]`.

- [ ] **Step 1: Failing tests** (happy-dom page with an `app-shell`-less fixture: a nav container, Main's `workspace-dock#workspace` with two templates, a `*` route): `mountWorkspace` adds nav link and route before `*`, dock has Main's templates and the right `storage-key`; Duplicate with a stubbed dialog result `{ path:'/b', title:'B', icon:'star' }` writes `layoutKey(main,'/b')` from the source's `arrangement()` (and `.template` when set), lists `/b`, navigates to `#/b`; Edit to `/c` moves keys and updates link `href`, `data-saved` and route `path`; a refused choice re-opens the dialog with the error.
- [ ] **Step 2: Run** `bun test --isolate test/workspace-pages.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.** Dialog is injectable for tests (`bootWorkspacePages(doc, ask = askWorkspace)`). `dock:save-as` = duplicate of the dock's page; `[data-new-workspace]` = new empty page.
- [ ] **Step 4: Run** the whole package `bun test --isolate`, `bunx tsc --noEmit`, and `cd packages/nano && bun test --isolate test/structure.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui-workspace): duplicate and edit workspace pages from the nav`

### Task 7: Docs and a hand check

**Files:**
- Modify: `design.md` ("Views and layout": one paragraph on templates, `arrangement()`, saved pages and the template state key)
- Modify: `packages/ui-workspace/src/components/workspace-dock.ts` header comment (template / setTemplate / arrangement)

- [ ] **Step 1:** Write the paragraph and header lines.
- [ ] **Step 2:** Build and run the workspace (`/run` skill or `cd packages/ui-workspace && bun run build && bun run serve`): arrange 2 panels, flip through Two cols/Two rows/Main + drawer, swap, reload, flip back to Dock; duplicate to a new page, edit its route and icon; narrow the window to check reflow and the drawer.
- [ ] **Step 3:** All suites from CLAUDE.md pass.
- [ ] **Step 4: Commit** `docs: workspace pages and layout templates`
