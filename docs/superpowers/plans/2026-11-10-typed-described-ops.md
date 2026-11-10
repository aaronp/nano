# Typed, Described Ops Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every op of the core runtime, every catalog component and the platform has a real schema and a description, with examples where they mean something. The views show them, and a guard test keeps it that way.

**Architecture:**
- Core gains `Op.description` and `Component.description`, and `fits` ignores annotations.
- The runtime's registry ops get TypeBox schemas.
- runes' `component()` takes `{ in, out, description }` for actions and fills `Op.description`. Its schemas become required once every caller is annotated.
- The views read `Op.description` and the snapshot's `description`.

**Tech Stack:** Bun workspace, TypeScript, TypeBox (`typebox` package, v1), Lit, `bun test --isolate`.

**Spec:** `docs/superpowers/specs/2026-11-10-typed-described-ops-design.md`

## Global Constraints

- Branch `dev`. Never commit `kerits/`, `puzzles/`, `wires/`, `debounce/`, `adr/`, `starters/`, `topology-explorer.html` or `scripts/build-package.ts`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- The annotation keys `fits` ignores are exactly `description`, `examples` and `$comment`. `title` still counts.
- An omitted action `in` = `Type.Unknown({ description: 'Ignored: any value triggers it' })`. An omitted `out` = `Type.Void()`.
- Examples in views: at most 2, JSON-stringified, cut to 40 characters, shown as `e.g. …`.
- Full check: every package's tests, `node_modules/.bin/tsc -p .`, `make packages`, the ui-workspace build. Template: `make template-check` with `BUN_TMPDIR=$TMPDIR BUN_INSTALL_CACHE_DIR=$TMPDIR/bun-cache npm_config_cache=$TMPDIR/npm-cache` and the network allowed for `registry.npmjs.org`.

## Review Focus

1. A described schema still fits its undescribed twin, nested too (`Type.Array(Type.Number({description}))` fits `Type.Array(Type.Number())`) (Task 1 test).
2. A titled type still does not fit a differently titled one after annotations are stripped (Task 1 test).
3. The example wiring in `ui-workspace/src/composable.ts` still connects after every op is typed (existing host tests in Task 4, plus an explicit check that `host` has 4 subscriptions).
4. A no-argument action can still be triggered by any source (Task 3 test).
5. A runes component whose schema disagrees with its getter type fails `tsc` (Task 3, a `// @ts-expect-error` line in the test).

---

### Task 1: Core: descriptions, and `fits` ignores annotations

**Files:**
- Modify: `packages/core/src/data.ts`, `packages/core/src/component.ts`, `packages/core/src/registry.ts`
- Test: `packages/core/test/data.test.ts`, `packages/core/test/registry.test.ts`, `packages/core/test/component.test.ts`

**Interfaces:**
- Produces:
  - `Op` gains `description?: string`.
  - `Ops.action(ns, name, input, output, opts?: { description?: string })`, and the same last argument for `Ops.source` and `Ops.sink`. `description` is set only when given.
  - `Component` gains `description?: string`. `Components.create(id, make, opts?: { description?: string })`.
  - Snapshot instance entries and the `instance-added` delta gain `description?: string` (present only when the component has one).
  - `fits` strips `description`, `examples` and `$comment` at every depth before comparing. `anything(s)` is true when every key is `title`, `description`, `examples` or `$comment`.

- [ ] **Step 1: Write the failing tests:**
  - data:
    - `'fits ignores description, examples and $comment, at any depth'`: `Ops.fits` from a source with output `Type.Array(Type.Number({ description: 'd', examples: [1] }))` to an action with input `Type.Array(Type.Number())` is true;
    - `'a title still separates types after annotations go'`: `Type.Object({}, { title: 'A', description: 'x' })` vs `Type.Object({}, { title: 'B' })` is false;
    - `'a described Unknown takes anything'`: from a number source to input `Type.Unknown({ description: 'x' })` is true;
    - `'ops carry a description when given'`: `Ops.source('t', 'x', Type.Number(), { description: 'd' }).description === 'd'`, and without opts it has no `description` key.
  - component: `Components.create({ ns: 't', name: 'c' }, () => ({}), { description: 'A thing' }).description === 'A thing'`.
  - registry: a component with a description gives `description` in the snapshot entry and in `instance-added`. Without one, no key.
- [ ] **Step 2: Run** `cd packages/core && bun test --isolate`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the full check. Expected: all green. Existing snapshot `toEqual`s are unaffected, because the key is absent when there is no description.
- [ ] **Step 5: Commit** `feat(core): ops and components carry a description; fits ignores description, examples and $comment`.

### Task 2: Core: the runtime's registry ops are typed and described

**Files:**
- Modify: `packages/core/src/data.ts` (the `Subscription` and `Delta` schemas), `packages/core/src/registry.ts` (`Owner` and `Snapshot` schemas), `packages/core/src/runtime.ts:28-51`
- Test: `packages/core/test/runtime.test.ts`

**Interfaces:**
- Produces exported schemas: `SubscriptionSchema`, `OwnerSchema`, `SnapshotSchema` and `DeltaSchema`, a union of the four delta shapes. The existing TS types become `Static<typeof …>`, with the same names (`Subscription`, `Owner`, `Snapshot`, `Delta`), so callers don't change.
  - `Op` inside `SnapshotSchema` is `Type.Unknown({ description: 'An op: ns, name, input and output schemas, description' })`. Recursive schema types aren't worth it.
- `RegistryOps`: every op has a description, and:

  | Op | Input | Output |
  |---|---|---|
  | `add` | `{ id, instance: Unknown(described) }` | `Type.Void()` |
  | `remove` | `Type.String()` | `Type.Void()` |
  | `subscribe` | as now | `SubscriptionSchema` |
  | `unsubscribe` | `Type.String()` | `Type.Void()` |
  | `snapshot` | | `SnapshotSchema` |
  | each delta source | | its member of `DeltaSchema` |

- [ ] **Step 1: Write the failing test** `'every registry op has a description and no undescribed Unknown'`. Walk `Object.values(RegistryOps)` plus the deltas, and assert `op.description`. For each of `input` and `output` that is present, assert it is not a schema whose only keys are `~kind` / `type` with no `description`. Define `undescribedAny(s)` in the test: `s` is TypeBox Unknown (`Object.keys(s).every(k => k === '~kind' || k.startsWith('~'))`, or no `type`/`anyOf`/`$ref` and no `description`).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Check with tsc that `Static<>`-derived types still satisfy every user of `Snapshot`, `Delta` and `Subscription`.
- [ ] **Step 4: Run** the full check. Expected: green.
- [ ] **Step 5: Commit** `feat(core): the runtime's registry ops have schemas and descriptions; Snapshot, Delta, Subscription and Owner are TypeBox schemas`.

### Task 3: runes: action specs, descriptions, and a type check

**Files:**
- Modify: `packages/runes/src/index.ts`
- Test: `packages/runes/test/runes.test.ts`

**Interfaces:**
- Consumes: `Ops.*(…, { description })` and `Components.create(…, { description })` from Task 1.
- Produces:
  - `export type ActionSpec = { in?: TSchema; out?: TSchema; description: string }`.
  - `component<A>(id, make, schemas: Schemas<A>, opts?: { description?: string })`.
    - `Schemas<A>` maps each key of `A`: getter or event to `TSchema`; function to `ActionSpec`.
    - Keys stay **optional** in this task (`?:`), and become required in Task 4.
  - Type-level check: for a getter `K`, the schema `S` must satisfy `Static<S> extends A[K]`. For an action, `Static<in> extends Parameters<A[K]>[0]` when `in` is given. A mismatch is a compile error.
  - Behaviour:
    - a getter's or event's op description = `schema.description`;
    - an action's op = `Ops.action(id, k, spec.in ?? IGNORED, spec.out ?? Type.Void(), { description: spec.description })`, where `IGNORED = Type.Unknown({ description: 'Ignored: any value triggers it' })`;
    - for an event, the `schemas` entry wins over `event(schema)`;
    - `opts.description` goes to `Components.create`.
  - A bare `TSchema` given for an action key is still accepted, as `{ in: schema }` with no description. This keeps the existing callers compiling until Task 4.

- [ ] **Step 1: Write the failing tests:**
  - `'an action spec sets input, output and description'`: a component with `set: { in: Type.Number(), out: Type.Boolean(), description: 'Sets it' }` has `ops.set` with that input and output and `description: 'Sets it'`;
  - `'a getter's schema description is its op's description'`;
  - `'an action given no input takes anything and ignores it'`: `Ops.fits(Ops.source('t', 's', Type.String()), c.ops.go)` is true, and `c.ops.go.output` is `Type.Void()`;
  - `'the component's description is kept'`;
  - a type-only check:
    ```ts
    // @ts-expect-error a string schema for a number getter
    component('t/bad', () => ({ get n() { return 1 } }), { n: Type.String() })
    ```
    This is proven by `tsc` (Step 4), not by bun.
- [ ] **Step 2: Run** `cd packages/runes && bun test --isolate`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the full check, tsc included (it proves the `@ts-expect-error`). Expected: green.
- [ ] **Step 5: Commit** `feat(runes): actions declare in, out and a description; getters' schemas describe their ops; schemas are checked against the code's types`.

### Task 4: Annotate every component; schemas become required

**Files:**
- Modify:
  - `packages/bundle/src/components/{range,debounce,log,input,code}.ts`;
  - `packages/editor/src/components/{component-list,connection-board,type-editor,type-list}.ts`;
  - `templates/nano-template/src/{timer,picker}.ts`;
  - every test `component()` caller listed by `grep -rl "component(" packages/*/test templates/nano-template/test` (fixtures included);
  - `packages/runes/src/index.ts` (keys required);
  - `packages/runes/README.md` and the template's README (the new third argument).
- Test: `packages/ui-workspace/test/described.test.ts` (new), `templates/nano-template/test/described.test.ts` (new)

**Interfaces:**
- Consumes: Task 3's `Schemas<A>` and `ActionSpec`.
- Produces:
  - Every key of every component has a schema or spec with a description. Each component has a `description`.
  - `Schemas<A>` keys are required. The bare-schema-for-action fallback from Task 3 is removed.

- [ ] **Step 1: Write the failing guard tests.**
  - `ui-workspace/test/described.test.ts`, `'every op of every catalog component, the platform and the registry is described'`:
    - collect ops from `Object.values(catalog).map(e => e.component.actions)` plus the platform component's actions plus `RegistryOps`;
    - each op has a `description`;
    - neither `input` nor `output` is an undescribed Unknown (copy `undescribedAny` from Task 2's test into a small shared helper in the same file);
    - each catalog component has a `description`.
  - The template test does the same over its own `catalog`.
  - Also add to `host.test.ts`: `'the example wiring still connects'`, which checks that `host.registry.snapshot().subscriptions` has 4 entries whose listener isn't a `~view`.
- [ ] **Step 2: Run** them. Expected: FAIL, listing the undescribed ops.
- [ ] **Step 3: Annotate** each component. Use real schemas: Range's `min`, `max` and `step` are `Type.Number`, and so on. Examples are real values. Pass-through values are explicit `Type.Unknown({ description })`.
- [ ] **Step 4: Make the keys required** in `Schemas<A>`, and run tsc. Fix every caller it names, test fixtures included, giving each key a schema with a description.
- [ ] **Step 5: Run** the full check, then `make template-check` (with the network env). Expected: all green. In this task the guard leaves out the platform's ops, behind a `// until Task 5` filter, because Task 5 types them.
- [ ] **Step 6: Commit** `feat: every bundle, editor and template component is typed and described; runes requires a schema for every key`.

### Task 5: The platform's ops are typed and described

**Files:**
- Modify: `packages/platform/src/platform.ts`, `packages/platform/src/inventory.ts` (types from schemas, if `Kind` moves)
- Test: `packages/platform/test/platform.test.ts`, and the Task 4 guard (remove the platform filter)

**Interfaces:**
- Produces:
  - `SelectionSchema` (`Type.Union([Type.Object({ system, instance, op?: String }), Type.Null()])`) and `KindSchema`. `Selection` and `Kind` become `Static<…>`.
  - Every `PlatformOps` op gets a real schema and a description:

    | Op | Schema |
    |---|---|
    | `systems` | `Type.Array(SnapshotSchema)` |
    | `selected` | `SelectionSchema` |
    | `select` | in `SelectionSchema`, out `Type.Void()` |
    | `kinds` | `Type.Array(KindSchema)` |
    | `stateChanged` | `Type.Object({ system: String, delta: DeltaSchema })` |
    | `selectionChanged` | `SelectionSchema` |
    | `createSystem` / `createComponent` / `addToSystem` / `removeFromSystem` / `disconnect` / `catalogChanged` | out `Type.Void()` |
    | `connect` | out `SubscriptionSchema` |

  - The platform component gets a `description`.

- [ ] **Step 1:** Remove the Task 4 guard's platform filter, and **run** it. Expected: FAIL on the platform ops.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Run** the full check. Expected: green, guard included.
- [ ] **Step 4: Commit** `feat(platform): every op has a schema and a description; Selection and Kind are TypeBox schemas`.

### Task 6: The views show descriptions and examples

**Files:**
- Modify:
  - `packages/platform/src/view.ts` (the tree);
  - `packages/wires/src/render-detail.ts`;
  - `packages/platform/src/inventory.ts` and `table.ts` (Description column);
  - `templates/nano-template/AGENTS.md` (the rule);
  - the platform README (one line).
- Test: `packages/platform/test/view.test.ts`, `packages/platform/test/inventory.test.ts`, `packages/platform/test/table.test.ts`, `packages/wires/test/wires.test.ts`

**Interfaces:**
- Consumes: `Op.description`, schema `description` and `examples`, and snapshot `description`.
- Produces:
  - Tree:
    - an op node's body gains `<div class="desc">…</div>` and, when the input or output has examples, `<div class="eg">e.g. 42</div>`;
    - a component node gets `body` = `<div class="desc">` with the component's description;
    - op node `terms` include the description, so the filter matches it.
  - `Row` gains `description: string` (the component's, or `''`; `'—'` for a never-made kind, read from `Kind`). `KindSchema` gains `description?`, filled from the catalog component's.
  - The table adds a `{ key: 'description', label: 'Description', sortable: true }` column.
  - Wires detail, for an op: a `Description` row, and under Input and Output, each schema's `description` and `e.g.` examples.
  - A shared helper `examplesOf(s?: TSchema): string` (at most 2, `JSON.stringify`, cut to 40 characters, joined with `, `), exported from `@composable/platform` and used by wires.

- [ ] **Step 1: Write the failing tests:**
  - view: with the tree open on host/r, `[data-id="o:host/r/<Range.ops.set key>"]` contains the set description and `e.g.`, and filtering by a word only in the description keeps that op;
  - inventory: rows carry `description`;
  - table: the Description column shows Range's description;
  - wires: the Detail tab for an action shows its description;
  - `examplesOf` cuts at 40 characters and takes 2.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement**, and add the AGENTS.md rule: "Give every key a schema with a `description`, and `examples` where a value means something; actions take `{ in?, out?, description }`. The described test enforces it."
- [ ] **Step 4: Run** the full check and `make template-check`. Expected: green.
- [ ] **Step 5: Commit** `feat(platform,wires): the tree, the Detail card and the instance table show descriptions and examples`.
