# Systems: runtimes only, and Delete runtime

**Intent** (user): the Systems view lists only the runtimes (each still with its Pods, Implementations, Interfaces and
Operations); the top-level Operations, Interfaces and Implementations groups go. The selected runtime can be deleted,
after a modal confirmation. "For now we just delete the selected runtime" (user): nothing else it relates to.

**Approaches:** (A, chosen) the shared explorer (`packages/ui`) shows a Delete button in a runtime's details and asks
its host by an event; the workspace confirms and applies `removeFrom`; (B) the explorer applies the removal itself:
rejected, the explorer is shared by hosts and does not know which pods are a host's own.

## Design
- **Tree** (`ui/src/explorer-nodes.ts` `nodes`): the runtimes only; the `g:` groups are gone. A runtime's own groups
  stay. Links to an interface or implementation (`i:`, `m:`) still select it and show its details.
- **Delete** (`ui/src/explorer-details.ts`, a runtime's details): a button "Delete runtime" fires `nano-delete` with
  `{ runtime }` (bubbles, composed), as "Open view" fires `nano-open` (*name to confirm*: new public event).
- **The workspace** handles `nano-delete`: `removeFrom(h.data(), { runtimes: [r] })` (`host-deploy.ts`); refused
  (main: it places the host's own pods) → its reason as a toast, no modal. Else `askConfirm` (`name-dialog.ts`):
  "Delete runtime raft? Its pods cluster, raft-messaging, … go with it." (and "… stay: placed elsewhere" for pods
  another runtime places), Cancel focused; Delete → `h.apply(next)`; a failure a toast. The selection clears.
- Pages' slots for removed pods stay (they show "not found" with Remove, as today); the module stays loaded.

Constraints: files ≤150 lines; new exports named in design.md and approved by the user.
