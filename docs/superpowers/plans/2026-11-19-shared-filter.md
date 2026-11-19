# Shared Filter, Icons and Running Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reusable `<nano-filter>` (search plus an expandable panel of type, namespace and status chips), kind
icons and a running dot per pod, adopted by the Systems tree.

**Architecture:**
- **Pure model:** `matches`, `filterTree` and `podStatus` hold all the logic and are tested headless.
- **Thin element:** `<nano-filter>` only renders the options it is given and emits a plain value.
- **Tree:** the generic `nano-tree` gains one renderer property for a node's leading icon. The explorer supplies kind
  icons and status dots through it.

**Tech Stack:** TypeScript, Lit, bun test (`--isolate`), happy-dom.

**Spec:** `docs/superpowers/specs/2026-11-19-shared-filter-design.md`.

## Global Constraints

- **Size:** files at most 150 lines. Exported interfaces and object types at most 10 members. No nano-core change.
- **Tree node shape unchanged.** `TreeNode` in nano-elements already has 10 members, so the icon is NOT a new node
  field. `nano-tree` gains a property `icon?: (node: TreeNode) => unknown` instead: when it returns something for a
  node, that is drawn before the label and the kind word is hidden, kept as the icon's title and accessible name.
  (Controller ruling: the same outcome as the spec's "optional icon", without breaking the members limit.)
  `kit/tree.ts` is already 155 lines and must not grow; move its styles into a sibling module if needed.
- **New exports:** `NanoFilter` (`<nano-filter>`, registered by `defineViews`), `matches`, `filterTree`,
  `podStatus`, and the types `FilterValue` and `PodStatus` from nano-ui; `nano-tree`'s `icon` property in
  nano-elements. Each goes in `design.md`.
- **Headless first.** The model is proven by data-only tests. happy-dom tests only check rendering and the emitted
  value.
- **Theme tokens only,** no fixed colours: light and dark both work.
- **Status words, exactly:** `running`, `not started`, `stopped`, `failed`.
- **Kinds, exactly:** `runtime`, `pod`, `implementation`, `interface`, `action`, `event`.
- **Tests:**
  - `cd packages/elements && bun test --isolate`
  - `cd packages/ui && bun test --isolate`
  - `cd packages/ui-workspace && bun test --isolate`
  - `bunx tsc --noEmit` at the root
  - Never a bare `bun test` at the root.
- **Commits:** on `dev-raft-template`, with `git commit --only <paths>` (the user commits their own files), each
  ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Every chip in a group deselected** means "any" for that group, not "nothing matches" (Task 1).
2. **A selected namespace that disappears** (its pods removed) doesn't leave a filter that hides everything: unknown
   selections are ignored (Task 1).
3. **Search text with regex characters** (`nano.ui/*`, `(`) is plain, case-insensitive substring matching and never
   throws (Task 1).
4. **A pod removed and placed again under the same name** shows `not started` or `running` from its new build, not
   the old `stopped` (Task 1).
5. **A filter that hides the selected node** keeps the details pane showing it (Task 3).

---

### Task 1: The filter model (pure)

**Files:**
- Create: `packages/ui/src/filter/model.ts`.
- Test: `packages/ui/test/filter/model.test.ts`.

**Interfaces:**
- Produces:
  ```ts
  export type PodStatus = 'running' | 'not started' | 'stopped' | 'failed'
  export type FilterValue = { text: string; kinds: Set<string>; namespaces: Set<string>; statuses: Set<PodStatus> }
  export type FilterItem = { label: string; kind?: string; ns?: string; status?: PodStatus; terms?: string[] }
  export const emptyFilter: () => FilterValue
  export function matches(item: FilterItem, f: FilterValue, known?: { namespaces?: Set<string> }): boolean
  export function filterTree(nodes: TreeNode[], f: FilterValue): TreeNode[]   // node.kind, node.data?.ns, node.data?.status
  export function podStatus(states: Record<string, PodStatus>, e: AppEvent, placed: () => Set<string>): Record<string, PodStatus>
  ```
- **Rules:**
  - An empty set in any group means any.
  - Text is a case-insensitive substring of the label or terms.
  - `action` and `event` are kinds of their own.
  - A selected namespace that isn't in `known.namespaces` is ignored.
  - `filterTree` keeps a match together with its ancestors, recounts group counts, and keeps all of a kept node's
    children. It replaces `filter` in `explorer-nodes.ts`; migrate its tests.
  - `podStatus`: `built` or `restarted` gives running, `closed` gives stopped, `failure` gives failed, and `applied`
    drops pods no longer placed. A placed pod with no state yet reads as `not started`; the explorer applies that
    default.

- [ ] **Step 1: Write the failing tests:**
  - `empty filter matches everything`;
  - `text: case-insensitive substring of label or terms; regex characters are literal` (Review Focus 3);
  - `kinds: only listed kinds; an empty set is any` (Review Focus 1);
  - `namespaces: several at once; an unknown selected namespace is ignored` (Review Focus 2);
  - `statuses: only pods whose status is listed; non-pods pass when only status is set`;
  - `filterTree keeps ancestors and recounts groups`;
  - `podStatus: built → running, closed → stopped, failure → failed, restarted → running, applied drops removed pods`;
  - `podStatus: removed then placed again → starts fresh (absent, so "not started", until built)` (Review Focus 4).
- [ ] **Step 2:** Run `cd packages/ui && bun test --isolate test/filter`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the ui suite and `tsc`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(ui): a filter model — matches, filterTree and pod status, headless`.

### Task 2: `<nano-filter>` and the kind icons

**Files:**
- Create:
  - `packages/ui/src/filter/filter.ts`: the element;
  - `packages/ui/src/filter/icons.ts`: inline SVG for the six kinds and a group, plus a status dot.
- Modify:
  - `packages/ui/src/views/define.ts`: register `nano-filter`;
  - `packages/ui/src/index.ts`;
  - `design.md`.
- Test: `packages/ui/test/filter/filter.test.ts` (happy-dom).

**Interfaces:**
- Consumes: Task 1's `FilterValue`, `PodStatus`, `emptyFilter`.
- Produces:
  ```ts
  // <nano-filter>: properties
  //   groups: { kinds?: string[]; namespaces?: string[]; statuses?: PodStatus[] }   (absent group = not shown)
  //   value: FilterValue
  // emits `change` (CustomEvent<FilterValue>, bubbles, composed) on typing and on each chip toggle
  export function kindIcon(kind: string): unknown          // an svg template; group for unknown kinds
  export function statusDot(s: PodStatus): unknown          // filled green running, hollow not started, grey stopped, red failed (theme tokens)
  ```
- **Look:** a search input, then a filter button showing the number of active chips. The button toggles a popover
  panel under it holding one chip row per group shown. A chip is a toggle button with `aria-pressed`.

- [ ] **Step 1: Write the failing tests:**
  - `renders a chip per option of each group given; no group, no row`;
  - `typing emits change with text`;
  - `a chip toggles into the set and emits`;
  - `the button counts active chips`;
  - `kindIcon and statusDot render an svg with a title per kind and status`.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement. Follow the repo's Lit pattern (`declare` reactive props and initialise them in the
  constructor).
- [ ] **Step 4:** Run the ui suite and `tsc`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(ui): <nano-filter> — search, type, namespace and status chips; kind icons`.

### Task 3: The tree's icon renderer, and the Systems tree adopts it all

**Files:**
- Modify:
  - `packages/elements/src/kit/tree.ts`: add `icon?: (n: TreeNode) => unknown`. It must not grow past its current 155
    lines; move styles to `kit/tree-styles.ts` if needed;
  - `packages/ui/src/explorer.ts`: replace the search input and "Filters" `<details>` with `<nano-filter>`; keep a
    `FilterValue`; render through `filterTree`; status from `podStatus`;
  - `packages/ui/src/explorer-nodes.ts`: pod nodes carry `data.status`; no `badge`; remove `filter`;
  - `design.md`;
  - `docs/board/board.md`: add two To Do items, "The Desk adopts `<nano-filter>`" and "The Ring adopts
    `<nano-filter>`".
- Test:
  - `packages/elements/test/tree.test.ts` (extend);
  - `packages/ui/test/explorer.test.ts` (extend or create).

**Interfaces:**
- Consumes: Task 1's `filterTree`, `podStatus`, `FilterValue`; Task 2's `<nano-filter>`, `kindIcon`, `statusDot`.
- The explorer's `icon` renderer: a pod gets its status dot then the pod icon; other kinds get `kindIcon(kind)`; groups
  get none. Status options offered: all four; kinds: the six; namespaces: from the tree.

- [ ] **Step 1: Write the failing tests:**
  - **tree:** `with icon, a node shows it and hides the kind word (kept as title); without, unchanged`;
  - **explorer:**
    - `pods show a status dot: a lazy pod "not started", an eager one "running" after build`;
    - `choosing status "running" hides not-started pods`;
    - `kind chips and namespace chips narrow the tree`;
    - `the selection's details stay when a filter hides it` (Review Focus 5).
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the elements, ui and workspace suites, `tsc`, and `cd packages/ui-workspace && BUN_TMPDIR=$TMPDIR bun run build`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(ui): the Systems tree — shared filter, kind icons and a running dot per pod`.
- [ ] **Step 6 (controller):** check in a real browser: Raft installed, a cluster created, the dots and the filter
  working in both themes.
