# Application Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pure `@pritzlaff/nano-app` package whose `Application` is the entrypoint to the whole system. It owns the
runtimes, screens and placements, and app-wide tags, and answers queries about them. Hosts implement only layout and
contracts.

**Architecture:** `Tags`, a generic two-way index, goes in core. `nano-app` takes in the platform's pure logic,
registered as the instance `application`, and adds screens (with opaque layouts), placements worked out by a
host-supplied `placementsOf`, tags, queries, the nano.json schema with snapshot and apply, and the contracts (`app`
gateway, `alerts`, `deploy`). `@composable/platform` keeps its Lit views; `ui-workspace` keeps golden-layout, storage and
its contract implementations.

**Tech Stack:** Bun workspaces, TypeScript, typebox, `@pritzlaff/nano-core` and `nano-runes`, Lit (views only),
golden-layout 2.6.0 (`ui-workspace` only), `bun test` with happy-dom.

**Spec:** `docs/superpowers/specs/2026-11-12-application-design.md`

## Global Constraints

- `nano-app` depends on `@pritzlaff/nano-core`, `@pritzlaff/nano-runes` and `typebox` only. No Lit, no DOM types in
  `src/`, no golden-layout, no `nano-elements`.
- Package: `packages/app`, name `@pritzlaff/nano-app`, `"exports": { ".": "./src/index.ts" }`, `"type": "module"`,
  `"version": "0.1.0"`. It is a workspace member through `"workspaces": ["packages/*"]`.
- The instance id is `application`. The component id is `{ ns: 'nano.app', name: 'application' }`, and the op namespace
  is `'nano.app/application'`. There is no `platform` alias.
- References: `system:<id>`, `instance:<system>/<id>`, `screen:<path>`. Ids match `/^[a-z0-9][a-z0-9-]*$/` and paths
  match the existing `PATH` (`/^\/[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/`).
- Tags are plain strings: trimmed and non-empty, at most 64 characters, with no further parsing.
- User tags live only in the Application. Registry labels (`nano/deploy`, `nano/allow`, `nano/deny`) stay on the
  registry.
- Reserved ids: `application`, `app`, `alerts`, `registry`, `profile`, `ws-controls-*`, `ex-*` (these replace
  `platform` in `RESERVED` and `HOST_DRIVEN`).
- nano.json stays version `1`. `tags` is optional: `Record<ref, string[]>`, at most 500 refs and at most 20 tags each.
- Behaviour the user sees doesn't change. Every task ends with `bunx tsc --noEmit` clean at the root and
  `bun test --isolate` green in every package it touched.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Saved workspaces from before this change, in `workspace-starter.saved-workspaces` and their layout keys, still open
   after it. The storage format is unchanged (Task 5 test).
2. An instance removed by any route (an element going, `removeFromSystem`) disappears from `query` and loses its tags,
   and a stale placement never returns a missing instance (Task 6 test).
3. A nano.json `tags` entry with a malformed ref, or a ref to something missing, is dropped with a note and never throws
   (Task 7 test).
4. Tagging twice is a no-op, and removing an item's last tag removes it from `tagged()`, with no empty sets left behind
   (Task 1 test).
5. `query({})` with no filters returns every instance in every system, and the filters AND together (Task 6 test).

## File Structure

- `packages/core/src/tags.ts`, plus its export in `index.ts`: `Tags`.
- `packages/app/` (new): `src/refs.ts` (references), `src/catalog.ts` (structural catalog type),
  `src/application.ts` (component, ops, systems, screens, tags, queries), `src/create.ts` (`createApplication`),
  `src/gateway.ts` (AppGateway, moved), `src/alerts.ts` (alerts contract), `src/document.ts` (nano.json schema,
  moved), `src/snapshot.ts` and `src/apply.ts` (moved), `src/index.ts`.
- `packages/platform/src/`: `platform.ts` shrinks to a re-export shim from nano-app (removed in Task 9); `view.ts`,
  `table.ts` and `inventory.ts` stay.
- `packages/ui-workspace/src/lib/dock-layout.ts`: gains `placementsOf`.
- `packages/ui-workspace/src/lib/screens.ts` (new): persists the Application's screens in the existing storage keys.

---

### Task 1: Tags in core

**Files:**
- Create: `packages/core/src/tags.ts`
- Modify: `packages/core/src/index.ts` (add `export * from './tags'`)
- Test: `packages/core/test/tags.test.ts`

**Interfaces:**
- Produces: `Tags.create<T extends string = string>(): Tags<T>`, where
  ```ts
  type TagChange<T> = { item: T; tag: string; added: boolean }
  type Tags<T extends string = string> = {
    tag(item: T, tag: string): boolean      // false if already there
    untag(item: T, tag: string): boolean    // false if not there
    tagged(tag: string): ReadonlySet<T>     // a copy; empty for unknown
    tagsOf(item: T): ReadonlySet<string>    // a copy; empty for unknown
    remove(item: T): void                   // untags everything on it (one change per tag)
    all(): ReadonlyMap<T, ReadonlySet<string>>   // item → tags, for saving
    listen(fn: (c: TagChange<T>) => void): () => void
  }
  ```

- [ ] **Step 1: Write the failing tests** in `tags.test.ts`:
  - `tag then tagged and tagsOf answer both ways`: tag `a` with `x` and `y`, and `b` with `x`. Then
    `[...tagged('x')].sort()` equals `['a','b']` and `[...tagsOf('a')].sort()` equals `['x','y']`.
  - `tagging twice is a no-op`: the second `tag('a','x')` returns `false`, and the listener was called once.
  - `the last untag leaves nothing behind`: after `untag('a','x')`, `tagged('x').size` is `0`, `all().has('a')` is
    `false`, and `untag` again returns `false`.
  - `remove forgets an item`: an item with two tags gives two changes with `added: false`, and both indexes are empty
    afterwards.
  - `tags are trimmed, non-empty and at most 64 characters`: `tag('a','  x ')` stores `x`; `tag('a','')` and a
    65-character tag throw `Error` with a message naming the tag rule.
  - `the sets it returns are copies`: mutating the returned set (cast) doesn't change `tagged('x')`.
- [ ] **Step 2:** Run `cd packages/core && bun test test/tags.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3:** Implement `packages/core/src/tags.ts` with two maps, `byTag: Map<string, Set<T>>` and
  `byItem: Map<T, Set<string>>`. Delete a key when its set becomes empty.
- [ ] **Step 4:** Run `bun test` in `packages/core`. Expected: all pass.
- [ ] **Step 5:** Commit: `feat(core): Tags — a two-way index between plain-string tags and items`.

### Task 2: The nano-app package, references and catalog type

**Files:**
- Create: `packages/app/package.json`, `packages/app/tsconfig.json` (copy `packages/runes/tsconfig.json`),
  `packages/app/src/index.ts`, `src/refs.ts`, `src/catalog.ts`
- Test: `packages/app/test/refs.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type Ref = `system:${string}` | `instance:${string}/${string}` | `screen:${string}`
  type Parsed = { kind: 'system'; id: string } | { kind: 'instance'; system: string; id: string } | { kind: 'screen'; path: string }
  const ref: { system(id: string): Ref; instance(system: string, id: string): Ref; screen(path: string): Ref }   // throw on a bad id or path
  function parseRef(s: string): Parsed | null                                   // null, never throws
  type CatalogEntry = { component: Component; title?: string; tag?: string; modes?: readonly string[] }
  type AppCatalog = Record<string, CatalogEntry>
  ```
  `Component` comes from core. `nano-elements`' `Catalog` must be assignable to `AppCatalog`.

- [ ] **Step 1: Write the failing tests:**
  - `refs round-trip`: `parseRef(ref.instance('lab','r1'))` equals `{ kind:'instance', system:'lab', id:'r1' }`, and
    likewise for `system:lab` and `screen:/lab/one`.
  - `malformed refs parse to null`: `'x'`, `'instance:lab'`, `'instance:Lab/r1'`, `'screen:lab'`, `'system:'` and
    `'screen:/'` all give `null`.
  - `building a bad ref throws`: `ref.system('Bad')` and `ref.screen('lab')` throw.
- [ ] **Step 2:** Run `cd packages/app && bun test`. Expected: FAIL.
- [ ] **Step 3:** Implement. `package.json` per the Global Constraints, with dependencies `@pritzlaff/nano-core:
  workspace:*`, `@pritzlaff/nano-runes: workspace:*` and `typebox: ^1.4.0`. Run `bun install` at the root.
- [ ] **Step 4:** `bun test` in `packages/app` passes, and `bunx tsc --noEmit` is clean at the root.
- [ ] **Step 5:** Commit: `feat(app): @pritzlaff/nano-app — typed refs and a structural catalog type`.

### Task 3: The Application owns the systems (the platform moves in)

**Files:**
- Create: `packages/app/src/application.ts`; move `packages/platform/test/platform.test.ts` to
  `packages/app/test/application.test.ts`
- Modify: `packages/platform/src/platform.ts` (becomes `export { … } from '@pritzlaff/nano-app'` with the old names:
  `PlatformOps = ApplicationOps`, `platform = application`, plus `runtimeOf`, `Kind`, `Selection`, `KindSchema` and
  `SelectionSchema`); `packages/platform/package.json` (adds the nano-app dependency); `view.ts` and `table.ts` (the
  default `model` becomes `'application'`); `packages/wires/src/wires.ts` (`this.platform = 'application'`);
  `packages/ui-workspace/src/composable.ts` and `test/fixtures/app-host.ts` (register as `'application'`); every test
  and source file that names the instance `'platform'` or the key prefix `composable/platform/` (find them with
  `grep -rn "'platform'\|composable/platform/" packages --include=*.ts`); `packages/shell/src/app.ts` `RESERVED` and
  `packages/ui-workspace/src/app/snapshot.ts` `HOST_DRIVEN` (`platform` becomes `application`, and `alerts` is added).
- Test: `packages/app/test/application.test.ts`

**Interfaces:**
- Consumes: `AppCatalog` (Task 2).
- Produces:
  - `ApplicationOps`: every op `PlatformOps` has today, same names and schemas, in namespace `'nano.app/application'`.
  - `application(host: Runtime, catalog: AppCatalog, opts: { gateways?; locked?; deploy? }): Component<State>`, with
    today's platform options.
  - `runtimeOf(registry, system, id = 'application')`.
  - `Kind`, `Selection`, `KindSchema`, `SelectionSchema`.

- [ ] **Step 1:** Move the platform tests into `application.test.ts`, change `'platform'` to `'application'` and the
  imports to `../src/application`, and add `the application is registered as application, with no platform alias`:
  after registering, `host.registry.get('platform')` is `undefined` and every `ApplicationOps` key starts with
  `nano.app/application/`.
- [ ] **Step 2:** Run `cd packages/app && bun test`. Expected: FAIL.
- [ ] **Step 3:** Move the logic from `platform.ts` into `application.ts` as it is: same state, `share` and
  `snapshots`; component id `{ ns:'nano.app', name:'application' }`; description "The application: its systems, …". Turn
  `platform.ts` into the re-export shim and update every reference listed under Files.
- [ ] **Step 4:** Run `bunx tsc --noEmit` at the root, then `bun test --isolate` in app, platform, wires, shell and
  ui-workspace. Expected: all pass.
- [ ] **Step 5:** Commit: `refactor: the platform's systems move into nano-app as the Application (instance application)`.

### Task 4: Screens and placements in the Application

**Files:**
- Modify: `packages/app/src/application.ts`, `packages/app/src/index.ts`
- Modify: `packages/ui-workspace/src/lib/dock-layout.ts` (adds `placementsOf`)
- Test: `packages/app/test/screens.test.ts`, `packages/ui-workspace/test/dock-layout.test.ts` (add tests to the existing
  file, or create it if missing)

**Interfaces:**
- Produces:
  ```ts
  type Screen = { id: string; title: string; icon?: string; system: string; layout: unknown }   // id: a route path
  type Placement = { screen: string; panel: string; instance: string }
  // option: placementsOf?: (layout: unknown) => { panel: string; instance: string }[]   (default () => [])
  ```
  New ops:
  - `screens` (a source, `Screen[]` in insertion order)
  - `setScreen(Screen)`: adds or replaces in place, keeping order. It refuses a bad path, an unknown system or an empty
    title.
  - `removeScreen(id)`
  - `moveScreen({ id, by: -1 | 1 })`: keeps the nav order
  - `placements({ screen? })`: returns `Placement[]`
  - `changed`: a source, `{ what: 'systems' | 'screens' | 'tags'; ref?: string }`
- `ui-workspace`: `placementsOf(layout: unknown): { panel: string; instance: string }[]`. It walks golden-layout's saved
  config (`root` and `content`), reads each component's `componentState` with `readWidgetName` / `readWidgetId`, and
  skips panels that have no instance name. `panel` is the component's `id` if set, else its `title` and index path.

- [ ] **Step 1: Write the failing tests** in `screens.test.ts`, using a fake `placementsOf` that returns
  `(layout as any).p`:
  - `setScreen stores a screen and works out its placements`: after `setScreen({ id:'/lab', title:'Lab',
    system:'host', layout:{ p:[{panel:'a',instance:'r1'}] } })`, `placements({screen:'/lab'})` equals
    `[{ screen:'/lab', panel:'a', instance:'r1' }]`.
  - `a new layout replaces the placements`.
  - `refused: a bad path, an unknown system, an empty title`: each `setScreen` call returns an error.
  - `removeScreen drops its placements`.
  - `moveScreen reorders, and refuses at an end`.
  - `changed fires with what: 'screens'`.

  And in `dock-layout.test.ts`:
  - `placementsOf reads named panels from a saved layout`: a two-panel row (one with a `name`, one without) gives one
    entry.
  - `placementsOf of null or junk is []`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. Placements are kept per screen and recomputed in `setScreen`.
- [ ] **Step 4:** Tests and `tsc` pass.
- [ ] **Step 5:** Commit: `feat(app): screens with opaque layouts, and placements from a host-supplied placementsOf`.

### Task 5: ui-workspace keeps its screens in the Application

**Files:**
- Create: `packages/ui-workspace/src/lib/screens.ts`
- Modify: `src/composable.ts` (passes `placementsOf`); `src/boot-saved-workspaces.ts` and
  `src/components/saved-workspaces.ts` (mount from the Application's `screens`, and save through `setScreen` and
  `moveScreen`); `src/components/workspace-dock.ts` (`save()` also calls `setScreen` with the new layout for its route,
  when it has one); `src/app/stores.ts` and `src/app/snapshot.ts` (no `workspaces` or `layouts` stores: the
  Application's screens are the source)
- Test: `packages/ui-workspace/test/screens.test.ts`; update `saved-workspaces.test.ts` and `app-snapshot.test.ts`

**Interfaces:**
- Consumes: the screen ops (Task 4).
- Produces: `persistScreens(app: { call }, storage: Storage, mainPath = '/workspace'): Promise<() => void>`.
  - At start it reads `workspace-starter.saved-workspaces` and each layout key (`keyFor`), and calls `setScreen` for the
    main workspace first, then each saved one.
  - From then on it writes both back on every `changed { what:'screens' }`.
  - The storage keys and formats are unchanged. The main workspace's layout stays under its dock's `storage-key`, and
    the main workspace is never written into the saved list.

- [ ] **Step 1: Write the failing tests:**
  - `screens from before this change still load`: seed localStorage with today's format (two saved workspaces and one
    layout). After `persistScreens`, `screens` holds `/workspace`, then the two saved ones in order, with their
    layouts.
  - `a change to a screen is written back in the old format`.
  - `the main workspace is a screen but never in the saved list`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement, and move the existing callers onto the Application.
- [ ] **Step 4:** All `ui-workspace` tests and `tsc` pass. Saved-workspace behaviour is unchanged (nav order, Alt+arrow,
  `+`).
- [ ] **Step 5:** Commit: `feat(ui-workspace): screens live in the Application; storage format unchanged`.

### Task 6: Tags and queries on the Application

**Files:**
- Modify: `packages/app/src/application.ts`
- Test: `packages/app/test/query.test.ts`

**Interfaces:**
- Consumes: `Tags` (Task 1), `ref` and `parseRef` (Task 2), screens (Task 4).
- Produces these ops:
  - `tag({ ref, tag })` and `untag({ ref, tag })`: refuse a malformed ref, or one naming a missing system, instance or
    screen.
  - `tagsOf(ref)`: returns `string[]`, sorted.
  - `tagged(tag)`: returns `Ref[]`, sorted.
  - `allTags()`: returns `Record<Ref, string[]>`, for saving.
  - `query({ screen?, system?, kind?, tag? })`: returns `Ref[]` (instance refs, sorted).
  - `screensOf(instanceRef)`: returns `string[]`.

  Every tag change fires `changed { what:'tags', ref }`.

- [ ] **Step 1: Write the failing tests** (two systems, `host` and `lab`; instances `r1` (range) in host, `l1` (log) in
  lab; a screen `/lab` on system `lab` placing `l1`):
  - `query with no filters is every instance in every system` (it includes the application itself and the gateways,
    exactly as they appear in the snapshots).
  - `filters AND together`: `{ system:'lab', kind:'log' }` gives `['instance:lab/l1']`; `{ screen:'/lab', kind:'range' }`
    gives `[]`.
  - `tag and query by tag`: tagging `instance:host/r1` with `billing` makes `query({ tag:'billing' })` give
    `['instance:host/r1']`, and `tagsOf` give `['billing']`.
  - `screens and systems can be tagged too`: `tagged('team')` lists `screen:/lab` and `system:lab`.
  - `an instance removed by any route loses its tags and leaves queries`: remove `r1` directly with
    `registry.remove('r1')` (not through an op). Then `tagged('billing')` is `[]` and `query({})` doesn't list it.
  - `a placement whose instance is gone is not returned`: `/lab` places `ghost`; `query({ screen:'/lab' })` doesn't list
    it, and `screensOf('instance:lab/ghost')` is `[]`.
  - `removing a screen removes its tags`.
  - `bad refs are refused`: `tag({ ref:'nope', tag:'x' })` and a ref to a missing instance both return errors.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. The state holds a `Tags<Ref>`. The registry listener that already exists (`watch`) also
  calls `tags.remove` on `instance-removed`. `query` fans out over the systems' snapshots, then filters.
- [ ] **Step 4:** Tests and `tsc` pass.
- [ ] **Step 5:** Commit: `feat(app): app-wide tags on systems, instances and screens; query, tagged, screensOf`.

### Task 7: nano.json moves into nano-app, with tags and the main workspace

**Files:**
- Create: `packages/app/src/document.ts` (from `packages/shell/src/app.ts`), `packages/app/src/snapshot.ts` and
  `src/apply.ts` (from `ui-workspace/src/app/`)
- Modify: `packages/shell/src/app.ts` (removed; shell's index re-exports from nano-app until Task 9); `ui-workspace`
  callers (`boot.ts`, `file.ts`, `boot-file.ts`) import from nano-app; move the tests
  (`shell/test/app.test.ts` becomes `app/test/document.test.ts`; `ui-workspace/test/app-snapshot.test.ts` and
  `app-apply.test.ts` move to `app/test/`, keeping a thin host-specific test in `ui-workspace` if they use the DOM)
- Test: `packages/app/test/document.test.ts`, `snapshot.test.ts`, `apply.test.ts`

**Interfaces:**
- Produces:
  - `NanoAppSchema`, `checkApp`, `canonicalApp`, `RESERVED` and `MAX_BYTES`, as today.
  - The schema gains `tags: Type.Optional(Type.Record(<ref string, max 300>, list(<tag>, 20), { maxProperties: 500 }))`.
  - `workspaces` now includes `/workspace`.
  - `snapshotApp(app: AppHandle, stores: HostStores): Promise<NanoApp>` and
    `applyApp(doc, how, deps): Promise<string[]>`, where `HostStores` is today's `Stores` without `workspaces` and
    `layouts`. Screens are read and written through the Application.
  - `canonicalApp` sorts `tags` keys and values.

- [ ] **Step 1: Write the failing tests** (beyond the moved ones):
  - `a snapshot saves tags and the main workspace`.
  - `apply restores tags after instances and screens exist`: tags on an instance created by the same document come
    back.
  - `a tag on a malformed or missing ref is dropped with a note`: `applyApp` returns a note naming the ref and doesn't
    throw.
  - `a document without tags or a main workspace still opens`.
  - `checkApp refuses 21 tags on one ref`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Move the code and implement the additions. A screen's layout in the document is its `layout`, as
  before.
- [ ] **Step 4:** `tsc` and tests pass in app, shell and ui-workspace. The File menu round-trip tests still pass.
- [ ] **Step 5:** Commit: `feat(app): nano.json in nano-app; tags and the main workspace are saved`.

### Task 8: Contracts and createApplication

**Files:**
- Create: `packages/app/src/gateway.ts` (move `shell/src/app-gateway.ts` and its test), `src/alerts.ts`, `src/create.ts`
- Modify: `packages/shell/src/index.ts` (re-exports `AppGateway` from nano-app until Task 9);
  `packages/ui-workspace/src/composable.ts` (shrinks to `createApplication` plus the worked example and host glue); a
  `ui-workspace` alerts implementation that shows the message in the status line through the bus topic `dock:status`
- Test: `packages/app/test/create.test.ts`, `packages/app/test/alerts.test.ts`

**Interfaces:**
- Produces:
  - `Alerts`: a runes component interface, id `nano.app/alerts`, with one action
    `show({ message: string (≤ 500), tone?: 'info' | 'success' | 'warning' | 'error' })`. It also exports `AlertsOps`
    for callers. The host registers its implementation as `alerts`.
  - `createApplication(opts: { catalogs: AppCatalog[]; deploy?: DeployFn; placementsOf?: PlacementsOf; gateways?:
    readonly string[]; locked?: (id: string) => boolean; registryId?: string }): { host: Runtime; catalog: AppCatalog }`.
    - It creates the host runtime (`registryId`, default `'host'`) and registers `app` (the AppGateway), then
      `application` (with `gateways` defaulting to `['app']`).
    - It merges the catalogs into one object that later imports grow.
    - `deploy` defaults to a host-only deploy that instantiates the kind's component.

- [ ] **Step 1: Write the failing tests:**
  - `createApplication registers app and application in host`.
  - `the default deploy makes a component in its system`.
  - `a missing alerts contract is a clear error`: calling `alerts.show` without one registered returns the runtime's
    "no instance" error and doesn't throw.
  - `a registered alerts contract receives show`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement, and rewrite `composable.ts` on top of it. Its exported `host` and `catalog` keep their
  names, so the importers don't change.
- [ ] **Step 4:** `tsc` and all package tests pass, and `make ui` builds.
- [ ] **Step 5:** Commit: `feat(app): createApplication, the app-bar gateway and alerts contracts; composable.ts shrinks`.

### Task 9: Tidy the packages

**Files:**
- Modify: `packages/platform/src/platform.ts` (removed: views import from nano-app); `packages/platform/src/index.ts`;
  `packages/platform/package.json` description ("Lit views of the Application: the systems tree and the inventory
  table"); `packages/shell/src/index.ts` (drop the re-exports; importers use nano-app); `packages/shell/package.json`
  description ("The host UI kit: reusable Lit pieces any host can use — profile and File menus"); every importer of the
  removed re-exports
- Modify: `packages/app/README.md` (new): what the Application owns, `createApplication`, the contracts a host
  implements, and the reference format

- [ ] **Step 1:** Remove the shims and fix the imports.
- [ ] **Step 2:** `bunx tsc --noEmit` is clean, all packages' tests pass, and `make ui` builds.
- [ ] **Step 3:** Commit: `refactor: platform keeps its views, shell is the host UI kit; nano-app README`.
