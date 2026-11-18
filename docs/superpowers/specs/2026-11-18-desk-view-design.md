# Desk view — design

Date: 2026-11-18. Spike: `docs/spikes/desk-spike.html` (throwaway; the look and the drag behaviour are what was approved).

## Intent

A **systems** view that complements the UI-first views. Circuit shows pages and Connections shows the backs of panels;
the Desk shows the system the way a mixing desk does. Each runtime is a coloured, labelled box. Each pod is a column
inside it, with an **in** side of hollow jacks and an **out** side of filled jacks. Cords run between the jacks: pipes
are solid, call edges are dashed. You can arrange the desk, save the arrangement, and, once you switch editing on,
patch and unpatch pipes.

It is the first of four pieces, built in this order: **Desk**, then a shared **types** styling (op kind → colour and
shape, read by every view that draws jacks), a shared **Filter** component, and shared **detail** components in a
drawer. Each later piece gets its own spec.

## Goals

- **The Desk is a new `<c-desk>` element and a third tab on the Wiring page:** Circuit | Connections | Desk.
- **Layout matches the spike:**
  - Runtimes are boxes, with their pods as columns inside.
  - A runtime box always grows to hold its columns, so nothing overflows.
  - Columns are as wide as their labels.
  - A toggleable snap grid, 20px, on by default.
  - On release, overlapping siblings are pushed right or down, whichever move is shorter, and the push cascades.
  - The first placement sets callers left and callees right: a runtime's rank is its longest path from the runtimes
    that call into it.
  - Only call edges link runtimes, because core keeps both ends of a pipe in the pipe's runtime. An edge in runtime
    R whose caller is also placed in X links X → R (Claude's call).
- **Arrangement is saved:** runtime and column positions and the snap setting are kept in the deployment's
  `layout.desk`, beside the dock's `layout.workspace`, and written by Save as the dock's state is.
- **Editing (pipes):**
  - An **edit** toggle (an icon button) is off by default. While it is off, nothing on the Desk changes the
    deployment.
  - While it is on, you select an out jack and then an in jack (or the reverse) to add a pipe.
  - You select a cord and remove it with the Delete key or a remove button.
  - A connection is checked by the existing `checkConnect`, which uses core's `fits`. A refusal is shown and nothing
    is applied.
- **One source of truth:** what the Desk draws comes from core's index over the deployment (below), the registry,
  and the observed calls. No second model of the system.
- **Delete the puzzle mode** from Connections: `wires/puzzle.ts`, the puzzle drawing in `render-pieces.ts`, the
  `mode` state, the relay/puzzle switch and their tests. Connections keeps the relay view only, and it must look
  the same (Claude's call):
  - Relay's store blocks (`renderBlocks`) move into a relay file.
  - The Routes list's chain text, today `el.puzzle.descs` from `buildPuzzle`, gets a small relay-side function
    of its own.

## Non-goals

- **Editing call edges.** Calls are shown (op-level where observed, amber when not declared), not added or removed,
  on the Desk.
- **Moving a pod between runtimes, or adding and removing pods.** These belong in a later step.
- **Connecting jacks whose types don't fit.** That will be the job of specific components such as `map`, each
  covered on its own later.
- **Tags.** Tags are a separate system to query later; their results would be flatMapped into the filters we do
  support.
- **The Filter, types styling and detail drawer.** The Desk uses the existing Connected/All toggle and the
  runtime/component pills (`wires/filter.ts` `viewOf`) until the Filter replaces them.

## Anti-goals

- **No accidental unplugging.** No click, drag or key on the Desk changes the deployment unless editing is on.
- **No restated concepts.** No stringified coordinates of our own, no parallel snapshot, no copy of the edit
  functions. The Desk reuses `snapshotOf`, `jacksOfImpl`, `checkConnect`, `viewOf`, `wireId` and the call-cord
  colours.
- **No unindexed scans.** Placement and pipe questions are not answered by scanning the deployment where core's
  index answers them.

## Core changes (approved by the user, 2026-11-18)

1. **Export `lookup(d)` from nano-core** (`application/lookup.ts`, the `Lookup` type). It is already the router's
   index, cached per deployment object and rebuilt when `apply` makes a new one:
   - `placed`: the pods in each runtime.
   - `placedIn`: each pod's runtimes.
   - `callsFrom`: each pod's call edges.
   - `calls`: every call edge.
   - `pipes`: pipes by `${from} ${port}`.
   - `policy`: each runtime's policy.

   `snapshotOf` and the Desk read placements and pipes from it. Add it to `design.md`'s export table.
2. **`AppDeployment.edit` gains `pipe` and `unpipe`.** Their signatures are left to the builder in the core style of
   `place`. Each takes a runtime and a pipe (`from`, `source`, `to`, `target`):
   - `pipe` refuses with `not-found` when either pod is not placed in that runtime, and with `invalid-input` when the
     same pipe already exists.
   - `unpipe` removes the matching pipe and refuses with `not-found` when there is none.

   Type fit is not checked here: `assemble`/`apply` already validate. Document both in `design.md`.
3. **Connections' `connect` and `disconnect` call the new edits,** and are moved off the `Wires` element so the Desk
   and Connections share them. They take the host and report a refusal to their caller, and the caller shows it.

## Constraints

- **Size limits** (`packages/nano/test/structure.test.ts`): source files of at most 150 lines, exported object types
  of at most 10 members, and every export listed in `design.md`. The baseline may only shrink, so the Desk is split
  across small files, as `wires/` and `circuit/` are.
- **Workspace conventions:**
  - Lit elements, defined with a `defineDesk()` like `defineWires`.
  - Pure model functions with no DOM, tested with `bun test --isolate`.
  - Browser tests in `packages/ui-workspace/test`, as the Connections ones are.
- **The Desk rebuilds when an `applied` event arrives,** as Circuit does. Positions persist across applies and are
  pruned only for pods or runtimes that no longer exist.

## Approaches considered

- **A. A new `<c-desk>` that reuses the wires parts, plus core's index and pipe edits (chosen).** It keeps the Desk
  out of Connections' already-large state and files and shares the one model and one edit path.
- **B. A third mode of `<c-wires>`.** This would bring Connections' state, drawer and editing for free. It was
  rejected because Connections is built around tilting the live dock, its `State` is about 30 fields, and two of its
  files are at the line limit.
- **A without the core changes.** This would keep the workspace's nested scans and its hand-written subscription
  edits. It was rejected because the user wants core's O(1) index as the single source of truth.

## Decided

- **Jacks:** an action has an in jack and an out jack (its result); an event has only an out jack, shown in italics.
- **Cords:**
  - Pipes are solid.
  - Calls are dashed in the call colour.
  - A not-declared call is amber with a visible label, using `opCord`'s colours.
- **Layout source:** the spike's layout rules above are the spec for placement.
- **Edit toggle:** an icon button, off by default.
- **Default layout is the spike's B, the runtime grid (user, 2026-11-18):** one column per rank, with runtimes
  stacked within it, callers left.
- **Two more toolbar buttons (user; the reading of each is Claude's):**
  - **Align** discards the arrangement and lays everything out again with B's rules, snapped. It is the way back to
    a tidy desk.
  - **Compact** toggles the spike's C density: narrower columns, shorter jack rows, smaller gaps and no
    implementation subtitle. It is saved as `compact` in `layout.desk`.

## Left to the builder (calls made by Claude, marked so the user can check)

- **`layout.desk` shape (Claude's call):**
  `{ snap: boolean, compact: boolean, runtimes: Record<runtime, {x, y}>, pods: Record<runtime, Record<pod, {x, y}>> }`. A pod in two
  runtimes has a column in each.
- **Selection while editing (Claude's call):**
  - The first jack is highlighted, and the jacks it can fit are marked.
  - Esc or a click on empty space cancels.
- **Snap toggle and saved positions (Claude's call):** toggling snap never discards positions. Turning it on
  rounds every saved position to the 20px grid; turning it off leaves positions as they are.
- **Pan and zoom:** the stage scrolls, as in the spike. Zoom can come later.
- **Splitting `<c-desk>` into files,** and its internal state.
