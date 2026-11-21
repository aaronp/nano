# The host core, and a simpler data model

Builds on `2026-11-21-outline-design.md` (ADR-0040), ADR-0039, ADR-0031 and the overlap report
(`docs/second-host-overlap.md`). New record ADR-0041. Diagram: https://claude.ai/artifact/5i8G9GoLerTEXS4USXNNi3

## Intent

Three layers own one kind of data each and reference the layer below by coordinates: **nano-core** (the system),
**the Outline** (the logical tree of pages and slots), **hosts** (presentation). Between the Outline and the hosts sits
a framework-free **host core** that every host shares: where the live system meets the documents. This step builds
the host core and, with it, removes what review found dishonest or accidental in the model (user: "yes" to all seven).

Goals: core's document holds only the system and how it gets its code; the Outline is pure data and functions; one
host document under one storage key; the shared mechanics written once; the workspace's special rules mostly gone.
Non-goals: host capabilities (approval, trust, import dialog, host pods) in the host core (boundary A, user's choice);
a CLI. Anti-goals: presentation in core's document; live behaviour in the Outline; rules that exist only because two
namespaces collide.

## 1. Core's document: presentation out, code location in

`AppDeployment` loses `views` and `layout` (presentation). It keeps `modules` and `frames` (where the system's code and
sandboxed pages come from; `Application.load` needs them). The shape check refuses `views`/`layout` from then on; a
document carrying them is split by the host core when read (below).

Core exports its loader, today internal (`application/load.ts` `loaded(url)`, URL only, keeps only each module's
default `Provider`), as:

```ts
Registry.load(modules: Record<string, string>, base: string | URL):
  Promise<NanoResult<{ registry: Registry; exports: Record<string, Record<string, unknown>> }>>
```

`exports` is each module's namespace (a web host reads `views` from it; a CLI ignores it). `Application.load(url)` is
rebuilt on it. (*Name to confirm: it is new public core API.*)

## 2. The Outline: pure data and functions

`@pritzlaff/nano-outline` keeps the document, `parse` (with tree validation), `movedPages`, and gains a pure
`resolve(outline, page, deployment, registry)`. `Outline.create` (the live object: holding the app, listening for
`applied`, `open` starting pods) moves to the host core. `HostOutline` (the nano interface) stays in the Outline package.

**Slots become host-neutral**: `{ kind: 'view', view: '<custom-element tag>' }` becomes
`{ kind: 'tool', tool: '<id>' }`, an abstract tool a host maps (the workspace maps `systems` → its explorer, `wiring`
→ Connections…; a CLI could map `systems` to a listing; a host without that tool shows it as unavailable) (*my call*,
over moving pod-less tools into hosts' `layout`: they stay part of the shared structure). Existing view slots are read
once into tool slots by a table the workspace owns.

## 3. The host core (`@pritzlaff/nano-host`, framework-free)

Depends on nano-core and nano-outline. Its document, stored under **one key** and written as one file:

```ts
type HostDocument = { app: AppDeployment; outline: Outline; host?: { views?: Record<string, string>; layout?: Record<string, unknown> } }
```

API (sketch; final names in the plan, each an internal helper unless public by nature):
- `Host.boot(storage, opts)` → `NanoResult<Host>`: read the document (migrating old forms, §6), `Registry.load` its
  modules, `Application.create`, parse the Outline. `opts` carries the host's own hooks (approve, confirm foreign code)
  so trust and approval stay with the host.
- `host.app`, `host.registry`, `host.document()`, saving on every change, the another-tab guard (one key).
- `host.outline`: `apply(next, { base })`, `listen(change)` (added, removed, changed, moved, resolved), `resolve(page)`,
  `open(page)` (`getOrCreate` per resolved pod; the one start path).
- `host.pick(page, implementation, runtime)`: deploy a lazy pod (free name, starting config, host access in a `rules`
  runtime, one at a time), auto-connect, then add a `pod` slot.
- Page edits as functions returning the next Outline: add page (root or child), remove (subtree), move, title,
  add/remove slot.
- `host.replace(doc)` and `host.import(doc, title)` (§5).

Stays in each host: drawing, trust and import dialogs, approval UI, host pods, history.

## 4. Routes: every page at `#/p/<id>`

Pages and the app's own screens no longer share a namespace: every page is `#/p/<id>`, the app's screens keep their
routes (`#/ring`, `#/desk`…). `FIXED`, the reserved-id remap, the reserved-id refusals and the id-generator guard go.
Main stays the workspace's first root, not removable, at `#/p/workspace`; `#/workspace` redirects there.

## 5. Open replaces; Import adds a subtree

- **File › Open** (and `?src=`) replaces the whole host document (asking first when the current one has unsaved
  changes). This **reverses** the earlier rule "?src= imports into the stored document as File › Open does" (*for the
  user to confirm*); New then Open restores a saved file exactly.
- **File › Import** adds the file's system (as today) and its Outline as **one new root page named after the file**,
  its roots as that page's children (ids suffixed where taken). The rules for "identical", "fill an empty Main", Main's
  children and legacy titles go.

## 6. Legacy readers, with a removal date

Old forms (the old storage keys, `{ app, platform }`/`{ app, outline }` files, flat documents, `layout.pages`,
`meta.workspace.order`, view slots, `views`/`layout` in an app document) are read by one migration module in the
host core into a `HostDocument`. They stay until **the release after this one**; then a separate change deletes them
(*my call*: one release for stored data to move).

## Testing

Core: `Registry.load` (modules, exports, failures), `Application.load` unchanged, `views`/`layout` refused.
Outline: pure `resolve`, tool slots. Host core: boot from each old form, one key and the another-tab guard, pick,
page edits, open/re-open, replace, import as subtree. Workspace and React host rebuilt on the host core: routes at
`#/p/<id>`, the old `#/workspace` redirect, both hosts sharing one document. The React host's size before and after is
the measure of what the host core took.

## Settled after the builder check (my calls)

- **Loading stays the host's to police.** `Host.boot` takes the host's loader (`opts.load(modules, base)`), which the
  workspace fills with its existing gated path (probe, confirm foreign code, sandbox stand-ins, ADR-0034); the
  default is core's plain `Registry.load` (trusted documents only, as `Application.load`). `opts` also carries
  `isolate`, `deploymentPolicy`, the host's own providers and its host pods (placed in `main` and left out of
  `document()`), so boot is the workspace's `host.ts` `start` generalised, not replaced.
- **`frames` stays in core's document** because a `home-origin` pod can't run without its frame (corrected reason:
  `Application.load` only shape-checks it). `app.deployment()` returns pods, runtimes and tags only, so the host core
  keeps `modules` and `frames` beside the live app, as `host.ts` does today.
- **`host.views` is the per-pod override** (pod → view tag: the app bar's view picker). A module's `views` export
  (implementation → tag) is `Registry.load`'s `exports`, not stored. The host core drops overrides for pods that go
  (on `applied`). nano-ui's `viewFor` takes the override map as its own argument instead of reading `deployment.views`.
- **`host.layout` is keyed by client** (ADR-0039's rule): the workspace's Desk at `host.layout.workspace.desk`, its
  Ring filter at `host.layout.workspace.ring`.
- **Legacy readers:** the host core reads the generic old forms (the two old keys, flat outlines, `views`/`layout`
  inside an app document); the workspace supplies a hook for its own (dock keys, `meta.workspace.order`). Tool ids for
  today's widgets: `systems` (explorer), `wiring`, `activity`, `chart`, `metrics`, `gallery`, `notes`.
  `Outline.parse` reads a `view` slot as a `tool` slot of the same id until the removal date.
- **Main stays a workspace rule**, recreated at boot if a document lacks it (as now); another host may remove or move
  it.
- **Open = store and reload.** Open writes the new document under the one key and reloads the page: a fresh registry
  and history, no stale providers. It asks first ("Replace your workspace with <file>?"), since autosave means there is
  no separate unsaved state. File › Examples adds, like Import.
- **Imports follow the dialog's edits:** `host.import(doc, title, edit)` takes the renamed runtimes and dropped pods and
  rewrites the subtree's pod coordinates.
- **Routes:** a hash rewrite before app-shell's first route turns `#/workspace` into `#/p/workspace`; links in
  `index.html`, `boot-wiring` and the nav move to `#/p/workspace`. Other old page bookmarks (`#/<id>`) rewrite to
  `#/p/<id>` when `<id>` is a page.
- **The storage key** is `nano-host.document`; the downloaded file is exactly a `HostDocument`. "The release after this
  one" is the next nano-core version after the one that refuses `views`/`layout` (that refusal is breaking: 0.5.0).
- **Order of work: eight plans**, each green on its own: (1) routes; (2) core exports `Registry.load`, no shape change;
  (3) the Outline: pure `resolve`, tool slots; (4) the host core, with the React host moved first; (5) the workspace on
  it; (6) Open and Import; (7) core refuses `views`/`layout`, examples converted; (8) delete the legacy readers, a
  release later.

## Decided by the user

- **Examples become two files**: `nano.json` (the system, still read by `Application.load`) and `outline.json` (its
  pages); the workspace's Examples menu reads both. Refusing `views`/`layout` in core ships as nano-core 0.5.0.
- **`?src=` adds** the file as a new root page (as Import), never replacing the workspace.
- **Names approved**: `@pritzlaff/nano-host`, `HostDocument`, `Host.boot`, `Registry.load(modules, base)`, the Outline's
  pure `resolve(outline, page, deployment, registry)`, the `tool` slot kind. The spec's earlier "?src= replaces"
  (§5) is superseded by this; Open (File › Open) replaces, after asking, by storing and reloading.

## Decided by the user (plan 5)

- **`host.apply(app)`**: the host core's apply of an app document. It loads modules the registry lacks (through the
  host's loader), applies the system, and records `modules`/`frames` as the document's code locations. The one place
  where "which code runs" changes, as `outline.apply` is for pages.
- **`opts.load(modules, base, app)`**: the host's loader also receives the app document, so a trust prompt can show each
  foreign pod's isolation (ADR-0034).
- **`host.deploy(implementation, runtime)`**: the system step of a pick (free name, the implementation's starting-config
  default, host access in a `rules` runtime, one at a time, auto-connect), its pod's name, no slot; `host.pick` is
  `deploy` then `addSlot`. The workspace's wires editor (the rack, also on `#/desk`) and its dock's picks deploy with it.
- **`connect(deployment, registry, pods)`**: pure, exported by the host core; several pods, a dependency already met by
  an existing call edge skipped, `{ deployment, notes }`. It replaces the workspace's `auto-connect.ts` (its import,
  Change implementation and old-page migration use it); `deploy` uses it.
- **`host.deploy(implementation, runtime)` → `{ name, notes }`**: the system step without a slot (a free name, the
  starting config, host access, auto-connect); `notes` are `connect`'s (connected and still-needed), so a host can show
  them. `host.pick` is `deploy` then `addSlot`. **`connect(deployment, registry, pods)`** (pure) is exported.
