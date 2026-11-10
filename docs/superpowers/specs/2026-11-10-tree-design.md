# A tree for the kit, and the Systems view on it

**Why.** The prototype `topology-explorer.html` shows systems → components → actions → types, with "Also in…" for a
component shared by several systems. `<c-platform>` already shows that data, but as a hand-rolled tree (no keyboard,
no tree roles, no highlight). A general `<nano-tree>` in the kit gives every host a tree; `<c-platform>` is rebuilt on
it, in the prototype's look, and keeps what it does now (select, connect, disconnect, add to system, create).

## `<nano-tree>` (packages/elements/src/kit/tree.ts)

- `nodes: TreeNode[]`, where `TreeNode = { id, label, kind?, count?, badge?, terms?, end?, body?, children? }`.
  `kind` shows small and upper-case, `count` beside it, `badge` as a chip; `end` is extra content at the row's end
  (buttons); `body` is content shown inside an open node, before its children; `terms` are more text to match.
- `query`: nodes whose label or terms contain it (any case) are shown, with their ancestors (open) and their own
  subtree; the match is marked. Empty query: everything, as opened.
- `open-depth` (default 0): nodes shallower than it start open. Opening or closing one is remembered by id.
- `selected` (an id). Clicking a row emits `select` (`detail: { id }`, cancelable) and, unless cancelled, selects it;
  it also opens or closes an expandable row. The chevron only opens or closes.
- `reveal(id)`: opens its ancestors, focuses it and scrolls it into view.
- Keyboard and ARIA as WAI-ARIA's tree pattern: `role=tree`/`treeitem`/`group`, `aria-level`, `aria-expanded`,
  `aria-selected`, one tab stop; ↑ ↓ Home End, → opens or goes to the first child, ← closes or goes to the parent,
  Enter or Space selects, a letter jumps to the next visible row starting with it.
- Look: the prototype's (rows with hover and selected shading, guide lines, muted kinds, chips), from `--nano-*`
  tokens only.

## `<c-platform>` on it

- By system: system (`s:<sys>`, count) → component (`c:<sys>/<id>`; shared ones get a "↗ N systems" badge and an
  "Also in [↗ sys]" body whose buttons select it there) → op (`o:<sys>/<id>/<key>`, its types as body, the connect
  button as `end` when it fits the selected op) → connections (`x:<sys>/<sub>`, disconnect button).
- By component as before, on the tree. A "Shared only" box keeps components in more than one system.
- A selection, made here or elsewhere, reveals its row. Systems open by default; the rest closed.
- Not built: the prototype's "Unassigned" group. Every component lives in a system's registry, so there are none.
