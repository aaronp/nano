# Workspace port backlog (2026-11-17)

`packages/ui-workspace` is restored from `35f1675^` (commit "restore(ui-workspace): … verbatim") and its seams are
ported to `@pritzlaff/nano-core` 0.4. This lists what was **not** a direct port. Each item: what the old feature did
(file:line at `35f1675^`, under `packages/ui-workspace/` unless named), why it is not a direct port, what is stubbed
now, and the options seen (no decision). `// BACKLOG(n)` / `<!-- BACKLOG(n) -->` in the code point here.

Old files that could not be ported are kept verbatim under `packages/ui-workspace/retired/` (excluded from
`tsc` in the root `tsconfig.json` and from `bun test` by `packages/ui-workspace/bunfig.toml`), so nothing is lost.

## Items

1. **@composable components, the Systems page's example and the Instances table.**
   Old: `src/composable.ts:33-88` built a catalog from `@composable/bundle|editor|shell|people`, made a worked example
   (range → debounce → log, input → map → log) and a template per kind; `public/index.html` Systems route showed
   `<c-platform>`, `<c-platform-table>`, the five example elements; the dock had *Systems*, *Instances*, *Puzzle editor*.
   Why: the `@composable/*` packages and `nano-app`'s platform are retired; no 0.4 equivalent of a "kind catalog".
   Stubbed: the catalog is now the host registry's implementations (`src/dock/panels.ts` `implementationTemplates`:
   a palette template per implementation, opening one adds a pod to runtime `main`, as a kind's panel placed an
   instance). `<c-platform>` → `<nano-explorer>` (dock *Systems* and the Systems page). The Instances table, the
   example row (hidden) and the Puzzle editor are gone.
   Options: build the example as a nano.json loaded at start; an Instances view over `app.deployment()` in nano-ui;
   port the editor and other packages as 0.4 providers.

2. **Placed elements, the dock's registry and a panel's deploy mode.**
   Old: `src/lib/panel-content.ts:13-21` handed the dock's registry to `PlacedElement`s and `<c-sandboxed>`;
   `src/components/workspace-dock.ts:302-304` read an instance's `nano/deploy` label; `src/sandbox/deploy.ts`,
   `src/sandbox/sandboxed-el.ts` deployed a kind host / sandbox / isolated-sandbox per panel.
   Why: `PlacedElement`/`ModelElement`/`provide` left `nano-elements` (core 0.4 has no instance registry); isolation is
   now a pod's `isolation`, set in the deployment.
   Stubbed: no registry is handed; the mode is only the saved panel state's. Pods run sandboxed through `host.ts`
   `isolate` (the rewrite's 0.4 sandbox plumbing) and show `nano-sandboxed`.
   Options: a per-panel "run sandboxed" choice that writes the pod's `isolation` (an apply); drop `withMode`.

3. **Saved workspaces (screens), Save as workspace…, + New workspace, a route's layout.**
   Old: `src/boot-saved-workspaces.ts`, `src/components/saved-workspaces.ts`, `src/lib/screens.ts`,
   `src/components/workspace-dialog.ts`; each saved workspace was a nano-app *screen* with its own *system*;
   `workspace-dock.ts:346-349` wrote the layout into the screen (`setLayout`).
   Why: 0.4 has no screens or systems; a deployment has one `layout`. Several screens per app is a design decision.
   Stubbed: the `+` button and *Save as workspace…* say "Saved workspaces are not available yet."; Save layout keeps
   the layout in localStorage only. `workspace-dialog.ts` and `lib/saved-workspaces.ts` are in `src` (pure UI), unused.
   Options: workspaces as named layouts in the deployment's `layout` (one runtime set, several arrangements);
   one nano.json per workspace; a runtime per workspace.

4. **Profile (`<nano-profile>`).**
   Old: `public/index.html` slot `actions`; `src/composable.ts:64,74-75` made a `Profile` (`@composable/shell`) with
   `HOST_ENTRIES` (`src/app/stores.ts`).
   Why: `Profile` is a retired component; `<nano-profile>` was a `PlacedElement`.
   Now (the first option): `src/components/profile-menu.ts` defines `<nano-profile>` as a plain element: the old
   avatar and menu, same markup and styles, with `HOST_ENTRIES` (Components, Settings, Systems, Themes, Wiring) and
   the user *You* static. Gone: setting the user, an avatar image, entries set at runtime (a provider pod with a view).

5. **The app gateway: the app bar and the workspace controls as components.**
   Old: `src/components/app-bar.ts` (a `PlacedElement` over `AppGateway.appBar`), `src/boot-app-bar.ts` (setFocus,
   setAppBarDefault), `src/components/workspace-controls.ts:19-43` (a `nano-runes` component in the host registry).
   Why: `AppGateway` (nano-app) and `nano-runes` are retired.
   Stubbed: `<nano-app-bar>` is a plain element shown by `boot-app-bar.ts`: the page's `<nano-workspace-controls
   dock>` (same markup and styles, driving the dock directly), or a focused / just-opened pod's controls: **View** and
   **Change implementation** pickers (new: the host's, each an apply). Components can no longer put their own controls up.
   Options: a `HostUI` op for the app bar (HostUI.setAppBar sets only the title now); keep it host-side.

6. **Connections (the dock tilted to its cables) and the Wiring page's circuit.**
   Old: `<c-wires>` around the dock (`public/index.html`, `src/composable.ts:111-124`), `wires:open-panel`;
   `<c-circuit>` and `src/boot-wiring.ts` (page layers, Connections link flipping the last workspace's dock).
   Why: `@composable/wires|circuit` are retired.
   Restored: `<c-wires>` is back, verbatim from `35f1675^` in `src/wires/`, its seams ported to 0.4: pods are the
   instances, an implementation's ops the jacks (an action is an in jack and, for its result, an out jack, as nano-ui's
   wiring reads them), pipes the cords; connect, disconnect, add and remove are an `apply` of the deployment; packets
   come from `sent` pipe messages; `wires:open-panel` opens the pod's panel (`openPod`). *Connections* tilts the dock again.
   Still stubbed (`BACKLOG(6)` in `src/wires/`): a packet is labelled with its target op, not the value (`sent` carries
   no data); the selection is the view's own (no Application `select`); call edges are not drawn; Detail's tree is
   `<nano-explorer>` (was `<c-platform>`), without schema examples; a cord between pods in different runtimes is refused.
   `<c-circuit>` is back too, verbatim from `35f1675^` (`packages/circuit`) in `src/circuit/`, ported the same way:
   runtimes are the systems, pods the instances (titled by implementation, e.g. `log`, was the kind's title `Log`), an
   implementation's ops the pads (an action is an in pad and, for its result, an out pad; an event an out pad), pipes
   the cables; it rebuilds on `applied`. The one page is the Workspace (`/workspace`, titled *Main* as before); its
   footprints are the pods the live dock shows, boxed from the dock's golden-layout tree (`dockPlacements`; was the
   screen's saved layout), read again when the Wiring page is shown. `src/boot-wiring.ts` and `test/wiring.test.ts`
   are back from `retired/` unchanged (one page; its profile-menu test is back with item 4). Still stubbed: no
   saved workspaces, so one layer (item 3); call edges are not drawn; the dock's layout is read through its private
   golden-layout (`main.ts` `arrangement`; a public accessor on `<workspace-dock>` would be a new method).

7. **Importing a package by its manifest.**
   Old: `src/imports.ts`, `src/lib/imports.ts`, `src/components/import-dialog.ts`: fetch a manifest, preview components,
   ops and shared-library versions, choose Trust (sandboxed/trusted), remember imports, list failures in the drawer.
   Why: 0.4 imports a nano.json (deployment + `modules`); trust is a pod's `isolation` and a foreign-origin approval.
   Now: the same dialog fetches a nano.json and previews it: each runtime with the name it is imported as
   (`<namespace>.<runtime>` suggested, e.g. `acme.template.main`, from providers new to the workspace; a dotted id
   is kept; an existing name merges its pods and subscriptions in; `import-plan.ts`
   `renameRuntimes` renames the keys and `layout.slots[].runtime`), its pods with the isolation Trust gives them
   (Sandboxed: `isolated-sandbox`; Trusted: `host`, never loosening a pod the file sandboxes; a pod of a provider
   the workspace already has, e.g. nano.ui, keeps the file's), its modules, and which
   providers come from another origin, flagging full access. Its Import is the consent (one click); `confirmImports`
   still asks for a `?src=` boot import. Imports are not remembered. Imported providers' implementations appear
   under *Imported* in the drawer (their ✕ only fires `imports:remove`, nothing listens).
   Options: remember imported nano.json URLs; a provider-module import.

8. **File: the working copy, autosave, New, Open, Save/Save As semantics.**
   Old: `src/boot-app.ts`, `src/boot-file.ts`, `src/app/{boot,file,known,store,stores}.ts`,
   `src/components/open-dialog.ts`, `src/components/imports-confirm.ts`: a NanoApp document kept in localStorage
   (working copy, autosave, apps by name, dirty tracking against a baseline), Open from saved apps / a URL / a file,
   consent for code (map/filter) and trusted packages.
   Why: all on nano-app's document and stores (retired); 0.4's host has `saved()` and `importUrl` only.
   Now: `<nano-file-menu>` (restored verbatim from `@composable/shell` to `src/components/file-menu.ts`) —
   Save/Download download `nano.json`; Save As… asks a name (`name-dialog.ts`) and downloads `<name>.json`; the file
   is `host.saved()` plus the dock's arrangement as `layout.workspace` (the dock's id). Open/Import open the import
   dialog, which takes a URL or a local file (a file input; imported through a `blob:` URL, whose modules resolve
   against the page); an import whose `layout` for the dock is new shows it (through the dock's saved layout and
   `restore()`). New is an apply of an empty deployment (only the host's pod `ui` in `main`; providers stay loaded),
   then the dock's starting layout. `dirty` is "applied since last save". `e2e/workflow.e2e.ts` runs it end to end.
   Still stubbed: no working copy, autosave, saved apps by name, or consent for code.
   Options: a working copy of `host.saved()` in localStorage.

9. **Needs: choosing a binding, Dependencies.**
   Old: `src/boot-needs.ts`, `src/components/needs-dialog.ts`, the dock's Dependencies button (`workspace-dock.ts:238-248`).
   Why: needs/bindings were nano-app instance bindings; 0.4 resolves `dependencies` by selector in the deployment.
   Stubbed: nothing runs; `needs-dialog.ts` is in `src` (pure UI), unused; the Dependencies button never shows (no
   element is marked `data-needs`). Its tests are in `retired/test/needs-lib.test.ts`.
   Options: show unresolved selectors from an apply's failure and offer implementations that fit.

10. **Alerts to the status line.** Old: `src/composable.ts:45-48` (an `alerts` component publishing `dock:status`).
    Now: `HostUI.alert` shows a toast (the rewrite's `host-ui.ts`). Options: publish on the page bus instead.

11. **The editable title.** Old: `src/app/store.ts:60-90` (`titleStore`, `editableTitle`, kept in localStorage).
    Now: the title is the markup's "Nano"; `HostUI.setAppBar` sets it (not kept). Options: keep it in the deployment.

12. **Retired tests.** In `retired/test/` verbatim: app-apply, app-bar, app-boot, app-snapshot, app-store, described
    (old), dock-focus, file, host (old), import (old), imports, needs, open-dialog, panel-content, sandbox-deploy,
    sandbox-dock, sandbox-frames, sandbox-protocol, saved-workspaces, screens, workspace-controls (old),
    needs-lib (split from `src/lib/lib.test.ts`), and fixtures (app-host, pkg, pkg2, pkg3). `test/workspace-controls.test.ts`
    drops the component test (item 5).

13. **Auto-connect.** A subscription whose pod(s) are absent stays pending; an orthogonal listener deployed with the app
    (git-ops/Argo-like) watches the Runtime and subscribes once both ends exist. Today selective import drops such
    subscriptions with a warning. Its own design, later.

14. **Settings: the decisions made so far, visible and editable, per runtime or per pod.** A Settings page in the
    workspace that shows and changes the choices currently hard-coded or implicit, at workspace, runtime and pod
    granularity. Candidates, all decided along the way without a place to see them:
    - a frame's sandbox permissions (today a fixed `allow-scripts` / `allow-same-origin` per isolation mode; e.g.
      `allow-forms` was refused rather than chosen) — a frame **strategy/policy component**, as `PolicyRules` sits
      behind `Policy` for calls;
    - Trust at import (Sandboxed by default), and that imported sandboxed pods are eager;
    - which providers count as the workspace's own (same-origin), and the foreign-origin consent;
    - approve-once memory for pods with page access;
    - the runtime policy (`PolicyRules`) of each runtime, readable and editable;
    - merge rules on import (a runtime with a policy refuses another policy).
    Its own design: where these settings live (the deployment, so they travel in `nano.json`, vs the host), and which
    are the host's versus the deployer's.

## Current-rewrite files kept (0.4 plumbing, behind the old UI)

- `src/host.ts`, `src/host-ui.ts` (setAppBar now sets the app shell's title), `src/import.ts`, `src/import-confirm.ts`,
  `src/described.ts`, `src/dock/panels.ts` (+ `implementationTemplates`, `addPod`), `src/dock/golden-layout.d.ts`,
  `src/sandbox/{edges,frame-context,sandboxed-view}.ts`, `src/shared/lit-ref.ts`, `scripts/build.ts` (shared list from
  `specifiers.ts`, CSS as text), tests `cross-origin`, `frames`, `sandbox`, and the fixtures under `test/fixtures/import`.
- Path clashes where the **rewrite** version won (plumbing): `src/sandbox/{boot,frames,protocol,serve,stand-in}.ts`
  (the old ones are the old model's; the old versions are in the verbatim-restore commit). The rewrite's
  `test/host.test.ts` and `test/import.test.ts` are now `test/nano-host.test.ts` (adapted to the old dock) and
  `test/nano-import.test.ts`; the old ones are in `retired/test/`.
- New: `src/boot-host.ts` (starts the host where `composable.ts` was imported). Removed rewrite UI: `src/shell.ts`,
  `src/shell/*`, `src/dock/dock.ts`, `src/dock/layout.ts`, `src/shared/nano.ts`, `test/shell.test.ts`.

## Visible differences from the old UI that remain

- Dock opens with *Systems* (`open="nano-explorer"`, was `open=""`), so an imported app's pods are visible at once.
- Drawer *Components* lists implementations (map, log, input, debounce, …) instead of the @composable kinds; *Systems*
  is nano-ui's explorer; *Connections* is nano-ui's wiring; no *Instances* or *Puzzle editor* (items 1, 6).
- A pod opened from the explorer gets a *Pod* panel (or its existing one is focused); the app bar shows its View and
  Change implementation pickers (item 5).
- Systems page: explorer only (item 1); Wiring page: `<c-circuit>` with one page, *Main* (item 6).
- Import dialog previews pods/modules and imports a nano.json from a URL or a file; saved workspaces say "not available yet".
- `e2e/slice.e2e.ts`: the app is reached through `workspace-dock` (was `workspace-shell`), and Save is File › Save.
- Import map: no `@pritzlaff/nano-runes`; adds `lit/directives/ref.js` and `@pritzlaff/nano-ui` (bundle).
