# The Platform: pages over an Application, as their own deployment

Supersedes `2026-11-21-pages-in-the-deployment-design.md` (a draft, never built) and, of
`2026-11-20-pages-as-deployment-design.md`, the parts that put pages in the Application's document (`layout.pages`,
Part 2) and their API (`HostPages`, Part 3, the store's write API). That spec stands for explicit `start` /
`getOrCreate` (ADR-0031), lazy picks (ADR-0035), the picker grid, trust at boot (ADR-0034) and Save layout as a
restore point (ADR-0036). Builds on `RuntimeCoord` and coordinate selectors (ADR-0037). New record: ADR-0038,
superseding ADR-0032 and ADR-0033. 

## Intent

Nano's Application, Runtime and their deployment are single-responsibility concepts with coordinates for their parts.
Pages are orthogonal: a grouping of views over a system, like Argo CD over Kubernetes, built on it, with its own data
model that it decides, reads and stores outside it. The Platform is that layer. It owns one document (the
UIDeployment), changes it with one verb (`apply`), and reads the Application to resolve what its slots point at. The
workspace UI is one client; a CLI, an API or another UI could be others, each keeping its own layout and meta.

Goals: a small, framework-free Platform with one document and one `apply`; slots that reference pods by coordinate or
by selector (or a pod-less view); opening a page starts what it shows (`getOrCreate`), reusing what runs; the host only
saves and loads JSON. Non-goals: pages owning pods; the Platform deploying pods (it asks nothing of the Application but
`getOrCreate`; the client deploys, then applies a slot); core knowing pages. Anti-goals: per-operation APIs
(`setPage`, `removePage`, `merge`, `prune`…); a second copy of a page; core events for arrangement changes.

## Approaches

1. **A separate layer and document (picked, the user's).** Core untouched; the Platform reads the Application.
2. Pages in `AppDeployment` (the superseded draft): one document, but core grows a presentation concept and every
   drag is an Application event.
3. Pages as an opaque convention in `layout` (what `dev` has now): every client re-implements validation and the
   operations multiply.

## The model (`packages/platform`, framework-free, depends on nano-core only)

```ts
type UIDeployment = { pages: Record<PageId, Page> }
type Page = { slots: Record<SlotId, Slot>; layout?: unknown; meta?: unknown }   // layout, meta: the client's, opaque
type Slot =
  | { kind: 'pod';    pod: PodCoord }            // exact: a pick
  | { kind: 'select'; select: SelectorData }     // a query, resolved against the Application
  | { kind: 'view';   view: string }             // a client's pod-less view (Systems, Wiring…)
```

- Ids (`PageId`, `SlotId`) follow the id rule; a page with no slots is valid. Serialised, coordinates and selectors are
  their strings (`toJSON`, ADR-0037); `Platform.parse(json)` reads them back into coordinates, refusing a malformed
  document as a whole (`invalid-input`, naming the page and slot).
- **`apply(next)`** replaces the document, all or nothing, after the shape check. It does **not** require referenced
  pods to exist: like Argo, the document is desired state and the Application is what is; a slot that resolves to
  nothing is shown as missing, not refused (*my call; see Open*). It reports what changed (pages added, removed,
  changed) to its own listeners; it is not an Application event, so arrangement changes are cheap and leave
  Application history alone. Drags, titles and slot changes all go through it: one write path.
- **Resolution** (`resolve(pageId)`), per slot, against the Application now:
  - `pod`: the pod if placed in that runtime with that implementation, else `missing`.
  - `select`: every placed pod matching (`matches`, over each runtime the selector allows); zero is `missing`; several
    are all returned in a stable order (by runtime, then pod) and the client decides (the workspace shows the first
    and says how many matched; *my call*).
  - `view`: passed through.
- **Opening** (`open(pageId)`): resolve, then `app.runtime(r).getOrCreate(p)` for each resolved pod; returns per slot
  the pod (with `started`) or the `Fail`. Pods already running are reused; nothing is started for a page not opened.
- The Platform re-resolves when the Application changes (it listens for `applied`) and tells its listeners which pages'
  resolution changed, so a client can redraw a slot that went missing or came back.
- `Platform.create(app, doc?)` gives `{ document(), apply(next), resolve(id), open(id), listen(fn) }`;
  `Platform.parse(json)` and the document's JSON form are the save/load seam. No storage inside.

## The host and the workspace (ui-workspace)

- **Persistence:** the host saves the UIDeployment JSON beside the Application's document (its own key) on each
  Platform change, and boots from it; trust as ADR-0034. Old storage (saved-workspaces, per-dock keys, `layout.pages`
  from the stored document or an imported file) is read once into a UIDeployment (internal migration, as built).
- **A pick:** deploy the lazy pod (`host.apply`, as now), then `platform.apply` the document with the new `pod` slot.
- **Every page edit** (add/remove page, open/close panel, drag, template, title, icon, order, restore point) is the
  workspace building the next UIDeployment and calling `platform.apply`. The workspace's rules (Main first and not
  removable, fixed routes, order in `meta`, an imported Main filling a Main that shows only views) are applied by the
  workspace to its own `next`s; the Platform knows none of them.
- **A dock** renders a page: its `layout` is the dock's engine state, its panels the resolved slots. Slots stay the
  truth (`reconcile`, as built); a `missing` slot shows "not found" in place with a remove button.
- **Pods and pages:** a pod changes pages through one nano-ui capability, `HostPlatform { document; apply }` (get and
  apply, kubectl-style), asked through the existing approval on `apply`, whose summary names pages and slots added or
  removed. It replaces `HostPages` (*proposal; see Open*).
- **File › Save / Open:** see Open.

## What changes on `dev`

Removed: nano-ui `Page`, `ViewSlot`, `pagesOf`, `HostPages` and `LayoutData.pages`; the workspace's `pageStore` write
API (`set`, `remove`, `merge`, `prune`), `host-pages.ts` (`hostPages`, `pagesPod`, the `pages` host pod; `HOST_PODS`
back to two), `start(pages?)`, `hostProvider(app, pages?)`, the boot-host import merge and the clearing apply, and
`addPod`'s slot bookkeeping. Kept: core `start`/`getOrCreate`, `RuntimeCoord` and coordinate selectors, the picker grid,
lazy picks, page-docks/page-slots (re-pointed at the Platform), migration, trust at boot, ADR-0036's restore point (in
`meta`).

## Testing

Platform: parse/serialise round-trip (coordinates and selectors as strings), malformed documents refused whole;
`apply` all-or-nothing and its change report; `resolve` for each slot kind (pod found, missing after removal, selector
with zero/one/several matches across two runtimes); `open` starts a lazy pod once, reuses a running one, returns the
`Fail` of one that can't start; re-resolution on `applied`. Workspace: a pick is deploy-then-apply; a drag is one
`platform.apply` and no Application event; a pod's `HostPlatform.apply` is asked; a reload restores pages and pods;
migration of old storage. Then a hand check and the e2e run.

## Settled after the builder check (my calls)

- **Resolving selectors needs the registry** (`provides` isn't in the Application): `Platform.create(app, registry,
  doc?)`. The `Target` builder the workspace already has (`auto-connect.ts`) moves into the platform package and both use
  it; nothing new in core.
- **Selectors' written form:** the platform package owns parsing a written selector (strings) back into coordinates;
  `described.ts`'s copy goes and uses it. Not a core export.
- **Ids** (`PageId`, `SlotId`) follow the `Coord` id rule (as `RuntimeCoord`).
- **`apply` is synchronous** and notifies listeners synchronously, with a change report keyed by page (added, removed,
  changed), so a dock's own write is recognised (`quiet`) and clients skip unchanged pages; the cost is a shape check
  and copy of the document per write, fine for a handful of pages.
- **A panel carries its slot id**; its pod comes from `platform.resolve`, not "the first runtime placing that name".
  Rewriting slots from panels keeps each slot's kind (a `select` slot stays a `select`); only panels added or closed add
  or drop slots. Two slots may name same-named pods in two runtimes.
- **One start path:** showing a page calls `platform.open`; panels mount with its results and re-try on the Platform's
  re-resolution, not on their own `getOrCreate`.
- **A `missing` slot stays** in the document and shows "not found" with a remove button; reconcile never deploys or
  starts it. (Whether undeploy leaves slots behind is the dangling-references question.)
- **The app document's `layout` keeps only other features' keys** (`desk`, `ring`). Main's legacy import
  (`layout[MAIN]`, top-level `slots`/`geometry`) becomes migration into the UIDeployment, in one place; the workspace's
  Save no longer writes the legacy neutral form (example files that carry it still open). Engine-neutral `geometry` is
  dropped: arrangement is the client's `layout`.
- **Imports:** the Import dialog's runtime renames and pod selection rewrite an incoming UIDeployment's pod coordinates
  and selectors too; the workspace keeps its merge rules (suffix clashing ids, skip identical, fill a Main showing only
  views) on the `next` it builds.
- **Title, icon and order are `meta`** (the user's model: label, icon, position are metadata); a CLI sees ids. A reorder
  rewrites the pages whose order changes.
- **Persistence:** the UIDeployment has its own storage key beside the app document's; the another-tab check and the
  old-key removal cover both; a stored app document carrying `layout.pages` is migrated once and then saved without it.
- **The new package** is subject to the structure test (150 lines, 10 members); its exports go in design.md, and
  design.md's pages paragraph is rewritten. The stale untracked `packages/platform` folder is cleared first.

## Decided by the user

- **Names:** the Platform (`packages/platform`, `@pritzlaff/nano-platform`) and its document, the UIDeployment.
- **Dangling references are shown, not refused:** `apply` accepts a slot naming an absent pod; it resolves `missing`.
  An undeploy leaves slots behind; they show "not found" until removed or the pod returns.
- **Several selector matches:** the first (stable order), and the panel says how many matched.
- **File › Save / Open:** a bundle `{ app: <AppDeployment>, platform: <UIDeployment> }`, written by the workspace;
  opening a plain `nano.json` still works; core and `Application.load` only ever read a plain document.
- **`HostPlatform { document, apply }` now**, in the platform package (which owns the UIDeployment schema), placed as a
  host pod (`HOST_PODS` three). `document` returns the document and its `version`; `apply({ next, base })` is refused
  (`invalid-input`, "the pages changed since") unless `base` is the current version, then asked through the approval.
  The Platform's `apply` takes an optional `base` the same way; the workspace's own writes omit it.
