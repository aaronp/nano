# A shared filter, icons and running status — design

Date: 2026-11-19. Branch: `dev-raft-template`. A short design: the conversation settled every choice.

## Intent

The Systems view (nano-ui's explorer) needs to be easier to read and narrow down, and other views (the Desk, the Ring)
need the same filtering. The user asked for:
- an expandable filter next to the text search, to choose nano types, namespaces and running status;
- icons for runtime, pod, implementation, interface, action and event in place of the capitalised kind words;
- a running indicator on every pod.

This is the reusable Filter component from the earlier roadmap. Tags stay out: they are a separate system to query
later, and can be another filter group then.

## Approaches

1. **A shared `<nano-filter>` in nano-ui, used by the Systems tree first (chosen by the user).** One component and one
   pure filtering model for every view.
2. *Improve the Systems tree's own filter only.* Quicker, but the Desk and the Ring would each grow their own.

## What exists (build on it)

- `nano-tree` (nano-elements, `kit/tree.ts`): a generic tree drawing each node's label, kind and badge.
- `filter(nodes, kinds, ns)` and `namespaces(nodes)` in `packages/ui/src/explorer-nodes.ts`: pure, one namespace.
- The explorer (`packages/ui/src/explorer.ts`): search, a collapsed "Filters" `<details>` (namespace select, kind
  checkboxes), and a `built`/`closed` badge per pod from `app.listen`.
- Pod lifecycle events on the `AppEvent` stream: `built`, `closed`, `restarted`, `failure`, `applied`.

## Design

**1. `<nano-filter>` (nano-ui).**
- A search box and, beside it, a filter button that opens a small panel of toggle chips in groups: **Type**,
  **Namespace** (several at once), **Status**.
- The host view supplies the groups and their options, so each view offers what fits it.
- It emits a plain value on change: `{ text, kinds, namespaces, statuses }` (sets of strings). It holds no app logic.
- The button shows how many chips are active.

**2. Pure, headless-tested logic (nano-ui).**
- `matches(item, filter)`: an item `{ label, kind, ns?, status? }` passes when its text, kind, namespace and status all
  pass; an empty group means "any".
- `filterTree(nodes, filter)`: generalises today's `filter` — keeps a match's ancestors, recounts groups, and replaces
  the explorer's single-namespace filter.
- `podStatus(states, event)`: folds lifecycle events into `running` (built, restarted), `stopped` (closed),
  `failed` (failure); a placed pod with no state yet is `not started` (a lazy pod not yet called); `applied` drops
  removed pods.

**3. Icons.**
- A small set of inline SVG icons for runtime, pod, implementation, interface, action, event and group, drawn in
  `currentColor` so they follow the theme.
- `nano-tree`'s node gains an optional `icon`; when present it is drawn before the label and the kind word is hidden
  (kept as the icon's accessible name and tooltip). This is a new option on nano-elements' tree (approved with this
  design).

**4. Running indicator.**
- A dot before each pod: green running, hollow not started, grey stopped, red failed; its title says the status. It
  replaces the `built`/`closed` badge. The Status filter uses the same four states.

**5. Rollout.** The Systems tree adopts all of it now. The Desk and the Ring adopting `<nano-filter>` are two board
items.

## Constraints

- Files at most 150 lines; exported types at most 10 members; no nano-core change.
- New exports: `NanoFilter` (`<nano-filter>`, registered by `defineViews`), `matches`, `filterTree`, `podStatus` and
  the filter value type from nano-ui; `icon` on nano-elements' `TreeNode`. Each recorded in `design.md`.
- Headless first: the model functions are proven by data-only tests; happy-dom tests only check that the element
  renders its options and emits the value, and that the tree shows icons and status dots.
- Theme tokens only (no fixed colours), so light and dark both work.

## Left to the builder

- The icon drawings, chip styling and the panel's placement (a popover under the button).
- Whether search text also matches a node's description, and debounce of typing.
