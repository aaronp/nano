# The Application: one pure entrypoint, app-wide tags, and screens as data

## Why

Nano will have more than one host app. `ui-workspace` is the first; others will change the layout (and may have no
golden-layout at all) but should reuse almost everything else. Today they couldn't: setting up the system lives in
`ui-workspace/src/composable.ts`, saving and loading nano.json in `ui-workspace/src/app/`, and the pure pieces that exist
are split across packages that also hold Lit UI (`shell`, `platform`).

The connection views are about to get better, and they need a clear model to query: which components are on which
screen (the saved workspaces), and which carry a given tag. Neither can be asked today. A screen's contents are hidden
in golden-layout's JSON, and tags are per-registry labels that a save drops.

## Goals

- **One pure entrypoint**, the `Application`, in a new package. It creates the host runtime and owns everything app-wide:
  the systems (registries and runtimes), the catalog, the screens and what's placed on them, and the app-wide tags. It is
  the query surface for all of it.
- **Tags as a pure data structure:** a generic many-to-many index between tags and items, queryable both ways ("what's
  tagged X", "what tags does Y have").
- **Screens as plain data**, with no UI types: each has an id, title, icon, system and placements.
- **Host contracts:** what a host must or may implement (the app bar, focus, alerts, deploying a component) are ops
  defined by the pure package. Each host implements them in its own way.
- **Easy new hosts:** a new host calls one function with its catalogs and contract implementations, chooses its layout,
  and reuses the host UI kit.

## Non-goals

- Redesigning the connection views. They come next, built on this model; this design only makes the questions they
  need answerable.
- Changing what the user sees. Behaviour stays the same; this is a re-layering, plus tags and placements.
- A second host. The design must allow one, but building it isn't part of this work.

## Anti-goals (failure even if it works)

- The pure packages import Lit, the DOM, golden-layout or any host UI type.
- A new host still has to copy setup or save/load code out of `ui-workspace`.
- Two sources of truth for the same fact: tags kept in both the registry and the application, or systems copied
  between the platform and the application.

## Package layering (agreed)

| Layer | Package | Holds | Depends on |
|---|---|---|---|
| Pure data | `@pritzlaff/nano-core` | Registry, Runtime, Ops, Components; **`Tags`** (new) | typebox |
| Pure system | **`@pritzlaff/nano-app`** (new) | the `Application` entrypoint and component; systems (the pure part of today's platform); screens and placements; app-wide tags; queries; the nano.json schema, snapshot and apply; the host contracts | core, runes |
| UI binding | `@pritzlaff/nano-elements`, `@pritzlaff/nano-runes` | unchanged | core |
| Host UI kit | `@composable/shell` (renaming to `host-kit` is optional) | reusable Lit pieces: profile menu, File menu, app bar; the platform's views (`view.ts`, `table.ts`) move here or stay in `@composable/platform` | elements, nano-app |
| Host | `@composable/ui-workspace`, future hosts | layout (golden-layout here), page markup, and its own implementations of the contracts | all of the above |

Decided in conversation:
- The Application is a **new component**, not the platform grown.
- **The platform's pure logic folds into `nano-app`:** systems, create, add-to-system, remove, connect, disconnect,
  select. The Application owns the runtimes directly. `@composable/platform` keeps only its Lit views, or they move to
  the kit.
- **No UI-specific code in the Application.** Golden-layout's format is read only in `ui-workspace`.
- The name: **"Application"** in **`nano-app`**. "Platform" is taken by the systems component, and "Environment" is
  already a core type (`env.ts`), so neither is used.

## Tags (in core)

A generic two-way index, pure and synchronous:

```ts
type Tags<T extends string = string> = {
  tag(item: T, tag: string): void
  untag(item: T, tag: string): void
  tagged(tag: string): ReadonlySet<T>        // forward
  tagsOf(item: T): ReadonlySet<string>       // reverse
  remove(item: T): void                      // forget an item (e.g. an instance deleted)
  all(): ReadonlyMap<string, ReadonlySet<T>>
  listen(fn: (change: { item: T; tag: string; added: boolean }) => void): () => void
}
```

- **Tags are plain strings** (my call). A `key=value` convention can sit on top if someone wants it, but the index
  doesn't parse it. Plain tags are simplest to pick in a view.
- The registry's labels (`nano/deploy`, `nano/allow`, `nano/deny`) stay on the registry. They say how an instance runs
  in that runtime, and a label holds one value per key, which a tag set can't express. Whether the registry's index
  internally reuses `Tags` is left to the builder; nothing outside the registry may depend on it either way.
- **User tags live only in the Application**, never in a registry, so there's one source of truth.

## Item references

Everything that can be tagged or queried is named by a typed string reference:

- `system:<id>` — a system
- `instance:<system>/<id>` — an instance in a system. The same instance added to two systems has two references.
  Tagging is per reference (my call), which matches how the registry already treats it.
- `screen:<id>` — a screen, by its route path (`screen:/lab`)

`nano-app` exports a parser and builder for these (`ref.instance(system, id)`, `parseRef(s)`), and rejects malformed
ones.

## Screens and placements

```ts
type Screen = { id: string; title: string; icon?: string; system: string }
type Placement = { screen: string; panel: string; instance: string }   // instance in the screen's system
```

- **Every screen is a screen,** including the main Workspace page (it's filtered out of the document today).
- **The Application is the source of truth for screens** (my call; anything else breaks the "one source of truth"
  anti-goal). A screen holds its layout as an opaque value: `Screen & { layout: unknown }`. The host persists the
  Application's screens (it listens to `changed` and writes its storage); it no longer keeps its own workspaces list.
- **Placements are always known, even for screens never opened** (my call). The host passes a pure, synchronous
  `placementsOf(layout: unknown): { panel: string; instance: string }[]` to `createApplication`. The Application runs it
  whenever a screen's layout is set (by a dock saving, by apply, or at start-up), so queries never depend on which
  docks happen to be mounted. In `ui-workspace` it lives next to `dock-layout.ts` and is the only place outside
  golden-layout that reads its format. A host without layouts passes a function returning `[]`.
- Ops: `setScreen(screen)` (with its layout), `removeScreen(id)`. Placements have no setter; they always follow the layout.
- Placements are many-to-many: an instance can be on several screens or none, and a panel can show an instance that
  runs in a sandbox.
- The screen's layout itself stays the host's business. The Application doesn't hold it, but the document does (see
  nano.json below), as an opaque value the host provides and reads back.

## The Application

`createApplication({ catalogs, contracts })` returns `{ application, host }`: the component, already registered in the
host registry under the reserved id `application`, and the host runtime.

**What it owns:** the host runtime and every system's runtime; the catalog (merged, and grown by imports); screens and
placements; the app-wide tags; the selection.

**Ops** (ops, so views and other components can wire to it):
- **Systems:** today's platform ops, moved. **Ids change, with no alias** (my call): the instance is `application`,
  not `platform`, and the ops get the Application's own namespace. Documents can't wire into the platform (it's
  `HOST_DRIVEN`), so no saved document breaks; tests and views that name the platform are updated. The ops are `systems`, `kinds`, `catalog`, `createSystem`, `createComponent`,
  `addToSystem`, `removeFromSystem`, `connect`, `disconnect`, `select`, `selected`, `stateChanged`, `catalogChanged`.
- **Screens:** `screens` (source), `setScreen`, `removeScreen`, `setPlacements`.
- **Tags:** `tag`, `untag`, `tagsOf(ref)`, `tagged(tag)`.
- **Queries:**
  - `query({ screen?, system?, kind?, tag? })` returns instance references matching every given filter (AND).
  - `screensOf(instanceRef)`
  - `placements(screen)`
- **Changes:** a `changed` source fires for any change to systems, screens, placements or tags, saying which.

Queries across systems fan out over each registry and merge. Tag and placement queries are answered from the
Application's own indexes.

**Lifecycle** (my calls): the Application listens to every system registry's deltas, so an instance removed by any
route (an element going, a sandbox closing, `removeFromSystem`) loses its tags (`remove(ref)`). Its placements stay in
the layout, since the panel is still there, but queries only return instances that exist. Removing a screen removes its
tags. There is no `removeSystem` today and this work doesn't add one.

## Host contracts

The pure package defines these as ops (with typebox schemas); a host implements and registers them:

- **App bar and focus:** today's `AppGateway` (`setFocus`, `focused`, `setAppBarComponent`, `setAppBarDefault`). It
  moves from `shell` into `nano-app` as a contract, and keeps the reserved id `app` and its gateway behaviour (in every
  system, never removed). It's a contract, not a second "app".
- **Alerts:** `showAlert({ message, tone })`, which a host renders however it likes (toast, status line).
- **Deploy:** today's `DeployStrategy` (how a component is made in host, sandbox or isolated-sandbox) stays a plain,
  synchronous function passed to `createApplication` (my call), since `createComponent` relies on it returning a
  `Result` at once. Iframes are a browser-host concern, so `ui-workspace` passes its current `deploy`.

**How contracts are registered** (my call): component contracts (app bar and focus, alerts) are component interfaces
(ops) that a host registers under reserved ids: `app` for the gateway and `alerts` for alerts. Plain-function contracts
(`deploy`, `placementsOf`) are arguments to `createApplication`. A minimal host may skip a component contract; calling
one that isn't registered already returns the runtime's "no instance" error, which is the clear error, never a silent
no-op. `createApplication`'s argument is `{ catalogs, deploy?, placementsOf? }` (defaults: host-only deploy, no
placements).

## nano.json

- The schema (`NanoAppSchema`, `checkApp`, `canonicalApp`, `RESERVED`) moves from `shell` to `nano-app`.
- Snapshot and apply (`ui-workspace/src/app/snapshot.ts` and `apply.ts`) move to `nano-app` as pure functions over the
  Application and injected stores (the stores interface already exists). Browser storage, the working copy and the File
  menu's UI stay in the host.
- **The document gains `tags`:** `{ "<ref>": ["tag", …] }`, sorted for a canonical form. Apply restores them; a tag on a
  ref that no longer exists is dropped with a note, like other clashes.
- **The main workspace is saved** with the others.
- Placements aren't saved; they're worked out again from each screen's layout when it loads.
- The document version stays `1`; `tags` is optional, so older documents still load.
- **Save and restore details** (my calls): a screen's id is its route path, which doesn't change when its title is
  renamed. Apply restores tags after instances and screens exist. The main workspace (`/workspace`) is saved in the
  same `workspaces` list; an older document without it opens with an empty main workspace, as today.

## What `ui-workspace` keeps

Page markup, golden-layout and the dock, `placementsOf`, its contract implementations (the app bar element, the status
line, sandbox iframes), browser storage, and the File menu's wiring. `composable.ts` shrinks to one
`createApplication` call plus the worked example and host-only glue.

## Suggested order

1. `Tags` in core, with tests.
2. `nano-app` with item references, and the Application owning systems (the platform's pure logic moved). The platform
   views read from the Application; behaviour is unchanged and existing tests pass.
3. Screens, placements and `placementsOf`; the main workspace becomes a screen.
4. Tags on the Application, the query ops, and `tags` in nano.json.
5. Move the contracts (`AppGateway`, deploy, alerts), the schema, and snapshot/apply into `nano-app`; `composable.ts`
   shrinks.
6. Tidy: shell becomes the host UI kit; the platform package keeps views only.

Each step leaves the app working and the full test suite green.

## Dependencies

`nano-app` depends on core and runes only. The catalog type lives in `nano-elements` today (it carries an element
`tag`), so `nano-app` defines its own minimal structural catalog type (`{ component; title?; tag?; modes? }`) instead of
importing it (my call); `nano-elements`' `Catalog` stays assignable to it.

## Left to the builder

- Internal data structures and file layout within `nano-app`.
- Whether the registry's label index reuses `Tags` internally.
- Whether the platform's Lit views move to `shell` or stay in a views-only `@composable/platform`.
- Exact op namespaces and descriptions, following the existing `Ops.source` and `Ops.action` style.
