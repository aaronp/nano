# Pages in the deployment: one document, one apply

Revises `2026-11-20-pages-as-deployment-design.md` (which stands where not revised: explicit `start`/`getOrCreate`,
lazy picks, the picker grid, a reload reopening the same pods, Save layout as a restore point). Supersedes its Part 3
(`HostPages`) and the store's write API; supersedes ADR-0032 and ADR-0033 (new record ADR-0037).

## Intent

What we built works but has too many operations: `setPage`, `removePage`, `open`, `merge`, `prune`, a store with its
own rules, all because pages sat beside the deployment instead of in it. Nano already has the `kubectl apply` shape:
the system is one document (`AppDeployment`) and `app.apply(next)` diffs, validates and applies it, all or nothing.
Pages join that document. The seam is small: a **page** groups **slots**; a slot names a **pod** (by runtime and pod)
or a pod-less view; a page may also carry an opaque **layout** (an engine's arrangement) and opaque **meta** (title,
icon, order, restore point). The host only saves and loads JSON. Another implementation (a CLI, an API, another UI)
keeps its own layout and meta and still shares pages, slots and pods.

Goals: pages in core's `AppDeployment`, changed only by `apply`; core validates slots and prunes them with their pods;
no page-specific operations; the workspace reduced to a copy of the document plus its UI.
Non-goals: pages owning pods (they reference them; two pages may show one pod); core understanding layout or meta.
Anti-goals: a second write path for structure; core noticing arrangement changes; per-UI rules in core.

## Approaches

1. **Core owns pages; structure through `apply`, arrangement saved directly (picked, the user's).**
2. Pages as an opaque convention in `layout` (as built): every implementation re-implements validation and pruning.
3. Everything through `apply`, filtering layout-only diffs from the event stream: one path, but core learns which
   fields are noise.

## The model (nano-core)

```ts
type AppDeployment = { …as now; pages?: Record<PageId, Page> }          // 8 members
type Page = { slots: Record<SlotId, Slot>; layout?: unknown; meta?: unknown }
type Slot = { runtime: string; pod: string } | { view: string }
```

- `PageId` and `SlotId` follow the id rule; slot ids are unique within their page. A page with no slots is valid.
- **Validation** (in `assemble`, so `create` and `apply` share it, strictly): every pod slot names a pod placed in that
  runtime; otherwise `invalid-input` naming the page and slot. View slots are only shape-checked. `layout` and `meta`
  are any JSON, shape-checked as such.
- **Pruning:** none in core. A `next` that removes a pod while a slot still names it is invalid like any dangling
  reference; the caller removes the slot in the same `next`. (*my call*: keeps `apply` all-or-nothing and the document
  honest; the host does the removal for its own undeploys, below.)
- **`deployment()`** returns `pages` with `slots` only (like it omits `layout` today); `layout` and `meta` are the
  host's, carried in what it saves.
- **`applied`** reports page changes as it reports pod and runtime changes (pages added, removed, re-slotted), so
  history and replay see them.
- **Pages are not instances:** nothing is built, started or closed by a page. `start` / `getOrCreate` stay on
  `RuntimeView`, called by whoever opens a page.

## Sources of truth

| Fact | Owner | Written by |
|---|---|---|
| pods, runtimes, wiring, policy | the Application | `apply` |
| which pages exist and their slots | the Application | `apply` |
| whether a pod is running | the Application | `start` / `getOrCreate` / a call |
| a page's `layout` and `meta` | the host's document | the UI, directly (no `apply`) |
| what is persisted | the host: `{ ...app.deployment(), modules, views, frames, layout, pages with layout and meta }` | save on `applied` and on arrangement changes |

## The host and the workspace (ui-workspace)

- **One write path for structure.** Adding or removing a page, adding or removing a slot, and a pick (deploy a lazy pod
  and add its slot, now one `next`) are `host.apply(next)`. A pod changes pages through `HostDeploy` (its `deploy`
  takes pages beside pods and runtimes), asked through the existing deployment approval, whose summary names the pages
  and slots added or removed. `HostPages` goes.
- **Arrangement** (drags, template switches, swaps, parks, titles, icons, order, restore points) writes `layout` and
  `meta` into the host's document copy and saves; core is not asked.
- **Undeploy:** the host's undeploy (and the pruning a removed runtime causes) removes the slots naming the removed
  pods in the same `next`.
- **Persistence:** `save(json)` / `load(json)` of the whole document. Boot loads it (ADR-0034 trust unchanged), migration
  of the old keys stays as built, internal.
- **Opening a page:** reading its slots and calling `getOrCreate` for each pod slot (as built).
- **Import:** an imported document's pages arrive in its `next`; clashing page ids are suffixed and Main's rules
  (Main first, filled when it shows only views) stay the workspace's, applied to the `next` before it is applied.
- **Removed:** `HostPages`, the `pages` host pod (`HOST_PODS` back to two), the store's `set`/`remove`/`merge`/`prune` as
  API, `open`, `pagesOf` and `Page`/`ViewSlot` in nano-ui (moved to core), `hostPages`, `pagesPod`, `start(pages?)`,
  `hostProvider(app, pages?)`. The workspace keeps one in-memory document and its UI rules.
- `layout.pages` (the convention just shipped) reads as `pages` once at load (*my call*: old files and the stored
  document still open).

## Testing

Core: `assemble`/`apply` reject a slot naming an unplaced pod; accept view slots and any layout/meta; removing a pod
with a slot still naming it is invalid; `deployment()` omits layout/meta; `applied` reports page changes; replay
re-applies them. Workspace: structure goes through apply (a pick is one `next`), arrangement doesn't (no `applied` on a
drag), undeploy removes slots in the same `next`, save/load round-trips layout and meta, a pod's `deploy` with pages is
asked, `layout.pages` documents still load. Then a hand check and the e2e run.

## Settled after the builder check (my calls)

- **Core keeps slots only.** A page in a document is `{ slots, layout?, meta? }`; core validates `slots`, lets `layout`
  and `meta` pass unread, and keeps, diffs and returns (`deployment()`) only `{ slots }`. The host takes `layout` and
  `meta` from the document it loads or applies.
- **Structure is anything that changes a page's slots:** adding or removing a page, a panel opened or closed (in the
  dock or a template position's ✕), a pick, Save as workspace (a new page), Restore to a restore point whose panels
  differ, and migration placing old pods. Each is one `apply`. **Arrangement** changes no slot: drags, splits'
  geometry, template switches, swaps, parks (a parked panel keeps its slot), titles, icons, order, restore points.
- **No drift between the two writers.** Slots come only from `app.deployment()`; the host keeps `layout`/`meta` by page
  id and, on every `applied`, drops them for pages no longer there. A dock writes its `layout` only after its slot
  `apply` succeeded (a refused or waiting apply leaves layout as it was). Saving composes slots from `deployment()`
  and `layout`/`meta` only for page ids that exist there.
- **Pages added by a pod or an import** bring their `meta`/`layout` in the document; the host keeps them for the new
  page ids (the only other way meta is written). `HostDeploy.deploy`'s `Addition` gains `pages`; `undeploy`'s `Removal`
  gains `pages` (ids); `onConflict: 'overwrite'` replaces a page and its meta. The approval summary names pages and
  slots added, removed or replaced.
- **Workspace rules stay the workspace's:** Main first and not removable, the fixed routes, order (`meta.order`), and
  an imported Main filling a Main that shows only views are applied by the host to every `next` it builds or receives
  (its own, an import's, a pod's) before `apply`. Core knows no Main.
- **Applies queue behind an open approval** (up to 20 s): accepted; a panel close waiting then is rare and visible.
- **Every structural change is an `applied` and a history entry** (each pick or close): accepted, as the price of one
  write path; `runtime(id).listen` keeps dropping page-only applies (pages aren't per runtime).
- **Import edits** (`renameRuntimes`, `selectPods`) rewrite and drop page slots too, so an import never fails on a slot
  naming an unselected pod.
- **nano-ui:** `LayoutSlot`, `LayoutBox`, `LayoutData` stay for reading old documents; the legacy reading (`pagesOf`'s
  job) moves into the workspace, internal; `geometry` becomes engine layout (in a page's `layout`).
- ADR-0037 supersedes ADR-0032's "pages in `layout`" and ADR-0033; the files citing ADR-0032 move to ADR-0037.

## Open (for the user)

- How the Application holds pages, and the `applied` event's page field (both public core API; see the conversation).

## Left to the builder

How the host keeps layout/meta beside `app.deployment()` (one object, merged on save); the approval summary's wording.
