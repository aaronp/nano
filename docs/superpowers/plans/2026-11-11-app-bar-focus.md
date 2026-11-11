# App bar controls and panel focus — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The app bar shows the controls of whatever the user is working in — the workspace's controls by default, a
focused panel's own controls when it has some — driven by an app gateway component that sits in every system.

**Architecture:** A rune component `AppGateway` (`@composable/shell`) owns focus and the app-bar target; one instance,
`app`, lives in `host` and the platform adds it to every system it creates. The dock reports focus as a DOM event; a
small host module turns route changes and dock focus into gateway calls and makes each dock's `WorkspaceControls`
instance on demand. `<nano-app-bar name="app">`, after the File menu, renders the element of whatever instance the
gateway's `appBar` names.

**Tech Stack:** TypeScript, Bun (`bun test`, happy-dom), Lit, `@pritzlaff/nano-runes` / `nano-core` /
`nano-elements`, golden-layout 2.6.

**Spec:** `docs/superpowers/specs/2026-11-11-app-bar-focus-design.md`

## Global Constraints

- Every op typed and described (description on every op and schema; `examples` on schemas), as in `shell/src/profile.ts`.
- Focus and the app bar are live UI state: never written to `nano.json` or the working copy.
- `app` and every `ws-controls-*` instance are reserved: never written, skipped on load, not offered as dock widgets.
- Icon buttons have `aria-label` and `title`; the View toggle exposes its state (`aria-pressed`); visible focus rings.
- App-bar controls take the app bar's colour (`color: inherit`), never `--nano-fg`, so they read on every theme.
- Icons: 24×24 stroke paths, the File menu's style (`shell/src/file-menu-el.ts` `ICONS`).
- Tests: `cd packages/<pkg> && bun test` (`bun test --isolate` in `ui-workspace`). Commit on the current branch after each task.

## Review Focus

1. Clicking inside the panel that is already focused must not reset and re-set the bar (no flicker) — Task 1 (same focus is a no-op), Task 4 (repeated clicks send one `dock:focus`).
2. Closing the focused panel puts the workspace's controls back — Task 4 (close → `dock:focus` null), Task 6 (end to end).
3. Moving to a saved workspace's page shows *that* dock's controls, not Main's — Task 6.
4. A restored working copy whose saved workspace has its own system still gets the gateway there, and the gateway is never written to the snapshot — Task 3.
5. The gateway can't be removed from a system through the Systems view — Task 2.

## Files

- Create `packages/shell/src/app-gateway.ts` — the `AppGateway` component. Export from `shell/src/index.ts`.
- Modify `packages/shell/src/app.ts` — `RESERVED` gains `app` and `ws-controls-*`.
- Modify `packages/platform/src/platform.ts` — `gateways` option.
- Modify `packages/ui-workspace/src/composable.ts` — make `app`, pass `gateways`.
- Modify `packages/ui-workspace/src/components/workspace-dock.ts` — toolbar gone; public commands; focus events.
- Modify `packages/ui-workspace/src/lib/dock-layout.ts` — `focus` style titled `Clear`.
- Modify `packages/ui-workspace/src/widgets/widgets.ts` — `<status-line>` shows `dock:status` messages.
- Create `packages/ui-workspace/src/components/workspace-controls.ts` — `WorkspaceControls` component + `<nano-workspace-controls>`.
- Create `packages/ui-workspace/src/components/app-bar.ts` — `<nano-app-bar>`.
- Create `packages/ui-workspace/src/boot-app-bar.ts` — host glue; import it from `src/main.ts` after `composable.ts`.
- Modify `packages/ui-workspace/public/index.html` — `<nano-app-bar>` after `<nano-file-menu>`.

---

### Task 1: `AppGateway` component

**Files:** Create `packages/shell/src/app-gateway.ts`; modify `packages/shell/src/index.ts`; test `packages/shell/test/app-gateway.test.ts`.

**Interfaces:**
- Produces: `AppGateway` (rune component, id `nano.shell/app-gateway`), with
  - types `Focus = { system: string; instance: string; widget?: string } | null`, `Target = { system: string; instance: string } | null`
  - getters (sources) `focused: Focus`, `appBar: Target`
  - event `focus: Focus` (published on every change)
  - actions `setFocus(f: Focus)`, `setAppBarComponent(t: Target)`, `setAppBarDefault(t: Target)`
  - exported `Focus`, `Target` types

- [ ] **Step 1: Write the failing tests** (instantiate into a registry + runtime as `shell/test/profile.test.ts` does)
  - `test('setFocus resets the bar to the default, then publishes focus')`: `setAppBarDefault({system:'host',instance:'ws-controls-workspace'})`; `setAppBarComponent({system:'host',instance:'x'})`; subscribe a spy to `focus`; `setFocus({system:'host',instance:'p1',widget:'workspace'})` → `appBar` equals the default **at the moment the spy receives** `{system:'host',instance:'p1',widget:'workspace'}`; `focused` equals it too.
  - `test('the same focus again is a no-op')`: after the above, `setAppBarComponent({system:'host',instance:'p1'})`, `setFocus` with an equal value → no second `focus` event, `appBar` still `p1`.
  - `test('setAppBarDefault while nothing overrides it shows at once')`: fresh; `setAppBarDefault(t)` → `appBar` equals `t`; `setAppBarDefault(null)` → `appBar` null.
  - `test('setFocus(null) publishes null and shows the default')`.
  - `test('every op is described')`: each op in `AppGateway.ops` has a description.
- [ ] **Step 2:** `cd packages/shell && bun test test/app-gateway.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** with `component`/`state`/`event` from `@pritzlaff/nano-runes` (see `profile.ts`). State `{ focused, appBar, fallback }`. `setFocus`: if `JSON.stringify` equal to `focused`, return; else `appBar = fallback`, `focused = f`, then publish the `focus` event. `setAppBarDefault`: sets `fallback`, and also `appBar` when `appBar` currently equals the old fallback (no panel override showing). Schemas with descriptions and examples.
- [ ] **Step 4:** run → PASS; `bun test` in `packages/shell` all pass.
- [ ] **Step 5: Commit** `feat(shell): AppGateway — focus and the app bar, for every system`.

### Task 2: The platform adds gateways to every system

**Files:** Modify `packages/platform/src/platform.ts`; test `packages/platform/test/` (the existing platform test file).

**Interfaces:**
- Produces: `platform(host, catalog, opts)` — `opts.gateways?: readonly string[]`: ids of instances in the host registry; `opts.locked?: (id: string) => boolean`: ids `removeFromSystem` refuses (gateways are always refused).

- [ ] **Step 1: Failing tests**
  - `test('a new system gets each gateway: the same instance, in both registries')`: host registry has instance `app`; `platform(host, catalog, { gateways: ['app'] })`; `createSystem('lab')` → `runtimeOf(host.registry,'lab')!.registry.get('app')!.value` is the **same object** as `host.registry.get('app')!.value`.
  - `test('a gateway cannot be removed from a system')`: `removeFromSystem({instance:'app', system:'lab'})` → error result containing `can't be removed`; same for `system:'host'`.
  - `test('a locked instance cannot be removed')`: `locked: id => id.startsWith('ws-controls-')` → removing `ws-controls-x` errors.
  - `test('a gateway missing from the host is skipped, not an error')`: `gateways:['nope']`, `createSystem` succeeds.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.** In `createSystem`, after the runtime is made: for each gateway id present in the host registry, add it as `addToSystem` does (same instance, owner, labels). In `removeFromSystem`, refuse ids in `opts.gateways` or matching `opts.locked` alongside `registry`/self.
- [ ] **Step 4:** run → PASS; whole platform suite passes.
- [ ] **Step 5: Commit** `feat(platform): gateways — instances added to every new system, never removed`.

### Task 3: The host makes `app`; it is reserved

**Files:** Modify `packages/ui-workspace/src/composable.ts`, `packages/shell/src/app.ts`; tests `packages/ui-workspace/test/host.test.ts`, `packages/ui-workspace/test/app-snapshot.test.ts`, `packages/shell/test/` (RESERVED).

**Interfaces:**
- Consumes: `AppGateway` (Task 1), `opts.gateways` (Task 2).
- Produces: instance `app` in `host`, owner `{ kind: 'app', name: 'ui-workspace' }`, made **before** the platform (so `createSystem` finds it). `RESERVED(id)` true for `app` and ids starting `ws-controls-`.

- [ ] **Step 1: Failing tests**
  - shell: `RESERVED('app')`, `RESERVED('ws-controls-workspace')` true; `RESERVED('apps')` false.
  - host.test: `test('the app gateway is in host and in every system the platform makes')` — `createSystem('g1')` via `P.createSystem`, then `runtimeOf(host.registry,'g1')!.registry.get('app')` is defined.
  - app-snapshot.test: `test('the gateway is never written, in host or a workspace system')` — after making a system with a workspace, `snapshotApp(...)` has no instance `app` in any system.
  - app-boot or app-apply test: applying a document with a `lab` system (replace) → `lab`'s registry has `app`.
- [ ] **Step 2:** run (`cd packages/ui-workspace && bun test --isolate`; `cd packages/shell && bun test`) → FAIL.
- [ ] **Step 3: Implement.** `host.registry.add('app', Components.instantiate(AppGateway), owner)` before the platform line; pass `gateways: ['app']` and `locked: id => id.startsWith('ws-controls-')`. Extend `RESERVED`.
- [ ] **Step 4:** run both suites → PASS.
- [ ] **Step 5: Commit** `feat(ui-workspace): the app gateway in host and every workspace system`.

### Task 4: The dock loses its toolbar, exposes commands, reports focus

**Files:** Modify `workspace-dock.ts`, `lib/dock-layout.ts`, `widgets/widgets.ts`; tests `test/dock-style.test.ts`, a new `test/dock-focus.test.ts` (mount a `<workspace-dock>` as `test/sandbox-dock.test.ts` / `drawer.test.ts` do).

**Interfaces:**
- Produces, on `<workspace-dock>` (public):
  - `get style(): WindowStyle`, `setStyle(s: WindowStyle): void` (remembers it per dock and sets the `chrome` attribute, as the `<select>` did)
  - `save()`, `restore()`, `reset()` (now public), `saveAs()` (fires `dock:save-as` as the button did), `connections()` (fires `dock:connections` as the button did)
  - DOM event `dock:focus`, bubbling + composed, `detail: { system: string; instance: string; widget: string } | null` — `system` is the dock's `system` attribute (default `'host'`), `instance` the shown element's `model`, `widget` the dock's `id`. `null` when the focused panel shows no instance, or nothing is focused.
  - bus topic `dock:status` `{ message }` in place of the toolbar's status text.
- `WINDOW_STYLES` becomes `[{ id: 'tabs', title: 'Tabs' }, { id: 'focus', title: 'Clear' }]` (ids unchanged: remembered choices survive).

- [ ] **Step 1: Failing tests**
  - `test('the dock has no toolbar')`: no `.dock-bar`, no `[role="toolbar"]` inside the dock.
  - `test('clicking into a panel sends dock:focus with its instance, once')`: open a panel whose template is a placed element; `pointerdown` inside it twice → exactly one `dock:focus` with `{ system:'host', instance:<its model>, widget:<dock id> }`.
  - `test('a panel that shows no instance sends dock:focus null but is still marked')`: panel with plain `<div>`; click → `dock:focus` `null`; its stack header has golden-layout's focused class (`lm_focused`).
  - `test('closing the focused panel sends dock:focus null')`.
  - `test('clicking the dock\'s empty space clears focus')` → `dock:focus` null.
  - `test('setStyle remembers the style and sets chrome')`.
  - `test('say goes to the bus as dock:status')` (e.g. `save()` publishes `dock:status` `{ message: … }`).
  - dock-style.test: titles are `['Tabs', 'Clear']`.
  - widgets: `<status-line>` renders `message` text for a `dock:status` message.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.** Delete the toolbar build in `connectedCallback` (title, hint, status, select, buttons); the dock area fills the dock (adjust `.dock-bar` CSS in the styles string). Focus: in `mount`, `pointerdown` and `focusin` on `container.element` call `container.focus()`; listen to the layout's `focus` / `blur` bubbling events (golden-layout 2.6: `ComponentItem` emits them, `layout.focusedComponentItem`); send `dock:focus` only when the focused item changes. Empty space: `pointerdown` on the dock area outside any `.dock-panel` and outside headers → `layout.clearComponentFocus()`. Close: a focused item's container being destroyed sends `null`. Style the focused header with the accent (`.lm_header.lm_focused .lm_tab.lm_active`). `<status-line>`: when the last message's payload has a string `message`, render it instead of "Last event: …".
- [ ] **Step 4:** `bun test --isolate` → all PASS (update any test that clicked toolbar buttons to call the public methods).
- [ ] **Step 5: Commit** `feat(ui-workspace): the dock reports panel focus; its toolbar is gone`.

### Task 5: `WorkspaceControls` and `<nano-workspace-controls>`

**Files:** Create `packages/ui-workspace/src/components/workspace-controls.ts`; test `test/workspace-controls.test.ts`.

**Interfaces:**
- Consumes: the dock's public commands (Task 4).
- Produces:
  - `WorkspaceControls` (rune component, id `composable.ui-workspace/workspace-controls`): getter `dock: string`, getter `style: 'tabs' | 'focus'`; actions `attach(dockId: string)` (records the dock, reads its current `style`), `setStyle(s)`, `connections()`, `saveAs()`, `save()`, `restore()`, `reset()` — each finds `document.getElementById(dock)` and calls the same-named dock method; a missing dock throws `no dock <id>`.
  - `<nano-workspace-controls name="…">` (a `PlacedElement` of `WorkspaceControls`), defined by `defineWorkspaceControls()`.
  - `controlsId(dockId: string) => \`ws-controls-${dockId}\``.

- [ ] **Step 1: Failing tests**
  - `test('the controls drive their dock')`: a stub element with id `d1` and spy methods; `attach('d1')`, then each action calls the matching method once; `setStyle('focus')` → stub's `setStyle('focus')` and `style` getter `'focus'`.
  - `test('the element shows View Tabs | Clear and five labelled icon buttons')`: `aria-pressed` true on the current style's button; buttons labelled `Connections`, `Save as workspace…`, `Save layout`, `Restore`, `Reset`, each with an `<svg>` and a `title`.
  - `test('clicking Clear calls setStyle')` → `style` becomes `'focus'`, `aria-pressed` follows.
  - `test('takes the app bar colour')`: the element's styles text contains `color: inherit` and not `--nano-fg` outside the overflow menu rule.
  - `test('narrow: the buttons fold into a ⋯ menu')`: with the host's narrow query matching (`(max-width: 840px)`, stub `matchMedia`), only the View toggle and a `⋯` button (`aria-label="More workspace actions"`) render; opening it lists the five commands as buttons.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** (model the element on `shell/src/profile-el.ts` and the File menu: Escape and outside click close the ⋯ menu; the menu panel uses `--nano-surface`/`--nano-fg` like the File menu's).
- [ ] **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `feat(ui-workspace): workspace controls, as a component and an app-bar element`.

### Task 6: `<nano-app-bar>` and the host glue

**Files:** Create `src/components/app-bar.ts`, `src/boot-app-bar.ts`; modify `src/main.ts`, `public/index.html`; test `test/app-bar.test.ts` (and the `host.test.ts` page fixture, which loads `index.html`).

**Interfaces:**
- Consumes: `AppGateway` ops and `Target` (Task 1); `dock:focus` (Task 4); `WorkspaceControls`, `controlsId`, `<nano-workspace-controls>` (Task 5); `runtimeOf`.
- Produces:
  - `<nano-app-bar name="app">` — a `PlacedElement` of `AppGateway`; property `resolve: (t: { system: string; instance: string }) => { tag: string; registry: Registry } | undefined`. Renders the resolved element as its only child (light DOM, host `display: contents`), with `registry` set and `name` = the instance, **before** it connects. Same target as before → leaves the child alone. `null` → empty. Unresolvable → empty, plus `dock:status`-style message via `showStatus(document, \`<instance> has no element to show in the app bar\`)`.
  - `boot-app-bar.ts`:
    - sets `resolve` on `<nano-app-bar>`: registry = `system === 'host' ? host.registry : runtimeOf(host.registry, system)?.registry`; tag = the catalog entry whose component id matches the instance's component, else `nano-workspace-controls` for `WorkspaceControls`.
    - on the app bus's `route:changed` (`requestBus` from `lib/bus.ts`): `setFocus(null)`; if the shown `app-route` holds a `workspace-dock`, make `controlsId(dock.id)` in `host` if missing (owner `{ kind: 'app', name: 'ui-workspace' }`), call `attach(dock.id)`, then `setAppBarDefault({ system: 'host', instance: controlsId(dock.id) })`; otherwise `setAppBarDefault(null)`.
    - on `document` `dock:focus`: `setFocus(detail)`.
  - `index.html`: `<nano-app-bar name="app" slot="title-actions"></nano-app-bar>` right after `<nano-file-menu …>`.

- [ ] **Step 1: Failing tests**
  - `test('on the workspace page the app bar shows its controls')`: go to `#/workspace` → `nano-app-bar > nano-workspace-controls[name="ws-controls-workspace"]`.
  - `test('a saved workspace page shows its own dock\'s controls')`: mount a saved workspace (as `saved-workspaces.test.ts` does), go to its path → `name="ws-controls-<its dock id>"`.
  - `test('a page without a dock empties the bar')`: `#/settings` → `nano-app-bar` has no children.
  - `test('a focused panel puts up its own controls, and they leave with focus')`: in `host`, a test component (core `Components.create`, as `host.test.ts`'s spy) subscribed to `app`'s `focus`; on its own coordinates it calls `setAppBarComponent` on `app` (via its handle's `call`) with itself; give it a tag in the resolver's catalog. Dispatch `dock:focus` for it → its element is in the bar, and the workspace controls are gone. Dispatch `dock:focus` null → the workspace controls are back.
  - `test('the same component in a workspace system reaches the gateway')`: as above, with the test component in a saved workspace's system → its element shows.
  - `test('an unresolvable target shows nothing and says so')`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** as in Interfaces.
- [ ] **Step 4:** `bun test --isolate` → all PASS; `bun run build` succeeds; `bunx tsc --noEmit` at the repo root shows nothing new for `ui-workspace`, `shell`, `platform`.
- [ ] **Step 5: Manual check** — run the app (`bun run dev` + `bun run serve` in `packages/ui-workspace`): on each theme (including Graph paper, Retro, Enterprise (Light), Warm Ledger) the controls are readable; clicking panels, empty space, and closing a panel behave as above; narrow window shows ⋯.
- [ ] **Step 6: Commit** `feat(ui-workspace): the app bar shows the focused view's controls`.
