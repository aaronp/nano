# The Outline: a logical tree of pages, independent of how it is drawn

Revises `2026-11-21-platform-design.md` (ADR-0038) and ADR-0039; new record ADR-0040. Renames the Platform to the
**Outline** and its document from UIDeployment to `Outline`, and makes pages a tree.

## Intent

A user designs a set of pages (a trading app, chat, support, a dashboard) that form a menu hierarchy, each page
holding components (pods). That hierarchy and what each page contains is a **logical model**: any front-end (a web UI
in React or Svelte, a CLI menu) could present the same structure its own way. It is separate from how anything is
drawn. Three layers, each with one job:

- **nano-core** — the system: pods, runtimes, interfaces with their ops and schemas. UI-agnostic; the stable core.
- **The Outline** (`@pritzlaff/nano-outline`) — the logical structure: a tree of pages, each page's slots naming pods.
  UI-agnostic.
- **A host** (the workspace, the React host, a CLI…) — presentation: which pages it shows as screens, how a pod looks
  (any host can present a pod from its interfaces; a web host may use a provider's element), its own state under its
  own `layout`/`meta` key.

We are not building a CLI; the model must make one possible in principle (the user's test).

Goals: the rename; a tree with stable page ids and shared order; the workspace and the React host showing the same
tree. Non-goals: a CLI; moving views or host fields into core (see "What this changes elsewhere"). Anti-goals: page
ids that change when a page moves; order or grouping that only one front-end knows.

## Approaches (decided with the user)

- Tree: **a tree** (picked) over flat pages, or flat pages with one level of groups.
- Storage: **a flat map with child lists** (picked) over nested pages (ids would be paths, and moving a page would
  break routes, bookmarks and `open({ id })`).
- Name: **Outline** (picked) over Topology (confusable with runtime wiring) and Site/SiteMap (web-leaning).

## The model

```ts
type Outline = { roots: PageId[]; pages: Record<PageId, Page> }
type Page = { title?: string; children?: PageId[]; slots: Record<SlotId, Slot>; layout?: unknown; meta?: unknown }
type Slot = { kind: 'pod'; pod: PodCoord } | { kind: 'select'; select: SelectorData } | { kind: 'view'; view: string }
```

- Ids follow the `Coord` id rule and never change when a page moves. Order is `roots` and each `children` list:
  shared structure, not a client's `meta`.
- **`apply` refuses** (`invalid-input`, naming the page) a document where a listed id has no page, a page appears in
  more than one place (twice in `roots`/`children` lists combined), a page is its own ancestor, or a page is in
  `pages` but in no list (an orphan) (*my call*: the structure is always a tree; a client removes a page by removing
  it from its parent's list and from `pages` in the same `next`).
- Unchanged from the Platform: one synchronous `apply(next, { base? })` with a change report; `resolve` and `open`
  per page (a page's own slots only, not its children's); dangling slots resolve `missing`; selector matches; `title`
  shared (ADR-0039); `layout` and `meta` keyed by client.
- `HostPlatform` becomes `HostOutline` (same ops and version check; the Main and reserved-id guard stays the
  workspace's).

## The workspace and the React host

- **The workspace's nav shows the tree**: roots as top-level rows, children indented beneath (expandable); each page
  is a route `#/<id>` (or `#/p/<id>` for a reserved id) and has a dock. Reorder and move (drag a row onto another to
  make it a child, or between rows) edit `roots`/`children`. `+` adds a root; a page's row offers "add child". Removing
  a page with children asks, then removes its subtree (*my call*; the Outline itself only validates). Main stays the
  workspace's rule: a root, first, not removable. `meta.workspace.order` goes (order is the tree).
- **The React host** shows roots as tabs and a page's children as a second row of tabs; adding a page adds a root (or
  a child of the shown page).

## Migration

A stored UIDeployment (flat pages) becomes an Outline once at boot: every page a root, in the workspace's order
(`meta.workspace.order`, Main first), `children` empty; `meta.workspace.order` dropped. The storage key changes from
`nano-workspace.platform` to `nano-workspace.outline` (the old key read once, then removed after a good save); the
file bundle becomes `{ app, outline }`, and Open still reads `{ app, platform }` and plain `nano.json`.

## What this changes elsewhere

The layers also settle the open "move down" list (`docs/second-host-overlap.md`): provider **views** and the host
fields (`views`, `frames`, `layout`) are presentation, so they do **not** move into nano-core's Application; mounting
a view is a web-host helper (nano-ui), not shared host core. The shared host core (persistence, boot, the pick, page
edits, opening) is planned after this change, against the Outline.

## Testing

Outline: `apply` accepts a tree and refuses each malformed shape (missing id, duplicate place, cycle, orphan);
moving a page keeps its id; resolve/open unchanged; parse/serialise round-trip. Workspace: nav shows the tree, drag
to reorder and to nest, add child, remove a subtree after asking, routes stable after a move; migration from a flat
stored document and from `{ app, platform }` files. React host: two-level tabs. Both hosts show the same tree. Then a
hand check and the e2e run.

## Settled after the builder check (my calls)

- **Flat documents still parse.** `Outline.parse` reads a document with `pages` and no `roots` (the Platform's shape,
  any client's stored copy) as every page a root, in document order. So either host can boot on old data first; the
  workspace then reorders its roots once by its old `meta.workspace.order` (Main first) and drops that key. The storage
  key `nano-workspace.platform` is read when `nano-workspace.outline` is absent, and removed by the workspace only
  after a good save (the React host reads the new key first, the old as a fallback). Every path that builds a document
  (`toPlatform`, `keyed`, `opened`, `bootPages`, `slotsEdited`, page edits in both hosts) emits `roots` and keeps lists
  in step; new pages are added to a list.
- **Main** is a workspace rule: the first root, not removable, and it may have children. The workspace's `refusal`
  (its own writes and HostOutline's) refuses a `next` where Main is missing, not a root, or not first; at boot a
  document breaking that is repaired (Main moved to first root), not refused. Main's nav row becomes a synced row like
  the others so its children can show.
- **Expanded/collapsed rows** are local UI state (not in the document): no apply per toggle. A collapsed parent of the
  current route opens.
- **Keyboard:** Alt+↑/↓ moves among siblings; Alt+→ makes a page the last child of the sibling above; Alt+← moves it
  out to follow its parent. Each move is announced (as reorder is today).
- **Removing a page** is new: in edit mode a row offers Remove; a page with children asks "Remove <title> and its N
  pages?", then removes the subtree (pods untouched). The route of a removed page goes to Main (as now).
- **Save as** copies the page only (not its children), as the next sibling of the source.
- **Imports into a tree:** an incoming page whose id is suffixed is renamed in the incoming lists too; incoming roots
  are appended to `roots`; an incoming child of a page kept as identical is appended to that page's `children`
  (identical compares a page without its `children`); a Main filled by a file keeps its current children and appends
  the file's Main's children; incoming pages otherwise keep their incoming parent.
- **React host:** a row of tabs per level along the shown page's path (roots, then that root's children, and so on);
  "+" adds a child of the shown page, "+ top" a root.
- **Renames:** package `@pritzlaff/nano-outline` (folder `packages/outline`), `Outline.create` / `Outline.parse`,
  namespace `nano.outline`, `HostOutline` (its schemas keep `DocAt`/`ApplyAt`), the host pod `outline`
  (`HOST_PODS` = ui, deploy, outline), the bundle key `outline`. The approval summary also names pages moved.
- **Size:** the nav's tree rendering and its move/drag/keyboard code split into their own modules (internal helpers in
  lib/pages.ts: walk, move, subtree, parentOf), agreed here, not found during the build.

## Decided by the user

- **The change report gains `moved`**: the pages whose place changed (new parent or new position among siblings);
  a parent whose only change is its `children` list is not `changed`. A `roots`-only change is reported (its pages
  `moved`) and bumps the version.
- **`HostOutline` declares a `changed` event** (`{ added, removed, changed, moved }`) beside `document` and `apply`;
  the host pod publishes what the library reports, so components follow the tree through nano subscriptions. The host
  stays the operator outside the system (design.md; ADR-0001): what components see is nano declarations.
