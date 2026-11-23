# The picker places existing pods

**Intent** (user): a provider's tile in the picker can place a pod that already exists, not only make a new one (today
every tile deploys a new pod, so the Raft example's installed `cluster` can only be shown through Systems › Open
view). A lazy pod placed this way is got-or-created when its page opens; the picker shows which pods are running.

**Approaches:** (A, chosen by the user) under each implementation's tile, its existing pods in the chosen runtime, each
marked running or not, beside a "+ new" choice; (B) a separate Pods section listing every pod in the runtime (longer,
and it repeats Systems).

## Design
- **What exists carries it**: placing an existing pod is what Open view does, a `pod` slot naming it
  (`dock/page-pods.ts` `pods.add`); opening the page gets or creates it (`outline.open`). No new public name, no
  change in the host core or nano-core.
- **The picker** (`picker-grid.ts`): an implementation's tile whose implementation has pods in the chosen runtime
  shows them under it, one small tile per pod (its name, with ● when `app.runtime(r).status(pod)` is `running`, ○
  otherwise), and "+ new" (today's tile: deploys a new pod). With no such pods the tile stays as today. Switching the
  runtime pill re-lists them; the filter matches pod names too; arrows and Enter reach them as other tiles.
- **A pick of an existing pod** resolves with its name; the dock gives it its `pod` slot (`pods.add`) and shows it,
  deploying nothing. A pod already shown on this page has its panel focused instead (as `addWidget` does now).
- The grid learns the pods through the dock's entries (read live, as the templates and runtimes are now).
- Host pods (`ui`, `deploy`, `outline`) never appear (their provider has no tiles).

Not in this step: placing pods of tool views, listing pods across runtimes at once, live updates of the ● while the
picker stays open.

Constraints: files ≤150 lines (workspace-dock.ts ≤226); no new export without the user's approval.
