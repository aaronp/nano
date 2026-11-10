# Inventory: kind and owner in snapshots, and a table of every instance

## Why

We need to see two things clearly:

1. **Potential components:** the kinds in the host's catalog, which are what a system could hold.
2. **Actual instances:** which instances exist in which system (Registry/Runtime), what kind each is, and who owns it.

Today a `Snapshot` lists `{ id, ops }` for each instance. It can't say that `r` is a `range`, or why `r` exists, which also decides what will remove it.

The model, in Kubernetes terms (the user's framing):

| nano | Kubernetes |
|---|---|
| Component definition (`ns/name` and its ops) | a spec / resource type |
| Catalog (kind → definition) | the API resources a cluster knows |
| Instance | a Pod |
| Registry/Runtime | a namespace |
| Platform | the control plane: the whole cluster, at app level |

Recording the kind is like putting a label on a pod. Recording the owner is like `ownerReferences`.

Headless components (no `tag`) are first-class: a web component is only one way to look at an instance.

## Goals

- **Core:** the registry records each instance's **component** and **owner**, at the point where it is stored.
- **Table:** a new view element, `<c-platform-table>`, shows every instance as a sortable, filterable, column-resizable table.
- **Kit:** `<nano-data-table>` gains column resizing, so every host gets it.

## Non-goals (the next design, not this one)

- Desired state (a declared `{system, id, kind}` list that the platform reconciles to).
- Eager vs lazy start.
- Per-kind reuse policy ("one per system" or "many").
- Persisting systems.
- Cascade deletion through owners. An owner is recorded, never acted on.

## Anti-goals

- A second platform instance, or any new component instance, for the table. It is a view, like `<c-platform>`.
- A new table component next to `<nano-data-table>`.

## Decided

### Core (`@pritzlaff/nano-core`)

- New type: `Owner = { kind: string; name: string }`.
- `Registry.add(id, inst, owner?)`.
  - The owner is optional, so existing callers still compile.
  - It is stored on the **registry entry**, not the instance. A shared instance can have a different owner in each registry.
- `Snapshot.instances[n]` gains:
  - `component: string`, the instance's `` `${component.id.ns}/${component.id.name}` ``;
  - `owner?: Owner`.
- The `instance-added` delta carries `component` and `owner` too.
- An owner is a record only. Nothing removes instances because of it.

### Who passes which owner

| Creator | Owner |
|---|---|
| `platform.createComponent` and `platform.addToSystem` (`packages/platform/src/platform.ts`) | `{ kind: 'platform', name: <the platform's own instance id> }` |
| `PlacedElement` (`packages/elements/src/placed-element.ts`), a docked widget | `{ kind: 'widget', name: <element's localName> }` |
| `ModelElement` (`packages/elements/src/model-element.ts`), a view's hidden `~view` subscriber | `{ kind: 'view', name: <element's localName> }` |
| `addEditor` (`packages/editor/src/editor.ts`) | `{ kind: 'editor', name: <prefix> }` |
| `packages/ui-workspace/src/composable.ts:26`, the platform itself | `{ kind: 'app', name: 'ui-workspace' }` |

If no owner is passed, it shows as "unknown" in the UI.

### Platform

- The platform needs a source op that lists each catalog kind with its component id, so the table can map `ns/name` back to a kind: `kinds: Array<{ kind, component: 'ns/name', title, tag? }>`.
- Keep `catalog: string[]` as it is, because `<c-platform>`'s Add form reads it.
- Kinds added by importing a package must appear in the table without a reload.

### `<c-platform-table>` (in `packages/platform`)

- A `ModelElement` over `platform`, using the provided registry by default, like `<c-platform>`. It's exported from the platform package.
- It's offered in the dock and on the Systems page next to the tree. Where exactly is the builder's call, but both must show it.
- **Rows:** one per (system, instance).
  - A shared instance gets a row in each system.
  - Hidden `~view` instances are included, so they can be found by filtering on owner.
  - Each catalog kind with no instance in any system gets one row, with System and Instance shown as "—". That keeps "unregistered" findable.
- **Columns:**

  | Column | Shows | Example |
  |---|---|---|
  | System | the registry id | |
  | Component | the catalog kind; "—" if the component isn't in the catalog | `range` |
  | Instance | the registry id of the instance | `r` |
  | Name | the component's `ns/name` | `composable/range` |
  | Owner | `kind · name` | `widget · c-range` |

- **Filtering:**
  - A free-text box matches any column.
  - A **Filters** button has a badge with the number of active filters, and a **Clear** button.
    - The button expands to show every system and every component as toggleable pills.
    - The active ones also appear under the search box as pills you can clear, each with a ✕ (accessible name "Remove filter <x>").
    - Within a group, pills OR together; groups AND with each other. For example, `host`, `lab` and `range` means range instances in host or lab.
- Clicking an Instance cell selects that instance (`PlatformOps.select`), so the tree and the Wires view follow it.
- Uses the `--nano-*` tokens with fallbacks; works in light and dark.

### `<nano-data-table>` (in `packages/elements/src/kit`)

- Columns can be resized: a drag handle on each header's trailing edge.
- The handle can be focused, and ←/→ resize it (`role="separator"`, `aria-orientation="vertical"`, `aria-valuenow` = width in px).
- Each column has a minimum width. Sorting and the existing features are unchanged.
- The gallery's existing data-table sample shows resizing.

### Release

`nano-core`, `nano-runes` (if its types change) and `nano-elements` go to 0.3.0, published by the user (`make publish OTP=…`). The template's dependency follows.

### Settled after the builder check

- **Data source:** the table reads the platform's existing `systems` op.
  - It already publishes a snapshot of every system, `~view` instances included, after every change.
  - The table re-renders through `ModelElement` like `<c-platform>`. No new subscription is needed.
- **Selection:** clicking an Instance cell calls `select` with `{ system, instance }` from that row (the existing `Selection` shape).
- **Platform's own id:** the platform finds its own id the way `removeFromSystem` already does (`env.handles()`). The factory's signature doesn't change.
  - The platform instance itself shows with Component "—", because `composable/platform` isn't a catalog kind.
- **Kinds sharing a component id** *(my call)*: allowed. The Component cell lists every kind with that id, joined with ", ". A kind counts as "never instantiated" when no instance has its component id.
- **Never-instantiated rows and filters** *(my call)*: the System pill group gets an extra pill, **Unregistered**, which selects exactly those rows.
  - Like any system pill, it ORs with the other system pills.
  - With only real system pills active, those rows are hidden.
  - Component pills keep a kind's never-instantiated row.
- **Snapshot shape** *(my call)*: `component` is required in what a registry returns, and `owner` is optional. This is acceptable in a 0.x minor release.
- **Published packages:** only `@pritzlaff/nano-*` are published. `@composable/*` (platform, editor, bundle, wires) and `ui-workspace` are workspace-only.
- **Owner names** *(my call)*: `localName` is enough. The Instance column already tells apart two panels of the same element.

## Left to the builder

- How resizing is implemented (a `<colgroup>` with `table-layout: fixed`, or something else). Widths don't persist.
- How the platform hears about kinds added by imports. For example, `addCatalog` could call a platform action, or the platform could take a getter. The only requirement is that new kinds appear without a reload.
- Pill styling, using the kit's existing pressed-button look.
- The exact empty-state text.

## Done means

- Tests first.
- Every package passes, and the npm packages and the app build.
- The table works in the dock and on the Systems page, in light and dark.
