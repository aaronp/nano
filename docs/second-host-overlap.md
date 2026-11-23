# A second host: what it had to rewrite

`packages/host-react` is a small React host on the data seam (spec: `docs/superpowers/specs/2026-11-21-second-host-design.md`).
It imports only `@pritzlaff/nano-core`, `@pritzlaff/nano-outline`, `@pritzlaff/nano-ui`, `react` and `react-dom`, is
built into `packages/ui-workspace/public/react/` and served at `/react/`, and shares the workspace's stored documents
(`nano-workspace.document`, `nano-workspace.outline`; the old `nano-workspace.platform` is read while that is absent, and never written). It does: boot from them, list and switch pages (titles from
`title`; one row of tabs per level of the tree along the path to the shown page, "+" adding a child of the shown page and "+ top" a root), show each page as a CSS grid (columns in `layout.react`), render each slot (a pod through its view, a
`view` slot as "not available here", `missing` as "not found" with Remove, a start failure with its reason), add a slot
(pick an implementation and a runtime: deploy a lazy pod, then `outline.apply`), remove a slot, add a page, and save
on each change. About 310 lines of TypeScript/TSX, plus a 50-line index.html.

Checked by hand in Chrome (headless, against the built `public/`): a page made in /react/ shows in the workspace's nav
and dock with its pods; Main made by the workspace shows in /react/; a pick in /react/ deploys into the chosen runtime
(`side`, created on the fly) and its view renders; a reload keeps both; an imported same-origin provider
(`example.slice`) is pickable in /react/ and its view (`nano-map`) renders. Only the shown page is opened.

## The overlaps

Sizes are this host's lines for the item; the workspace's are roughly what the same job takes there (often more, as it
does more).

| # | What was rewritten | Lines here | Workspace has it in | Recommended home |
|---|---|---|---|---|
| 1 | **Loading the stored document's providers**: each `modules` entry imported, its default `Provider` added to a registry, its `views` merged into the view map | 17 (`boot.ts` `providers`) | `import.ts` `importApp` (95, with foreign/probe/merge), `host.ts` `start` | **nano-core**: `loaded(url)` in `application/load.ts` already does this but is internal, takes only a URL, drops each module's `views` and hides the registry (`Application.load` returns only the app) |
| 2 | **Booting**: assemble, `Application.create`, `Outline.parse` + `Outline.create` over the stored pages | 12 (`boot.ts`) | `host.ts` `start`, `boot-host.ts`, `boot-pages.ts` | **host-core** (`bootFrom(storage)`), resting on 1 |
| 3 | **Keeping the host fields** (`modules`, `frames`, `views`, `layout`) beside `app.deployment()`, which drops them, and merging them back for saving | 3 (`boot.ts` `saved`) | `host.ts` `kept` / `data()` | **nano-core** (the Application keeps the document's host fields and gives them back) or **host-core** |
| 4 | **Storage**: the two keys, read without throwing, write both, report a failed save | 24 (`stored.ts`) | `persist.ts` (34), `boot-host.ts` keys and storage fallback | **host-core** (the keys are a cross-host contract, now spelled `nano-workspace.*`) |
| 5 | **Saving on change and the another-tab guard**: save on `applied` and each Outline change; stop once another tab writes either key | 8 (`boot.ts`) | `boot-host.ts` (~15, debounced, `pagehide` flush) | **host-core** |
| 6 | **The catalog**: every implementation with its provider, title and default view tag | 10 (`catalog.ts`) | `dock/panels.ts` `implementationTemplates` (12, as DOM `<template>`s), `host.defaults()` | **nano-ui** (headless, beside `views`/`viewFor`) or **host-core** |
| 7 | **A pick = deploy a lazy pod**: free name `<kind><n>`, `AppDeployment.edit().place`, a starting config, a host `rules` entry in a `rules` runtime, apply; one at a time | 22 (`slots.ts` `addSlot`/`make`) | `dock/panels.ts` `addPod`/`make` (26) | **host-core**; the rule prepend is what `edit`'s `create` does for a pod, so a host-access option on `edit.place` belongs in **nano-core** |
| 8 | **Starting config** (`nano.ui/map` needs `{ code: 'return x' }`) | 1 (`slots.ts` `starts`) | `dock/panels.ts` `starts` | **nano-ui** (its implementation's default config), or **nano-core** if implementations declare one |
| 9 | **Auto-connect**: a new pod's dependencies, each wired to the one matching pod (call edge, and a rule in a `rules` runtime) | 19 (`connect.ts`) | `auto-connect.ts` `autoConnect` (42, with notes and toasts) | **nano-core** (`AppDeployment.edit` already places and creates edges) or **nano-outline** (it already owns `targets`, its input) |
| 10 | **Adding the pod slot**: `Coord.pod(...)`, a free slot id, apply the page | 6 (`slots.ts`) | `dock/page-pods.ts` `add` (15) | **host-core** (the Outline rightly has no per-operation API) |
| 11 | **Page edit helper and remove slot**: page `id` replaced by `f(page)`, applied | 6 (`slots.ts` `edit`, `removeSlot`) | `dock/page-pods.ts` `write`, `dock/page-docks.ts` `edit` | **host-core** |
| 12 | **New page id from a title** (slug, `-2`…) | 4 (`slots.ts` `addPage`) | `lib/pages.ts` `slugPath` | **host-core** |
| 13 | **Title from `title`** (else the id) | 1 (`slots.ts` `titleOf`) | `lib/pages.ts` (`rowOf` in `workspace-pages.ts`) | resolved: `Page.title` (B) |
| 14 | **Opening the shown page, again on its changes**: `outline.open` on show; re-open when the Outline's change report names it (`added`/`changed`/`resolved`); drop a stale result | ~12 (`app.tsx` `useChanges` and the effect) | `dock/page-pods.ts` `pagePods` (~25), `dock/page-docks.ts` re-open logic | **host-core** (a framework-free `pagePods`-like model: `open`, `get(slot)`, `listen`) |
| 15 | **What a slot shows**: the opened result → pod view / fail reason / not found + Remove / view not available | ~12 (`slot.tsx` `SlotCell`) | `dock/page-pods.ts` `podPanel` (~40) | the decision in **host-core**; drawing stays per framework |
| 16 | **Mounting a pod's view**: `viewFor(pod, deployment-with-views, defaults)`, make the element, set `target`, replace on tag/runtime/pod change | 10 (`slot.tsx` `PodView`) | `dock/page-pods.ts` `podPanel`, `chosen`, `viewTags` | **nano-ui** (`mountView(el, target, defaults)`: it owns the view contract) |
| 17 | **The import map and the shared-module list**: nano-core, nano-elements, nano-ui, lit (and seven subpaths), typebox (and `/value`); the build's `external` list | 15 (`index.html`) + 1 (`scripts/build.ts`) | `public/index.html`, `src/shared/specifiers.ts` `SHARED`, `scripts/build.ts` `external` | **host-core** (or a build helper beside it): `SHARED` and an `importMap(prefix)`; it is the contract every provider module is built against, not workspace detail |
| 18 | **The Outline instance and `open`'s result types** (`ReturnType<typeof Outline.create>`, `Awaited<ReturnType<…['open']>>[string]`) | 2 | `lib/pages.ts`, `dock/page-pods.ts`, `dock/page-docks.ts` (each derives them the same way) | **nano-outline** exports the types (new exports: the user's call) |

Roughly: of ~310 lines, ~205 restate the workspace (items 1–18); the rest is React layout and markup.

## What the seam made awkward

**A. The workspace does not keep to its own layout key (the biggest finding).** *Resolved (ADR-0039): the workspace
keeps its dock's state in `layout.workspace` and its meta in `meta.workspace`, other keys kept; host-react's guard is gone.* The Platform says `layout` is the
client's, and the brief says to write only `layout.react`. But the workspace reads *every* key of `page.layout` except
`template` and `window-style` as golden-layout's config (`dock/page-docks.ts` `pageStorage`, `only(w, false)`), and on
each dock change rewrites the layout as `{ ...only(w, true), ...config }`. So:
- the workspace **drops `layout.react`** the next time it shows that page (seen in the browser: columns set in /react/,
  gone after one workspace visit);
- a page whose layout is **only** `{ react: … }` breaks the workspace's dock: `LayoutConfig.fromResolved` throws on a
  config with no `root` array (checked against golden-layout 2.6.0).
Workaround here (`slots.ts` `setColumns`): columns are refused on a page whose layout has no golden-layout `resolved`
config yet, i.e. until the workspace has shown it once. That needs golden-layout knowledge in host-react, exactly what
should not leak. Fix (in the workspace, a later step): keep its engine state under its own key (`layout.workspace`,
`layout.template`…), migrating the current shape once; and say in the Platform spec that `layout` and `meta` are maps
keyed by client.

**B. `meta` is de facto shared.** *Resolved (ADR-0039): the title is `Page.title`; `layout` and `meta` are keyed by
client.* Titles are `meta.title` for both hosts; order (`meta.order`), icon and the restore
point are the workspace's. Nothing says which `meta` keys are cross-host. Either the Platform names a page title (it is
what a CLI or any UI shows), or host-core documents the shared keys.

**C. The workspace's page rules are not in the data.** *Resolved (ADR-0039): they stay the workspace's; a page
another client makes on one of its routes is shown at `/p/<id>`, and a missing Main is recreated.* Until the workspace has booted once over a stored
document in the old shape (title in `meta.title`), /react/ shows such a page's id rather than its title. Main (`workspace`) must exist and is first, page ids must not be
one of the workspace's routes (`FIXED`: `ring`, `desk`, `settings`…), order is `meta.order`. /react/ cannot import them
(they are in ui-workspace) and does not copy them: a page titled "Ring" made in /react/ gets id `ring`, which the
workspace's own writes would refuse but its boot will take as-is (a route clash; not tried). /react/ shows pages in
document order and new pages have no `meta.order` (the workspace puts them last).

**D. An Application with no runtimes has no registry** (nano-core, `application/index.ts`: "such an application can
only apply deployments naming no implementation"). The workspace never meets it because its host pods are always in
`main`. Workaround here: boot with an empty `main` runtime when the stored document has none (2 lines). A
`registry` option on `Application.create` would remove the need.

**E. Module loading is reachable only through a URL.** nano-core's `loaded` is the right loader but internal,
URL-only (a stored document is not at a URL; the workspace turns it into a `blob:` URL and special-cases it in
`importApp`), and it drops `views`. See item 1.

**F. Host capabilities belong to the workspace.** The stored document is the workspace's `saved()`: its host pods
(`ui`, `deploy`, `platform`) and their edges stripped. /react/ has none, so a pod needing `nano.ui.HostUI` or
`HostDeploy` is left unwired; a pod with `isolation` other than `host` fails to start (no `isolate`; the reason is shown
in its slot). Foreign providers (another origin) fail the boot as a whole, since assembling needs every provider
(out of scope, but it means one foreign module in the workspace makes /react/ unusable rather than degraded).

**G. Two live hosts on one storage.** Both save the two documents on every change; each stops saving once the other
writes (`storage` event), so the second one to change anything freezes the first. Correct (no lost writes), but a
shared host core could do better (re-read and re-apply) once.

**H. The guardrail does not see `.tsx`.** `packages/nano/test/structure.test.ts` measures `.ts` files only; this
package's `.tsx` files are kept under 150 lines by hand. The root `tsconfig.json` gained `"jsx": "react-jsx"`.

## Module identity: shared, not bundled

/react/ uses **the workspace's import map and shared copies** (`../shared/*.js`, `../bundle/nano-ui.js`), not its own:
the stored document names nano.ui as `/bundle/nano-ui.js` and each provider module (e.g. `/examples/slice/shout.js`) is
built with nano-core, nano-ui, lit and typebox external. With a bundled copy, a loaded provider would import a second
nano-core and nano-ui, and nano-ui's custom elements would be defined from whichever copy ran first. React, react-dom
and nano-outline are bundled into `react/main.js` (nano-outline's own imports, nano-core and typebox, stay external,
so there is still one copy of each). The workspace bundles nano-outline into its own `main.js` too, so each host has
its own Platform module; harmless (a Platform is per `create`), but worth keeping in mind if HostPlatform crosses hosts.

## What would move, in short

- **nano-core**: export the loader (a document plus a base URL in, `{ deployment, registry, views }` out); keep the
  document's host fields through the Application; a `registry` option for an empty Application; a host-access option
  on `edit.place`; possibly auto-connect as an `edit` step.
- **nano-outline**: export the instance and `open` result types; say `layout`/`meta` are keyed by client (and maybe
  name `title`).
- **nano-ui**: a headless catalog, implementations' starting configs, `mountView`.
- **A new framework-free host-core**: storage keys and persistence with the another-tab guard, boot from storage, the
  pick (deploy then apply), page edits (add/remove slot, new page id, title), a `pagePods`-like open/re-open model, and
  the shared-module list with an import-map helper.
- **ui-workspace** (not a move, a fix): keep its engine state under its own layout key. Done (ADR-0039).

## Update: the Outline (ADR-0040)

The Platform was renamed the Outline (`@pritzlaff/nano-outline`, packages/outline) and its pages became a tree: `{ roots, pages }`,
each page with `children`. /react/ now follows the tree: one row of tabs per level along the path to the shown page,
"+" adds a child of the shown page, "+ top" a root. It reads `nano-workspace.outline`, else the old
`nano-workspace.platform`, writes only the former, and its another-tab guard watches both keys. Mentions of the Platform above
are as written then.

## Update: on the host core (plan 4, Task 3)

host-react is rebuilt on `@pritzlaff/nano-host` (ADR-0041). `stored.ts`, `connect.ts` and `slots.ts` are gone; `boot.ts`
shrank to `Host.boot` with nano.ui as a host provider and the same-origin rule as its own `load` (a wrapper over core's
`Registry.load`: a module on another origin still fails the boot); `pages.ts` holds what stayed (the tabs per level,
title, columns, and a small `edit(h, f)` applying a host-core page edit on the live outline's version).

What moved to the host core: items 1–5 (loading via `opts.load`/`exports`, boot, the host fields as `host`, storage under
one key `nano-host.document` with migration from the old keys and the another-tab guard), 7–9 (`host.pick`: the lazy pod,
its starting config now the implementation's config schema `default`, the host rule, auto-connect), 10–12 (`addSlot`,
`removeSlot`, `addPage` as pure edits) and 18 (the `open` result type is derived from `Host['outline']['open']`). Item 14's
re-open on change stays in `app.tsx` (the live outline's `listen`), 15–17 stay as they were.

Views: the override is `document().host.views`; nano-ui's `viewFor` still reads `deployment.views` until plan 5, so
`slot.tsx` passes it `{ ...app.deployment(), views: host.views }`. Columns stay in `layout.react` on the page, written
through `host.outline.apply`.

Interim (ruled): until plan 5 the workspace writes the old `nano-workspace.*` keys and /react/ the new one; they share
data only at /react/'s first boot, through migration.

Lines (`wc -l` on `src/*.ts` and `src/*.tsx`): **320 before** (boot 64, slots 75, stored 25, connect 19, catalog 10,
app 78, slot 36, main 13), **206 after** (boot 27, pages 40, catalog 11, app 79, slot 36, main 13).
