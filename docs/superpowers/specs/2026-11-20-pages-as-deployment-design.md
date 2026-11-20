# Pages as deployment data, explicit pod start, and the picker grid

Revises `2026-11-19-nav-edit-and-layout-picker-design.md` (which stands where not revised) and the "Views and layout"
convention in `design.md`; supersedes D70 ("there is no `start()`").

## Intent

What the user builds in the workspace (pages, their layouts, which pods sit where) should be **deployment data**, not
the workspace's private state: one document a different front-end (say a React host with its own look) could load and
show. Changes in the UI update that data; a host capability sets and loads it, and the host persists it. Opening a page
is a data-driven, explicit act: it starts the lazy pods the page needs and reuses those already running, never making
duplicates.

Goals: pages (containers of slots) in the deployment; `start` / `getOrCreate` on a runtime, explicit; a `HostPages`
capability; the workspace driven by the deployment (a reload loads it; no private pod or layout keys); the picker as an
inline grid of deployable components grouped by provider, with a runtime selector.
Non-goals: a second front-end (only that one could be written); creating runtimes from the picker; persisting pod
state (nano holds none, D71).
Anti-goals: a subscription starting a pod as a side effect; a second way to call a pod; layout data tied to
golden-layout or the workspace (engine state stays under the engine's own key, as now); pages that copy pods.

## What exists, and the gaps

| Need | Carried by (existing) | Gap filled here |
|---|---|---|
| system as data | `AppDeployment` (pods, runtimes, tags), saved as `nano.json` | — |
| a pod's web component | `views` (provider's, or the deployment's override) | — |
| what is on a page | `layout.slots` (`LayoutSlot { id, runtime, pod }`), `layout.geometry`, engine state beside them | one page only → `layout.pages` |
| changing the system | `HostDeploy` (`deploy`, `undeploy`), approval policy | — |
| changing pages | nothing | `HostPages` |
| persisting | File › Save writes `host.saved()` | the host saves the document as it changes, and boots from it |
| starting a lazy pod | only a call builds it; subscribing does not (`connection.ts`) | `start`, `getOrCreate` |

## Sources of truth (the boundary this design keeps)

Presentation depends on the system, never the reverse. Each fact has one owner; everything else reads it.

| Fact | Owner (the one truth) | Changed only by | Presentation's relation to it |
|---|---|---|---|
| which pods exist, where placed, wired, policed | the `Application` (its `AppDeployment`) | `app.apply` (the host's own changes, `HostDeploy`) | reads it; never writes it |
| whether a pod is running, and who started it | the `Application` (`status`, `start`, `getOrCreate`, the event stream) | `start` / `getOrCreate` / a call | asks; never records or infers it (no "started by page" bookkeeping) |
| which pages exist, their titles, icons, order, slots | `layout.pages` | `HostPages` (the workspace UI writes the same data) | is it |
| how one engine arranges a page | that engine's key on the page (`workspace`) | the engine | a hint under the slots: slots win |
| what is persisted | the host's stored document (`saved()`) | the host, on `applied` and page changes | written from the two owners above, never a third copy |

Consequences, stated so a builder can't blur them:
- A pick is **two separate steps**: deploy the pod (system: `edit(...).place` then apply), then add a slot (presentation:
  `setPage`). The picker does not know how pods are made; the deploy step does not know about pages.
- Opening a page asks each slot's runtime `getOrCreate`; the answer (`started`) is used for nothing but display. Pages
  never start, stop, count or remove pods, and closing a panel removes a slot, not a pod.
- When the system removes a pod, pages follow it (slots pruned on `applied`); a page change never changes the system.
- Nothing in nano-core knows about pages; `layout` stays opaque to it.

## Approaches

Where pages live:
1. **In `AppDeployment.layout` (picked).** One document holds the system and its pages; saved, exported, imported and
   loaded together. Core already only shape-checks `layout`, so core's model is unchanged by it.
2. A separate presentation document pointing into an `AppDeployment`: several front-ends could own different pages over
   one system, at the cost of two documents in step and slots naming pods that no longer exist.

Who changes pages: 1. **a new `HostPages` interface (picked)**: rearranging is not deploying; 2. `HostDeploy.deploy`
taking `layout`: one approval path, but a drag becomes a deployment.

Starting lazy pods: 1. **explicit `start` and `getOrCreate` on a runtime (picked, the user's)**; 2. a subscription
builds its lazy source: rejected, a surprising side effect; 3. the host "pings" each pod: there is no op every pod has.

## Part 1 — Core: `start` and `getOrCreate` (nano-core)

On the live view of a runtime (`app.runtime(id)`, a `RuntimeView`, beside `resolve`, `call`, `subscribe`, `listen`,
`status`); not on the `Runtime` value, which holds no instances.

```ts
start(pod: string): Promise<NanoResult<void>>
getOrCreate(pod: string): Promise<NanoResult<{ started: boolean; pod: Client }>>
```

- `start(pod)` is a **message**: a new kind `start`, `sent` from `'host'` to the pod in that runtime, then
  `delivered` or `denied`, asked of the runtime's policy like any message (a new `Ask.kind` and `sent.kind` value;
  `lifecycle` keeps its meaning) (*the user's*). It builds a placed pod that is not running (`not started`, or
  `failed`), the build traced `built` / `failure` as now. Refusals: `not-found` (not placed in this runtime),
  `invalid-input` "already running", `denied`, or the build's own `Fail`. A call still builds a lazy pod on the way
  (a call is a use, decided by the policy as a `call`).
- `getOrCreate(pod)`: running → `{ started: false, pod }` at once; otherwise `start(pod)` then `{ started: true, pod }`;
  its failures are `start`'s. `pod` is exactly `call(pod)`'s client (no second way to call; each call through it is a
  message from `'host'`, policed as now).
- Races: one build per pod however many callers (the existing once-only build). Of two `getOrCreate` racing on a
  stopped pod, one gets `started: true`, the other `started: false`, both once the build settles.
- `app.start(runtime, pod)` / `app.getOrCreate(runtime, pod)` are not added (the per-runtime form is the one way; the
  application's one-runtime shorthands follow existing practice only if the builder finds them already uniform — *to
  confirm with the user*).
- Subscribing still never builds a pod.
- A new decision record supersedes D70, with the trade-off (explicit start vs. "describing costs nothing").

## Part 2 — Pages in the layout convention (nano-ui, `packages/ui/src/layout.ts`)

```jsonc
"layout": {
  "pages": [
    { "id": "trading", "title": "Trading", "icon": "chart",
      "slots": [{ "id": "a", "runtime": "main", "pod": "clock1" }],     // existing LayoutSlot
      "geometry": { "a": { "x": 0, "y": 0, "w": 1, "h": 1 } },          // existing LayoutBox, optional
      "workspace": { /* the workspace engine's own state: golden-layout config or template, parked */ } }
  ]
}
```

- A **page** is the container of its slots. Its `id` is its coordinate, fixed when the page is made (slugged from its
  first title, lower-case and dashes, `-2`… on a clash) and never changed by a rename: the route is `#/<id>`, so a
  saved `open({ id })` keeps working. The title changes freely (*the user's*). Pages are independent: two may name the same pod (one instance, shown twice) or lay it out
  differently.
- The array's order is the nav's order. `title` is required; `icon` is a name the host interprets (another front-end
  maps or ignores it).
- Every panel on a page is a slot, including panels the workspace's template parks (parking is engine state). A slot
  is either a pod's (`{ id, runtime, pod }`, the existing `LayoutSlot`) or a host view's (`{ id, view }`, a
  custom-element tag such as `nano-explorer`, no pod; another front-end shows it if it has that view, else skips it)
  (*the user's*).
- **Slots are the truth; engine state is a hint** keyed by slot id. On load an engine places slots its state doesn't
  mention (split in) and drops entries with no slot, so a page changed by a pod or another front-end shows (*the user's*).
- The previous single-page `slots` / `geometry` at the top of `layout` read as one page with id `workspace`, titled
  "Workspace" (*my call*: old documents and `examples/todo/side-by-side.json` keep working).
- Typed as `Page` and `LayoutData.pages` in nano-ui; shape-checked when read (a bad page is dropped with a warning,
  not fatal; *my call*).

## Part 3 — `HostPages` (nano-ui interface; the workspace implements it)

```ts
HostPages = ns.interface('HostPages', {
  pages:      Op.action(Nothing, Page[]),
  setPage:    Op.action({ page: Page, index?: number }, Nothing),  // adds or replaces by id; index moves it
  removePage: Op.action({ id: string }, Nothing),
  open:       Op.action({ id: string }, Nothing),                  // shows the page (Part 4's opening)
})
```

- The workspace places it in `main` as pod `pages`, beside `ui` and `deploy`, never saved (host pods, as now).
- A pod calling `setPage` / `removePage` is asked through the existing approval (`approve`, a one-line summary); the
  workspace's own UI writes the same data directly, unasked (as its picks do today).
- `setPage` with a slot naming a pod not placed in that runtime is `invalid-input` (pages never place pods; deploying
  stays `HostDeploy`).
- Persistence: the host keeps the document (`saved()`: the deployment, modules, views, layout) in its storage on every
  `applied` and every page change, and boots from it, the shipped default when there is none (*builder's call*: the
  storage key and debounce). File › Save / Open still write and read `nano.json`, pages included.
- Trust at boot: the stored document is the app's own (same origin, written by it) and loads without asking; a
  foreign provider's code still asks once per session, as now; `?src=` imports into the stored document as File ›
  Open does, never replacing it (*the user's*).

## Part 4 — The workspace driven by the deployment (ui-workspace)

- Nav rows, routes and docks come from `layout.pages`: one page each; `+` adds one (`setPage`), edit mode renames
  (only the title: the id, and so the route, is fixed by `slugPath` when the page is made, as Part 2 says), changes the icon, reorders (`index`); Main is the page
  `workspace`, first. The localStorage keys of saved pages, per-dock layouts and template state go; on first boot after
  this change they are read once into `layout.pages` (*my call*), then removed.
- A dock's state is its page's `workspace` key; its panels are the page's `slots`. Every change (split, close, drag,
  template switch, swap, park) rewrites that page.
- **A pick deploys, then places a slot** (two steps, see Sources of truth): the chosen implementation is placed as a
  new **lazy** pod in the selected runtime (Part 5) (*the user's*: the page that shows it starts it), then a slot for
  it is added to the page, which opens it (`getOrCreate`).
  Pods are in the deployment, so a reload has them: `addPod`'s "remake under the stored name" and boot-time remakes go.
- **Opening a page**: for each slot, `app.runtime(slot.runtime).getOrCreate(slot.pod)`; a `started: false` pod is
  reused, a lazy one started; a failure shows that slot's error in place (the rest open). Opening a second page naming
  a running pod starts nothing.
- Closing a panel removes its slot, not its pod (as now; removing pods stays an explicit undeploy).
- Panels that are not pods (Systems explorer, Wiring, Messages, notes) are view slots (Part 2).

## Part 5 — The picker as a grid with a runtime selector

- Empty positions and an empty dock show the picker **inline** (filling the place) instead of a lone `+`; a panel
  header's `+` keeps the popover with the same content.
- Top: the filter (focused), then **Runtime:** pills, one per runtime in the deployment; the chosen one is where a pick
  is placed. It starts on `main` and remembers the last choice for the session (*my call*). No "new runtime" pill.
- Grid of tiles grouped by **provider** (nano.ui first, then each imported package, its ✕ remove and failed imports as
  now), then **Views** (host views; a pick adds a view slot, no pod, so the runtime pills don't apply). The "Hidden" (parked) section stays first
  when opened from an empty position.
- Keyboard: arrows move between tiles, Enter picks, Esc closes the popover form (the inline form has nothing to close).

## Testing

Core: `start` (built, already running, not placed, denied, failed then started again), `getOrCreate` (both `started`
values, racing callers, the client is `call`'s), a subscription still not building. nano-ui: `Page` shape, the old
single-page layout read as page `workspace`. Workspace: pages round-trip through `HostPages` and storage; a reload
reopens the same pods (no new names, none remade); opening page 2 after page 1 starts nothing shared; a pick places in
the selected runtime; migration of the old keys; the grid filter, groups and pills. Then a hand check in the built page.

## Left to the builder

Visuals of the grid, tiles and pills; the storage key and save debounce; how the dock maps engine state to slots.

## Settled after the builder check (my calls)

- No `app.start` / `app.getOrCreate` shorthands: `Application` is at the 10-member cap, and `status` has none either.
- The new decision record supersedes D70 and the "no `start()`" lines in D90, D98, the model spec and the design.md
  FAQ, saying the old rule was about the application; the new `start` is per pod and explicit.
- Main (`workspace`) is fixed: first, not removable (`removePage` refuses it, `setPage` cannot move it); its title and
  icon can change.
- Page ids may not be the fixed routes (`ring`, `desk`, `settings`, `systems`, `messages`, `components`, `themes`,
  `inbox`): `setPage` refuses them, `invalid-input`.
- Top-level `layout` after this: `pages`, plus the other features' own keys (`desk`, `ring`) unchanged. The old
  `layout.workspace` (Main's golden-layout state) moves into page `workspace`'s `workspace` key; the `ws_<path>`
  docks' state into theirs.
- A slot whose pod is removed (by `undeploy` or an apply) is pruned from every page on `applied`, and the page saved.
- A page is opened when it is shown (navigation, or `HostPages.open`), not at boot; a hidden page's dock mounts on
  its first visit. Only the shown page's slots are `getOrCreate`d.
- A pick places its pod through `AppDeployment.edit(...)` (`place`), which lets it into a `rules` runtime as the
  existing code does, instead of `addPod`'s hand-built runtime.
- `pages` joins `ui` and `deploy` as a host pod, with the same handling of a clashing imported name. `HOST_PODS`
  becomes three.
- Page changes from a pod ask `HostUI.approve` directly (a new path: `layout` is not applied through `app.apply`, so
  the deployment policy doesn't see it), with the same 20 s no-answer rule.
- "Save as workspace…" survives as a page copy: same slots, so the same pods; it starts no new ones.
- Persistence, boot and `HostPages` go in new files (host.ts is at its baseline). The picker, panels and pages files
  split as they grow past 150 lines. `Page` and `HostPages` go in design.md, and its "Views and layout" paragraph is
  rewritten.
