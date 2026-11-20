# A second host (React) to find the shared host core

## Intent
The data and API seam (nano-core, nano-platform, nano-ui) should be what any host builds on. Build a second host in a
deliberately different style and record everything it had to rewrite that the workspace already has: each overlap is a
candidate to move down into nano, the Platform, nano-ui or a new shared host core. Moving things is a later step,
decided with the user from the report.

## The second host (`packages/host-react`)
- React (TSX, compiled by bun; React and react-dom are its only new dependencies, in this package alone).
- Its own look: a top tab bar of pages; each page a plain CSS grid, one cell per slot, in slot order. Its arrangement
  (column count) lives in the page's opaque `layout` under its own key `react`; it never reads or writes the workspace's
  `layout` keys. Titles come from `meta.title` (falling back to the page id).
- Scope: boot from the same stored app document and UIDeployment as the workspace (same storage keys); list and switch
  pages; render each slot: a pod through its view (nano-ui's elements, the implementation's view tag), a `view` slot as
  "not available here", a `missing` slot as "not found" with Remove; add a slot by picking an implementation and a
  runtime (deploy a lazy pod, then `platform.apply`); remove a slot; save on change. Not in scope: migration, file
  import/export, HostPlatform, approval, sandboxed/foreign providers (nano.ui and same-origin modules only).
- The rule: it imports only `@pritzlaff/nano-core`, `@pritzlaff/nano-platform` and `@pritzlaff/nano-ui` (and React).
  No code copied from ui-workspace; whatever it must rewrite goes in the report, with roughly how many lines.
- Served on the workspace's origin at `/react/` (built into `packages/ui-workspace/public/react/` by its own build
  script, sharing the page's module copies through the existing import map if it must), so both hosts share storage: a
  page made in one shows in the other.

## The report
`docs/second-host-overlap.md`: for each overlap, what was rewritten, its size, where the workspace has it, and a
recommended home (nano-core, nano-platform, nano-ui, or a new framework-free host-core package), plus anything the
seam made awkward (a missing API, a shape that leaks the workspace). No moves in this step.

## Testing
host-react: unit tests for its non-React logic (boot, catalog, add/remove slot) with bun test; a hand check by the
controller in the built page: a page made in the workspace appears in /react/ and vice versa, a pick in /react/ deploys
into the chosen runtime and shows its view, a reload keeps it, the workspace still works.
