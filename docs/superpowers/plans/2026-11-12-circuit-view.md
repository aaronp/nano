# Circuit View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only Circuit view on its own page (`#/wiring`) that shows every page of the app as a tilted carousel of
wired boards, with non-visual components and systems to one side. It comes after a prep step that brings today's
connections view in line with the Application.

**Architecture:** The groundwork goes into nano-app (pure):
- an `isInfrastructure` predicate and `viewIds`;
- `box` and `tab` on placements, which `ui-workspace`'s golden-layout `placementsOf` computes from saved sizes.

A new `@composable/circuit` package holds a pure model (`buildCircuit`) and a Lit element `<c-circuit>` that renders
it from Application ops. `ui-workspace` adds the page, the menu entry and the focus memory. `<c-wires>` keeps its live
geometry but takes membership from the Application.

**Tech Stack:** Bun workspaces, TypeScript, typebox, Lit 3, `@pritzlaff/nano-app` and `nano-core`, `bun test` with
happy-dom.

**Spec:** `docs/superpowers/specs/2026-11-12-circuit-view-design.md` (its "Rulings" section is binding).

## Global Constraints

- The view is read-only. There are no connect, disconnect or remove actions in `<c-circuit>`.
- `<c-circuit>` and its model never read golden-layout's format or the dock's DOM. They read Application ops only:
  `systems`, `kinds`, `screens`, `placements`.
- `<c-wires>`' behaviour stays otherwise unchanged. It is the reference and the editing surface.
- Infrastructure is never drawn as a user's component: `registry`, `application`, `app`, `alerts`, `ws-controls-*`,
  and instances owned by a view (`owner.kind === 'view'`). Cables to them are dropped.
- Pad type glyphs: string `Aa`, number `#`, boolean `?`, object `{}`, array `[]`, signal `•`, any `*`. The colours are
  the prototype's: string `#2dd4bf`, number `#fbbf24`, boolean `#f472b6`, object `#60a5fa`, array `#a78bfa`, signal
  `#94a3b8`, any `#e5e7eb`.
- Pad shapes: an event is round and a call is a rounded square. An input is hollow and an output filled.
- `Box` fields are fractions of the page in `[0, 1]`. `box` and `tab` are optional on `Placement`.
- The route is `#/wiring`, titled "Wiring". The profile entry is `{ label: 'Wiring', href: '#/wiring' }`, added to
  `HOST_ENTRIES` after Themes.
- Reduced motion: no tilt or carousel animation, and transitions are instant.
- Every task ends with `bunx tsc --noEmit` clean at the root and `bun test --isolate` green in every package it
  touched.
- Commits end with the Co-Authored-By line of the model that wrote them.

## Review Focus

1. A page whose saved layout has nested rows, columns and a tabbed stack gets boxes that tile the page without
   overlap. The stack's children share one box, and exactly one is the active tab (Task 2 test).
2. A page that has never been opened, or a screen with a null layout, renders as a layer: empty for null, and laid out
   from saved sizes otherwise. It never throws (Tasks 2 and 4 tests).
3. A subscription with an infrastructure end (`app`, `alerts`, `ws-controls-x`) draws no cable and no pad on that end,
   in both `<c-wires>` and Circuit (Tasks 3 and 4 tests).
4. An instance placed on two pages appears on both layers marked shared. A cable from page A to an instance only on
   page B ends on page B's layer (Task 4 test).
5. With no workspace shown yet, `#/wiring` opens on the first page, and the switcher's Connections entry is hidden
   (Task 7 test).

## File Structure

- `packages/app/src/infrastructure.ts` (new): `viewIds` and `isInfrastructure`. Exported from the index.
- `packages/app/src/application.ts`: `Placement` gains `box` and `tab`; the `placementsOf` option type widens.
- `packages/ui-workspace/src/lib/dock-layout.ts`: `placementsOf` computes `box` and `tab`.
- `packages/wires/src/model.ts` and `src/wires.ts`: membership from placements; infrastructure hidden; naming.
- `packages/platform/src/view.ts`: imports `viewIds` from nano-app.
- `packages/circuit/` (new, `@composable/circuit`):
  - `src/types.ts`: the schema → pad-type mapping;
  - `src/model.ts`: `buildCircuit`;
  - `src/circuit.ts`: the `<c-circuit>` element and its state;
  - `src/render-*.ts`: rendering pieces;
  - `src/index.ts`: `defineCircuit`.
- `packages/ui-workspace`:
  - `public/index.html`: the `#/wiring` route;
  - `src/app/stores.ts`: `HOST_ENTRIES`;
  - `src/composable.ts`: defines `<c-circuit>` and gives it the host runtime;
  - `src/boot-wiring.ts` (new): focus memory and the switcher.

---

### Task 1: Infrastructure predicate, viewIds, and placement geometry types (nano-app)

**Files:**
- Create: `packages/app/src/infrastructure.ts`
- Modify: `packages/app/src/index.ts`; `packages/app/src/application.ts` (`PlacementSchema`, the `placementsOf` option
  type); `packages/platform/src/view.ts` (import `viewIds` from nano-app and delete the local one, keeping a re-export
  if anything imports it from platform)
- Test: `packages/app/test/infrastructure.test.ts`; extend `packages/app/test/screens.test.ts`

**Interfaces:**
- Produces:
  - `viewIds(s: Snapshot): Set<string>`: instances with `owner.kind === 'view'`.
  - `isInfrastructure(id: string, views: ReadonlySet<string>): boolean`: true for `registry`, `RESERVED`/`HOST_DRIVEN`
    ids (`application`, `app`, `alerts`, `ws-controls-*`), and `views.has(id)`. Not true for `profile` or `ex-*`;
    those are user-visible built-ins.
  - `type Box = { x: number; y: number; w: number; h: number }` and `BoxSchema` (numbers 0..1).
  - `PlacementSchema` gains `box: Type.Optional(BoxSchema)` and
    `tab: Type.Optional(Type.Object({ group: Type.String(), active: Type.Boolean() }))`.
  - The `placementsOf` option returns `{ panel; instance; box?; tab? }[]`.

- [ ] **Step 1: Write the failing tests:**
  - `viewIds picks instances owned by a view`.
  - `isInfrastructure`: true for `registry`, `application`, `app`, `alerts`, `ws-controls-a` and a view id; false for
    `profile`, `ex-range` and `r1`.
  - In `screens.test.ts`, `placements carry box and tab from placementsOf`: a fake `placementsOf` returning a box and a
    tab gives the same values back from `placements`.
- [ ] **Step 2:** Run `cd packages/app && bun test`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `tsc` is clean, and tests pass in app and platform.
- [ ] **Step 5:** Commit: `feat(app): isInfrastructure and viewIds; placements carry an optional box and tab`.

### Task 2: Golden-layout placements get boxes and tabs (ui-workspace)

**Files:**
- Modify: `packages/ui-workspace/src/lib/dock-layout.ts` (`placementsOf`)
- Test: `packages/ui-workspace/test/dock-layout.test.ts`

**Interfaces:**
- Consumes: `Box` (Task 1).
- Produces: `placementsOf(layout)` returning `{ panel, instance, box, tab? }`.
  - The root box is `{ x:0, y:0, w:1, h:1 }`.
  - A `row` splits its box horizontally among its children, and a `column` splits it vertically. Each child's share
    is its `size`: with `sizeUnit` `'%'`, a percentage; with `'fr'`, a fraction of the total `fr`; missing, an equal
    share of what's left after the sized children. Shares are normalised to sum to the parent's extent.
  - A `stack`'s component children all get the stack's box, with `tab: { group: <stack path>, active: i ===
    activeItemIndex (default 0) }`. A lone component (not in a stack) has no `tab`.
  - Unnamed panels are skipped, as today.

- [ ] **Step 1: Write the failing tests:**
  - `a row of 30% and 70% splits the width`: boxes `{0,0,.3,1}` and `{.3,0,.7,1}` (within 1e-9).
  - `a column inside a row nests`: a row of [A 50%, column of [B, C] 50%] gives B `{.5,0,.5,.5}` and C
    `{.5,.5,.5,.5}`.
  - `a stack's tabs share its box; one is active`: the second item active gives `active: [false, true]`, the same
    box and the same group.
  - `fr and missing sizes split proportionally and equally`.
  - `boxes tile without overlap`: for a mixed fixture, the boxes' areas sum to 1, counting one box per stack.
  - The existing junk and null cases still give `[]`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. Check golden-layout 2.6's saved-config field names (`size`, `sizeUnit`,
  `activeItemIndex`) in its typings under `node_modules/.bun/golden-layout@2.6.0/.../dist/types/index.d.ts`.
- [ ] **Step 4:** Tests and `tsc` pass.
- [ ] **Step 5:** Commit: `feat(ui-workspace): placements get page boxes and tabs from golden-layout's saved sizes`.

### Task 3: Today's connections view follows the Application (prep)

**Files:**
- Modify: `packages/wires/src/model.ts` (`hidden` uses `isInfrastructure`; `viewIds` from nano-app; the `platform`
  input is renamed `application`); `packages/wires/src/wires.ts` (`platform` property renamed `application`, default
  `'application'`; comments; membership); `packages/wires/src/render-detail.ts` (import from nano-app);
  `packages/wires/package.json` (drop `@composable/platform` if it's no longer imported)
- Test: `packages/wires/test/model.test.ts`, `wires.test.ts`

**Interfaces:**
- Consumes: `isInfrastructure` and `viewIds` (Task 1), and the Application `placements` op.
- Produces:
  - `<c-wires>` gains an optional `screen: string` property. ui-workspace sets it to the dock's route path; with none,
    the dock's enclosing `app-route[path]` is used.
  - `panels()` keeps the live rectangles, but a panel's instance counts as on screen only if the Application's
    `placements({ screen })` lists it. If `placements` returns `[]` and the dock shows instances (a screen not yet
    known), today's DOM membership is kept, with a `ponytail:` comment.
  - `buildModel`'s input `platform` becomes `application`.

- [ ] **Step 1: Write the failing tests:**
  - `infrastructure never shows in the rack`: a snapshot with `app`, `alerts`, `ws-controls-workspace` and `r1` puts
    only `r1` in the rack.
  - `a subscription into app draws no wire`.
  - `on-screen membership comes from placements`: with the Application placing `r1` on the screen and the DOM showing
    `r1` and `r2`, `r2` goes to the rack.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `tsc` is clean, and tests pass in wires, platform and ui-workspace.
- [ ] **Step 5:** Commit: `refactor(wires): membership from the Application's placements; infrastructure hidden; application naming`.

### Task 4: The Circuit model (pure)

**Files:**
- Create: `packages/circuit/package.json` (name `@composable/circuit`, private, deps: nano-app, nano-core, lit,
  typebox; dev: bundle, happy-dom), `src/types.ts`, `src/model.ts`, `src/index.ts`
- Test: `packages/circuit/test/types.test.ts`, `packages/circuit/test/model.test.ts`

**Interfaces:**
- Consumes: `Placement` with `box` and `tab`, `Screen`, `Kind`, `isInfrastructure`, `viewIds` (nano-app); `Snapshot`
  and `Op` (core).
- Produces:
  ```ts
  type PadType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'signal' | 'any'
  function padTypeOf(schema: TSchema | undefined): PadType
  // no schema or Void → signal; type string/number|integer/boolean/object/array → those; anyOf/oneOf/Unknown/Any/other → any
  type Pad = { key: string; instance: string; op: string; label: string; dir: 'in' | 'out'; kind: 'event' | 'call'; type: PadType; description?: string }
  // input only → in/event; input+output → in/call; output only → out/event; neither → no pad
  type Footprint = { system: string; instance: string; kind?: string; title: string; box: Box; tab?: { group: string; active: boolean }; shared: boolean; pads: Pad[] }
  type Layer = { screen: string; title: string; icon?: string; system: string; footprints: Footprint[] }
  type SideItem = { system: string; instance: string; kind?: string; title: string; pads: Pad[] }
  type SystemBlock = { system: string; items: SideItem[] }
  type CableEnd = { pad: string; at: { layer: string } | { side: string } }   // side: the system id
  type Cable = { id: string; system: string; from: CableEnd; to: CableEnd; type: PadType }
  type Circuit = { layers: Layer[]; side: SystemBlock[]; cables: Cable[] }
  function buildCircuit(input: { systems: Snapshot[]; screens: Screen[]; placements: Placement[]; kinds: Kind[] }): Circuit
  ```
  - A placement without a `box` gets an automatic box: an equal grid of the page's unboxed footprints, in a
    `ceil(sqrt(n))`-column grid.
  - `shared` is true when the same `system/instance` is placed on more than one screen.
  - Side items are the instances of each system that aren't placed on any screen and aren't infrastructure.
  - A cable end resolves to the first layer in screen order that places that instance, else to `side: system`.
    Subscriptions with an infrastructure end are dropped.
  - A `title` is the catalog kind's title, else the instance id. `kind` comes from `Kind.component` matching the
    instance's component.

- [ ] **Step 1: Write the failing tests:**
  - `padTypeOf`: `Type.String()` gives `string`, `Type.Integer()` gives `number`, `Type.Void()` and `undefined` give
    `signal`, `Type.Union([...])` gives `any`, and `Type.Unknown()` gives `any`.
  - `pads from ops`: an action op with input only gives in/event; one with input and output gives in/call; a source
    op gives out/event.
  - `layers follow screen order with boxes`.
  - `an unboxed placement gets a grid box` (two placements: two half-width boxes).
  - `shared across two pages`: `r1` placed on `/a` and `/b` is `shared: true` on both layers.
  - `unplaced non-infrastructure instances go to the side`: `app` and `alerts` don't appear, `ex-log` does.
  - `cables land where their ends are`: `/a`'s `r1` → `log` (unplaced) has `to.at = { side: 'host' }`; `r1` → `r2`,
    with `r2` only on `/b`, has `to.at = { layer: '/b' }`.
  - `an infrastructure end drops the cable`.
  - `a null-layout screen is an empty layer`.
- [ ] **Step 2:** Run `cd packages/circuit && bun test`. Expected: FAIL.
- [ ] **Step 3:** Implement. Run `bun install` at the root (it may need the sandbox disabled).
- [ ] **Step 4:** Tests and `tsc` pass.
- [ ] **Step 5:** Commit: `feat(circuit): the Circuit model — page layers, side systems, typed pads and cables`.

### Task 5: `<c-circuit>`: the stage, carousel, pills and pan/zoom

**Files:**
- Create: `packages/circuit/src/circuit.ts`, `src/render-stage.ts`, `src/render-pills.ts`, `src/constants.ts` (colours,
  glyphs, tilt, fade); export `defineCircuit` from the index
- Test: `packages/circuit/test/circuit.test.ts` (happy-dom; follow `packages/wires/test/setup.ts`)

**Interfaces:**
- Consumes: `buildCircuit` (Task 4), and the Application ops `systems`, `kinds`, `screens`, `placements` and
  `changed`, called as the instance `circuit` like `<c-wires>`' `call`.
- Produces: `<c-circuit>` with these properties:
  - `runtime: Runtime` (the host);
  - `application = 'application'`;
  - `focus: string | null` (a screen id).

  Its state is `{ focus, zoom, panX, panY, sel, lift, hidden: Record<screen, Set<instance>> }`.
  - It rebuilds on `changed`, coalesced per microtask.
  - **The world:** a 3D stage with a tilted page stack. The focus layer is opaque at z 0, and other layers are offset
    in z by their distance from the focus, with opacity `max(0.15, 1 - 0.35·|d|)`.
  - **The side area:** to the right, one labelled block per system.
  - **Pills:** "Whole board", one per screen (with its icon and title), and one per system. Choosing one sets the
    focus (for a screen) and animates pan and zoom to fit it.
  - **Keys:** ArrowLeft/ArrowRight (or PageUp/PageDown) move the focus.
  - Drag pans, and wheel or ctrl+wheel zooms, clamped to 0.3–2.5.
  - A minimap in the corner shows the layers, the side area and the viewport.
  - Pads are 24px buttons styled by the Global Constraints' shapes, colours and glyphs, with labels. Cables are SVG
    paths between pad centres, coloured by type. Only the focus layer's cables draw at full opacity; others draw at
    0.18.
  - With `prefers-reduced-motion`, there are no transitions.
  - **Tabs:** footprints in one tab group draw as one box. The active tab's pads show; inactive tabs show as labels
    along its top edge, and their cables attach to their label's centre.

- [ ] **Step 1: Write the failing tests:**
  - `renders a layer per screen and the focus layer opaque`.
  - `a page pill focuses that page`.
  - `ArrowRight moves the focus to the next page`.
  - `a pad has an accessible label`: `"r1.value, String, out"`.
  - `a change in the Application re-renders`: after `setScreen` adds a page, a new pill appears.
  - `an inactive tab is a label on its group's box`: its cable ends at the label.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Tests and `tsc` pass.
- [ ] **Step 5:** Commit: `feat(circuit): <c-circuit> — a tilted page carousel with pills, pan and zoom`.

### Task 6: Covers and the details drawer

**Files:**
- Create: `packages/circuit/src/render-covers.ts`, `src/render-drawer.ts`
- Modify: `packages/circuit/src/circuit.ts`
- Test: `packages/circuit/test/covers.test.ts`, `drawer.test.ts`

**Interfaces:**
- Consumes: the Task 5 element and state.
- Produces:
  - **Covers:** a title card per footprint, raised by `lift` (0–1, from a Covers slider). A "Lift covers / Put covers
    back" toggle switches between `0.85` and `0`.
    - Dragging a cover more than 160px from where it rests hides it.
    - Delete or Backspace on a selected cover hides it.
    - "Put covers back" clears `hidden` for every page.
    - Hidden covers last for the session only.
  - **The drawer:** selecting a pad, cable, footprint or side item opens a read-only drawer with a kicker, title, sub
    line, type chips, rows (kind, type, routes count, description) and the schema as JSON.
    - "Follow cable" (on a pad or cable) pans to the other end, and focuses its layer if it has one.
    - Escape or ✕ closes it.
    - It's a labelled `aside`.

- [ ] **Step 1: Write the failing tests:**
  - `the slider lifts covers`: the cover transform includes translateZ.
  - `Delete hides the selected cover; Put covers back restores it`.
  - `dragging a cover far enough hides it`.
  - `selecting a pad opens the drawer with its type`.
  - `Follow cable focuses the other end's page`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Tests and `tsc` pass.
- [ ] **Step 5:** Commit: `feat(circuit): lift-off covers and a read-only details drawer`.

### Task 7: The Wiring page in ui-workspace

**Files:**
- Create: `packages/ui-workspace/src/boot-wiring.ts`
- Modify:
  - `public/index.html`: `<app-route path="/wiring" bleed>` holding a view switcher (`Circuit | Connections`) and
    `<c-circuit>`;
  - `src/app/stores.ts`: `HOST_ENTRIES` gains Wiring;
  - `src/composable.ts`: `defineCircuit()`, and the host runtime on `<c-circuit>`;
  - the boot entry (wherever the other `boot-*.ts` are called) calls `bootWiring(document)`;
  - `package.json`: depend on `@composable/circuit`;
  - the tests that pin `HOST_ENTRIES` (`host.test.ts`, `gallery.test.ts`, `app-apply.test.ts`).
- Test: `packages/ui-workspace/test/wiring.test.ts`

**Interfaces:**
- Consumes: `<c-circuit>` (Tasks 5 and 6), and the shell bus `route:changed`.
- Produces: `bootWiring(doc)`.
  - It remembers the last route shown that is a screen (one in the Application's `screens`).
  - On arriving at `/wiring`, it sets `<c-circuit>.focus` to that route, or to `null`, which shows the first page.
  - The switcher's Connections entry links to that route and asks its dock to flip (its `connections()`), and is
    hidden when there is none.

- [ ] **Step 1: Write the failing tests:**
  - `the profile menu lists Wiring after Themes`.
  - `opening Wiring after a workspace focuses that page`.
  - `opening Wiring first focuses the first page and hides Connections`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `tsc` is clean, every package's tests pass, and `cd packages/ui-workspace && bun run build`
  succeeds.
- [ ] **Step 5:** Commit: `feat(ui-workspace): a Wiring page with the Circuit view, in the profile menu`.
