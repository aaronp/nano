# Raft: the cluster's main screen, as raft.github.io

**Intent** (user: "yes"): the Raft example reads like raft.github.io. One Raft page with the cluster panel shows the
whole cluster: its nodes in a ring, each with its operations, and the log grid. Per-node pages are out of scope.

**Approaches:** (A, chosen) the cluster pod's view `<raft-cluster>` draws it, all inside `examples/raft`; (B) a page per
node, which needs the example to ship pages or the picker to place running pods (both workspace changes, deferred).

## Design
- **`<raft-cluster>`**: under its Create/Remove form, its list of clusters is a list of buttons; the chosen one (the
  first, by default; a create chooses the new one) is drawn below. Its node ids come from node `<name>-1`'s status
  (`id` and `peers`, sorted), so a cluster made before a reload draws too; no interface change.
- **The ring**: each node's existing `<raft-node>` (runtime `<id>`, pod `<id>-raft`) placed on a circle, labelled with
  its id.
- **`<raft-node>`, as the reference**: a click opens its detail (`<raft-detail>`, unchanged) in a modal `<dialog>`
  titled with the node id, closed by ✕ or Escape; a right-click (`contextmenu`) opens a menu of stop, resume, restart,
  time out, request, each calling its op (a refusal shows in the menu's place as today's alert). The inline toggle goes.
- **The log grid**: one row per node, one column per log index (at least 10, as the reference), each cell its entry's
  term; committed entries (index ≤ that node's `commitIndex`) marked. It follows `Ledger.written` and `RaftNode.changed`
  per runtime, as `<raft-ledger>` does. The rows are a pure model function in `views/model.ts`.
- Not in this step: pause, the time scrubber and speed (the sim clock's `ClockControl`), messages in flight.

Constraints: files ≤150 lines; every new export named in design.md; no change outside `examples/raft` (and design.md).
