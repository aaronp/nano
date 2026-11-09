# Named workspaces, each in a system, with a components drawer — design

## Intent

The Workspace nav item becomes a group of named workspaces, and each workspace runs in a **system**: a nano
Runtime, the components registered to one Registry. Main runs in `host`. Components are no longer a long list of
"+" items in the main nav: each workspace page gets a second-tier drawer, like the Inbox's Folders column, listing
every component to drag in, with its own small toolbar (Import, filter). Import itself is the next work item; here
it is only a button.

## Goals

1. **The nav.**
   - **A Workspaces group:** a **Workspaces** item (linking to Main) with a **`+`** button beside it, and the named
     workspaces under it as sub-items with their icons: **Main** first (`/workspace`, system `host`), then saved ones.
   - The "+ Notes", "+ Chart" … sub-items leave the main nav. Saved workspaces (like Debounce) move from beside
     Inbox to under Workspaces.
2. **The `+` dialog: a new workspace.**
   - **Fields:** name (the nav title), route (filled from the name, editable), icon (the existing eight), and
     **System**: pick one of the platform's systems, or choose "New system…" and name it.
   - **On create:** a new system is made through the platform's `create-system`; the workspace is saved (path,
     title, icon, system) and mounted, starting **empty**, and the page opens.
   - The toolbar's **Save workspace…** stays, saving the current layout as a new workspace in the **same system**
     as the dock it is saved from.
3. **The workspace page** is a two-column `<split-pane>` (as Inbox): the **components drawer** on the left, the dock
   (inside its `<c-wires>`) on the right. Every workspace page, Main included, has one.
4. **The components drawer** (`<component-drawer for="<dock id>">`):
   - **Toolbar:** title "Components", an **Import** button (disabled, "Import from a URL — coming next"), a
     **filter** that matches titles, and a **collapse** button.
   - **Sections**, Folders-style headings: **Components** (the host's merged catalog: bundle, platform, editor,
     puzzle-port…) and **Widgets** (the page's own: Notes, Chart, Metrics, Messages, Activity…). Each entry is
     draggable onto the dock and clickable to add, as the nav items are today.
   - **Collapsed**, it is a thin strip with a button to reopen it. Collapsed or not is remembered per workspace.
5. **A workspace runs in its system.**
   - **Panels:** a component placed in a workspace's dock is created in (or attached to) that system's registry.
     The dock is given its registry and hands it to the placed elements it mounts.
   - **⇄ Connections** shows and wires that system: `<c-wires>` reads that runtime's registry and trace, and makes
     platform calls (connect, create, remove) through the host runtime, naming that system.
   - **Detail's tree** is the platform's, in the host registry, as now.
6. **Persistence:** saved workspaces gain a `system` (missing means `host`, so existing ones keep working). Systems
   are not saved by the platform, so at start a saved workspace's system is created if it doesn't exist; its
   components are made afresh by their panels, and connections made in it do not survive a reload.

## Non-goals

- Importing components from a URL (next work item).
- Renaming or deleting workspaces; saving systems or their connections.
- Moving a workspace to another system.

## Anti-goals

- A second list of available components: the drawer lists what the docks can already add.
- Library changes to `@pritzlaff/nano-*` (the dock hands registries to elements through their existing `registry`
  property).
- A file over ~200 lines.

## Settled by Claude (check these)

- **The Workspaces item links to Main;** Main is also listed under it, so every workspace has a sub-item.
- **The drawer's sections** are split by whether an entry comes from the host's catalog or is a page widget.
- **A new workspace starts empty**; the dock shows a hint ("Drag a component in from the drawer") instead of
  requiring a first panel.
- **A runtime for a system** is looked up through the platform instance (`runtimeOf(registry, name)`, a small export
  of the platform package), since the platform owns the runtimes it creates.
- **Panels' elements are given the registry before they upgrade** (Lit keeps properties set early), so they place
  themselves in the workspace's system rather than the page's provided `host`.
- **Page widgets are untouched by systems.** Notes, Chart, Metrics, Messages and Activity talk over the page's bus,
  not a registry, so they work the same in any workspace. Composable components talk within their system;
  connecting across systems stays a non-goal.
- **`<c-wires>` takes two runtimes:** `runtime` (the workspace's system: its registry for the model, its trace for
  packets) and `host` (where the platform lives: platform calls, and the platform's `selection-changed` in the host
  trace). `host` defaults to `runtime`, so Main is unchanged. `system` is that runtime's registry id.
- **The dock hands its registry to panels in its one mount path** (every panel, added or restored, goes through
  it): before the panel's content is attached, every element in it that has a `registry` property, or is not yet
  upgraded, gets the dock's registry.
- **Systems exist before any dock loads:** start-up creates the saved workspaces' missing systems (awaited) before
  the dock element is defined, so restored panels find their registry.
- **An empty layout saves and restores** (golden-layout's root can be empty); this is tested.
- **Two workspaces on one system share it:** panels that name the same instance show the same component, as Main
  and saved workspaces in `host` already do.
- **Main is not a saved workspace;** it is always first. A drawer's collapsed state is kept under its dock's id.
