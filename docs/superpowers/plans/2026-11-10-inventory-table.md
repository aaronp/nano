# Inventory Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Snapshots record each instance's component and owner; a `<c-platform-table>` lists every instance in a filterable, sortable, column-resizable table.

**Architecture:**
- Core's registry stores an optional owner for each entry and reports `component` and `owner` in snapshots and `instance-added` deltas.
- Every creator passes its owner.
- The platform gains a `kinds` source op, plus a `catalogChanged` action that the host calls after an import.
- A pure `inventory()` builds the table's rows and `matches()` filters them. `<c-platform-table>` is a thin `ModelElement` over them on the kit's `<nano-data-table>`, which gains column resizing.

**Tech Stack:** Bun workspace, TypeScript, Lit, typebox, `bun test --isolate` with happy-dom.

**Spec:** `docs/superpowers/specs/2026-11-10-inventory-table-design.md`

## Global Constraints

- Work on branch `dev`. Never commit `kerits/`, `puzzles/`, `wires/`, `debounce/`, `adr/`, `starters/`, `topology-explorer.html` or `scripts/build-package.ts`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Styles use `--nano-*` tokens with fallbacks (the `t()` helper in elements; `var(--nano-x, fallback)` elsewhere), and must work in light and dark.
- Per-package tests: `cd packages/<p> && bun test --isolate`. Types: `bunx tsc --noEmit -p packages/<p>` where a tsconfig exists.
- Owner kinds are exactly `'platform' | 'widget' | 'view' | 'editor' | 'app'`. An absent owner renders as `unknown`.
- `component` string = `` `${inst.component.id.ns}/${inst.component.id.name}` ``.
- Pills' accessible name for clearing: `Remove filter <label>`.

## Review Focus

1. An instance shared between two registries with different owners: each snapshot shows its own owner (Task 1 test).
2. Removing an id and re-adding it with a different owner: the snapshot shows the new owner, and nothing stale is left (Task 1 test).
3. Kinds imported after the table has rendered appear without a reload (Task 3 test).
4. The Unregistered pill combined with system and component pills follows the spec's OR-within-group, AND-across-groups rule (Task 5 tests).
5. Dragging or keying a column below its minimum width clamps it at the minimum (Task 4 test).

---

### Task 1: Core records component and owner

**Files:**
- Modify: `packages/core/src/data.ts` (Delta), `packages/core/src/registry.ts`, `packages/core/src/index.ts` (export `Owner` if not re-exported via `*`)
- Test: `packages/core/test/registry.test.ts`

**Interfaces:**
- Produces:
  - `export type Owner = { kind: string; name: string }` (in `registry.ts`);
  - `Registry.add(id: string, inst: Instance, owner?: Owner): Result<void>`;
  - `Snapshot = { id; instances: { id: string; component: string; owner?: Owner; ops: Op[] }[]; subscriptions }`;
  - Delta `instance-added` = `{ type: 'instance-added'; instance; ops; component: string; owner?: Owner }`. `instance-removed` is unchanged.

- [ ] **Step 1: Write the failing tests** (in `registry.test.ts`, reusing `thing()` / `watched()`):
  - `'a snapshot names each instance's component and owner'`: `r.add('a', thing(), { kind: 'widget', name: 'c-x' })`; `r.add('b', thing())`. Expect `r.snapshot().instances` to equal `[{ id: 'a', component: 't/thing', owner: { kind: 'widget', name: 'c-x' }, ops: [Ping] }, { id: 'b', component: 't/thing', ops: [Ping] }]` (`toEqual`, so a missing owner is `undefined`).
  - `'instance-added carries component and owner'`: the first `seen` delta `toEqual` `{ type: 'instance-added', instance: 'a', ops: ['t/ping'], component: 't/thing', owner: { kind: 'platform', name: 'p' } }`.
  - `'owner belongs to the entry: shared instances and re-adds'`: one `inst` added to registries `r1` (`widget`) and `r2` (`platform`), and each snapshot shows its own owner. Then `r1.remove('a')` and `r1.add('a', inst, { kind: 'view', name: 'v' })` gives owner `view`.
- [ ] **Step 2: Run** `cd packages/core && bun test --isolate test/registry.test.ts`. Expected: the 3 new tests FAIL (no `component` or `owner`).
- [ ] **Step 3: Implement.** Keep `owners = new Map<string, Owner>()` beside `instances`. Set it in `add` (only when `owner` is given), delete it in `remove`, and read it in `snapshot` and the `instance-added` emit. Add `component` from `inst.component.id`.
- [ ] **Step 4: Run** the core suite, then `bunx tsc --noEmit -p packages/core`. Expected: all pass. Run every other package's tests too, because snapshot consumers (wires, platform) must still pass.
- [ ] **Step 5: Commit** `feat(core): snapshots and instance-added name each instance's component and owner; add takes an optional owner, kept per registry entry`.

### Task 2: Every creator passes its owner

**Files:**
- Modify: `packages/elements/src/placed-element.ts:29`, `packages/elements/src/model-element.ts:51`, `packages/platform/src/platform.ts` (`createComponent`, `addToSystem`), `packages/editor/src/editor.ts:19`, `packages/ui-workspace/src/composable.ts:26`
- Test: `packages/elements/test/placed-element.test.ts`, `packages/elements/test/model-element.test.ts`, `packages/platform/test/platform.test.ts`, `packages/editor/test/editor.test.ts`

**Interfaces:**
- Consumes: `Owner` and `add(id, inst, owner?)` from Task 1.
- Produces these owner values:
  - PlacedElement: `{ kind: 'widget', name: this.localName }`;
  - ModelElement view: `{ kind: 'view', name: this.localName }`;
  - platform: `{ kind: 'platform', name: <own id> }`, where own id = `s.env.handles().find(h => h.coord.registry === host.registry.id)?.coord.instance ?? 'platform'`;
  - editor: `{ kind: 'editor', name: prefix }`;
  - composable: `{ kind: 'app', name: 'ui-workspace' }`.

- [ ] **Step 1: Write the failing tests**, one per creator. Each finds its entry in `registry.snapshot().instances` and asserts the `owner` `toEqual`s the value above:
  - a placed element's instance;
  - the `~view-N` entry a ModelElement adds;
  - `createComponent` in a platform test (owner name `'platform'`, matching the id the test registers it under);
  - `addToSystem` (the target system's entry has the platform owner);
  - `addEditor(registry, 'ed')` entries (owner `{ kind: 'editor', name: 'ed' }`).
- [ ] **Step 2: Run** each package's suite. Expected: the new tests FAIL with owner `undefined`.
- [ ] **Step 3: Implement** by passing the owner at each `add` call listed above.
- [ ] **Step 4: Run** the elements, platform, editor and ui-workspace suites, plus tsc. Expected: all pass.
- [ ] **Step 5: Commit** `feat: widgets, views, the platform, the editor and the app record themselves as owners of what they add`.

### Task 3: The platform lists kinds, and hears about imports

**Files:**
- Modify: `packages/platform/src/platform.ts`, `packages/ui-workspace/src/composable.ts` (`addCatalog`)
- Test: `packages/platform/test/platform.test.ts`, `packages/ui-workspace/test/` (the existing import or composable test file that exercises `addCatalog`)

**Interfaces:**
- Produces:
  - `export type Kind = { kind: string; component: string; title: string; tag?: string }`;
  - `PlatformOps.kinds = Ops.source(NS, 'kinds', Type.Array(any))`, which returns `Kind[]` from the catalog object it holds, read at call time;
  - `PlatformOps.catalogChanged = Ops.action(NS, 'catalog-changed', any, any)`, which notifies `kinds` (with the fresh list) and `catalog`;
  - `addCatalog` calls it via `host.call({ registry: 'host', instance: 'workspace' }, 'platform', Ops.key(P.catalogChanged), null)`.

- [ ] **Step 1: Write the failing tests:**
  - `'kinds lists each catalog kind with its component id, title and tag'` over the bundle catalog. Includes `{ kind: 'range', component: <Range component ns/name>, title: …, tag: … }`.
  - `'after catalog-changed, a kind added to the catalog object is published in kinds'`: subscribe a sink to `kinds`, mutate the catalog object, call `catalogChanged`, and the sink receives the new kind.
  - ui-workspace: after `addCatalog({ k: entry }, from)`, `host.call(... P.kinds)` includes `k`.
- [ ] **Step 2: Run** the platform suite. Expected: FAIL (no `kinds` op).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the platform and ui-workspace suites. Expected: all pass.
- [ ] **Step 5: Commit** `feat(platform): a kinds op (kind, component id, title, tag), republished when the host imports a package`.

### Task 4: `<nano-data-table>` columns resize

**Files:**
- Modify: `packages/elements/src/kit/data-table.ts`
- Test: `packages/elements/test/data-table.test.ts`

**Interfaces:**
- Produces:
  - `Column` gains `width?: number` (the initial px) and `minWidth?: number` (default 60);
  - widths live in state `widths: Record<string, number>`;
  - every `th` carries `.resize[role=separator][aria-orientation=vertical][tabindex=0][aria-label="Resize <label>"]` with `aria-valuenow` = the current width;
  - the table uses `table-layout: fixed` with a `<colgroup>` once any width is known.

- [ ] **Step 1: Write the failing tests:**
  - `'a column resizes from its handle with the keyboard'`: focus `th[data-key="name"] .resize`, dispatch `keydown` `ArrowRight` and settle. The `aria-valuenow` grows by 10. `ArrowLeft` shrinks it by 10.
  - `'a column resizes by dragging its handle'`: `pointerdown` at clientX 100, `pointermove` at 150 on window, `pointerup`. The width grows by 50.
  - `'a column never shrinks below its minimum'`: `minWidth: 80`, starting `width: 90`. Two `ArrowLeft`s leave `aria-valuenow` at `'80'`.
  - `'sorting still works with handles present'`: the existing sort assertions pass. Clicking the handle does not sort.
- [ ] **Step 2: Run** `cd packages/elements && bun test --isolate test/data-table.test.ts`. Expected: the new tests FAIL (no `.resize`).
- [ ] **Step 3: Implement.** Before a column's first drag, its width is the measured `th.offsetWidth` (fallback `width ?? 120` when measuring returns 0, as in happy-dom). Step 10px on each key. The handle stops click propagation.
- [ ] **Step 4: Run** the elements suite, including `widgets-use-tokens`. Expected: all pass.
- [ ] **Step 5: Commit** `feat(elements): <nano-data-table> columns resize by drag or keyboard, never below a minimum`.

### Task 5: `inventory()` and `matches()`

**Files:**
- Create: `packages/platform/src/inventory.ts`
- Modify: `packages/platform/src/index.ts` (export it)
- Test: `packages/platform/test/inventory.test.ts`

**Interfaces:**
- Consumes: `Snapshot` (Task 1) and `Kind` (Task 3).
- Produces:
  - `export type Row = { system: string; component: string; instance: string; name: string; owner: string }`.
    - `component` = the kinds whose component id equals the instance's, joined with `', '`, or `'—'` if there are none.
    - `owner` = `` `${kind} · ${name}` ``, or `'unknown'`.
    - For a never-instantiated kind's row: `system: '—'`, `instance: '—'`, `name` = its component id, `owner: '—'`.
  - `export const UNREGISTERED = 'Unregistered'`.
  - `export function inventory(systems: Snapshot[], kinds: Kind[]): Row[]`: rows in system order, then instance order. Never-instantiated kinds come last, one per kind.
  - `export type Filters = { systems: string[]; components: string[] }`.
  - `export function matches(row: Row, q: string, f: Filters): boolean`:
    - `q` is case-insensitive and matches any field;
    - systems: empty means pass; otherwise the row's system is among them, or the row is unregistered and `UNREGISTERED` is among them;
    - components: empty means pass; otherwise any of the row's kinds is among them;
    - the two groups AND together.

- [ ] **Step 1: Write the failing tests** with fixture snapshots:
  - Systems: `host` with `r` (component `composable/range`, owner widget c-range), `p` (`composable/platform`, owner app) and `p~view-0` (view); `lab` with `r` (owner platform).
  - Kinds: `range` → `composable/range`, `log` → `composable/log`.
  - Tests:
    - `'one row per system and instance; a shared instance appears in each with its own owner'`;
    - `'an instance whose component is no kind shows —'` (p);
    - `'a kind with no instance gets one — row'` (log: `{ system: '—', component: 'log', instance: '—', name: 'composable/log', owner: '—' }`);
    - `'kinds sharing a component id are listed together'` (add `slider` → `composable/range`, and `r` rows show `'range, slider'`);
    - `'filters: OR within a group, AND across'`, a table of cases:
      - `{systems:['host']}` keeps the host rows only;
      - `{systems:['host', UNREGISTERED]}` adds the log row;
      - `{components:['log']}` keeps only the log row;
      - `{systems:['lab'], components:['range']}` keeps only lab/r;
      - `{systems:['lab'], components:['log']}` gives none;
    - `'free text matches any column, case-insensitively'` (`'WIDGET'` finds host/r).
- [ ] **Step 2: Run** `cd packages/platform && bun test --isolate test/inventory.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(platform): inventory() — a row per system and instance, plus never-made kinds; matches() for text and pill filters`.

### Task 6: `<c-platform-table>`, in the app

**Files:**
- Create: `packages/platform/src/table.ts`
- Modify:
  - `packages/platform/src/index.ts`;
  - `packages/ui-workspace/src/composable.ts` (define it next to `definePlatform()`; find the call);
  - `packages/ui-workspace/public/index.html` (a dock template `<template data-widget="c-platform-table" data-title="Instances"><c-platform-table></c-platform-table></template>` after line 98, and a second `<section class="panel"><c-platform-table></c-platform-table></section>` on the Systems page after line 113);
  - READMEs: `packages/platform` if present, the `ui-workspace` README's Systems line, and the elements README's data-table row (resizing).
- Test: `packages/platform/test/table.test.ts`

**Interfaces:**
- Consumes: `inventory`, `matches`, `Filters`, `UNREGISTERED` (Task 5); `P.kinds`, `P.systems`, `P.select` (Task 3 and existing); `<nano-data-table>` (Task 4).
- Produces: `export class PlatformTableEl extends ModelElement` and `export const definePlatformTable = () => …`, which defines `c-platform-table` once. Defaults: `registry ??= providedRegistry(...)`, `model ??= 'platform'`.

DOM contract (tests rely on it, all in the shadow root):
- `input[name=q]` (type=search, the free text);
- `button.filters[aria-expanded]` with `span.badge` (the active count; hidden when 0);
- `button.clear` (shown when the count is above 0);
- `.picks` holds a pill per active filter: `button[aria-label="Remove filter <x>"]`;
- `.options` (shown when expanded) holds `button[data-system=<id>][aria-pressed]` for each system plus `Unregistered`, and `button[data-component=<kind>][aria-pressed]` for each kind;
- a `<nano-data-table>` with columns System, Component, Instance, Name, Owner (keys as in `Row`), all sortable, and rows = `inventory(...).filter(r => matches(r, q, filters))`;
- the Instance cell renders `button[data-select="<system>/<instance>"]` (plain text for `—`), which calls `this.act(P.select, { system, instance })`.

- [ ] **Step 1: Write the failing tests** (mount like `view.test.ts`: host, platform, range r and log l in host, system lab):
  - `'lists every instance, including views, with owners'`: the table's rows include host/r with owner `platform · platform`, and some `~view` row with owner `view · c-platform-table`;
  - `'Filters expands, picks a system, and counts it'`: click `.filters`, then `[data-system="lab"]`. The badge is 1, a `Remove filter lab` pill exists, and the rows all have system lab;
  - `'a pill's ✕ and Clear remove filters'`;
  - `'clicking an instance selects it'`: click `[data-select="host/r"]`, and `P.selected` equals `{ system: 'host', instance: 'r' }`;
  - `'a component created elsewhere appears'`: `call(P.createComponent, …)`, then settle, and a row exists.
- [ ] **Step 2: Run** `cd packages/platform && bun test --isolate test/table.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `table.ts`, then wire it into the app, then update the READMEs.
- [ ] **Step 4: Run** every package's suite (`core runes elements bundle platform editor wires ui-workspace`), `make packages`, and `cd packages/ui-workspace && bun run build`. Expected: all pass, and both builds exit 0.
- [ ] **Step 5: Bump** `packages/core`, `runes` and `elements` `package.json` to `0.3.0`, and run `bun install` to update `bun.lock`.
- [ ] **Step 6: Commit** `feat(platform,ui-workspace): <c-platform-table> — every instance by system, component, name and owner; text and pill filters with a count and Clear; in the dock and on the Systems page. nano-* 0.3.0`.
