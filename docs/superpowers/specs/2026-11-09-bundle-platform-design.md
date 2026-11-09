# Bundle, Platform and the workspace on core — design

## Intent

Simple building blocks to exercise the fundamentals, and a host that shows and changes the live wiring. Three parts:
- `@composable/bundle`, the basic components;
- `@composable/platform`, the systems plus a tree view onto them;
- `ui-workspace`, moved from the old SDK onto `@composable/core`.

Everything is built from rune components with thin Lit elements, as in `@composable/editor`.

## Goals

### 1. `@composable/elements`: the shared element base

- `ModelElement` moves here from the editor, which then imports it from here.
- **Self-placement:** an element with a `name` attribute and a static `component` places itself. It creates its
  instance under that name in the registry provided on the document, removes it again when the element leaves the
  page, and then shows it as its model. `provide(document, runtime)` sets the page registry.

### 2. `@composable/bundle`: basic components

Each is a rune component plus a self-placing element, `<c-input>` and so on.

- **Input (`<c-input>`):**
  - **State:** `kind` (`text`, `textarea`, `number` or `boolean`) and `value`.
  - **Actions:** `set-kind`, `set-value`, `submit`.
  - **Publishes:** the event `submitted` with the value. Enter submits; in a textarea it's Ctrl/Cmd+Enter. A
    checkbox submits on change.
- **Range (`<c-range>`):**
  - **State:** `min`, `max`, `step`, `value`.
  - **Actions:** `set` and `set-bounds`.
  - **Publishes:** the getter `value` when it changes.
- **Log (`<c-log>`):**
  - **Sinks:** `debug`, `info`, `warn`, each taking any value.
  - **Action:** `clear`.
  - **State:** `entries` of `{ time, level, value }`, shown as a table with a Clear button.
- **Debounce (`<c-debounce>`):**
  - **State:** `quiet` (ms) and `maxWait` (ms).
  - **Actions:** `set-quiet`, `set-max-wait`, and the sink `enqueue`.
  - **Publishes:** the event `flushed` with the queued values as one array, sent once nothing has arrived for
    `quiet`, or at the latest `maxWait` after the first queued value.
  - **Element:** two number fields and the current queue length.
- **Map (`<c-map>`) and Filter (`<c-filter>`):**
  - **State:** `code`, a function body over `x`.
  - **Actions:** `set-code`, then `map(x)` or `filter(x)`.
  - **Publishes:** `mapped` with the result. Filter publishes `passed` with `x`, only when the code returns truthy.
  - **Code** runs with `new Function('x', code)`. A throw is the action's error. This is for local use only; the
    README says so.

**Schemas:** inputs that take any value use `Type.Unknown()`. Range's value is `Type.Number()`, and Debounce's
`flushed` is `Type.Array(Type.Unknown())`.

### 3. `@composable/platform`: the systems, and a view of them

**Platform component:**
- **Holds:** the host registry (`host`), any named registries it creates, and a catalog of addable components (the
  bundle's).
- **Actions:**
  - `create-system(name)`;
  - `create-component({ kind, name, system })`, where `kind` comes from the catalog;
  - `add-to-system({ instance, from, to })`, which puts the same instance into another system;
  - `remove-from-system({ instance, system })`;
  - `connect({ system, source, op, listener, target })` and `disconnect({ system, id })`;
  - `select(selection)`.
- **Publishes:**
  - the getter `systems`, a `Snapshot[]`;
  - the event `selection-changed`;
  - the event `state-changed`, sent whenever any of its systems changes. It listens to each registry's deltas.
- **Compatibility:** "can connect" uses the editor's `joins`: same schema, or an input that takes anything.
  Connecting is only between actions in the same system.

**Platform view (`<c-platform>`):**
- **Filter:** a text filter at the top that matches system, component, op and type names.
- **By system / by component toggle:**
  - **By system:** system → components → actions → input and output types.
  - **By component:** component → the systems it's in, with an add icon to add it to another system.
- **Selecting and connecting:** clicking an action selects it and highlights it. With an action selected, hovering
  another action in the same system whose input fits shows a connect icon; clicking it calls `connect`.
- **Existing connections** are listed under their system, each with a remove icon.
- **A top-level Add button** creates a component from the catalog, with a name, in a chosen system.

### 4. `ui-workspace` on core

- `src/composable.ts` is rewritten:
  - one runtime over the registry `host`, provided on the document;
  - the platform, with the bundle catalog, added as `platform`.
- **Routes:**
  - **Overview:** a `<c-range>` in place of `flow-slider`.
  - **Workspace dock:** templates for every bundle element, `<c-platform>` and the new `<editor-page>`.
  - **Systems** (was Connections): `<c-platform>` beside a small worked example (range → debounce → log, and
    input → map → log), wired in `composable.ts`.
- **Package dependencies:**
  - **Dropped:** `@composable/sdk`, `widgets`, `puzzle-editor` and `connections`. The bus mirroring of
    composable notifications goes too.
  - **Added:** `@composable/core`, `runes`, `elements`, `bundle`, `platform` and `editor`.
- **Kept:** the shell (routes, dock, theme, notes, the sample mail and charts). It isn't composable.
- **Old packages:** `packages/puzzle-editor/test/host.test.ts` tests the old host, so it is deleted. Otherwise the
  old packages are untouched.

## Non-goals

- Connections across systems.
- Saving or restoring the host's systems.
- A sandbox for map and filter code.
- Showing composable events in the shell's activity log.

## Anti-goals

- Components knowing about the platform, or the platform knowing about specific components beyond its catalog.
- A file over ~200 lines.

## Settled by Claude (check these)

- **One instance can be in several systems** by being added to each registry (core's model). Removing it from its
  last system doesn't destroy it; the platform simply stops listing it.
- **The platform owns the runtimes.** Each system it creates gets its own core runtime. The host registry's runtime
  is created by `composable.ts` and handed to the platform.
- **Self-placed elements land in `host`**, and so appear in the platform tree like any other component.
- **An element attaches to a component that already exists, and creates one that doesn't.**
  - **`name` already in use in the host registry:** the element attaches to that instance and leaves it in place
    when the element goes.
  - **`name` not in use:** the element creates the instance, owns it, and removes it when the element leaves the
    page.
  - **No `name`** (a dock panel): it creates an owned instance under a generated name such as `c-log-1`.
  - **Two elements with one name:** both show the same instance.
- **The worked example is created in `composable.ts`** through the platform, so it lasts across route changes. The
  Systems page's elements name those instances and attach to them.
- **`host` is a system like any other.** It is listed first and can't be removed. Connecting and adding to other
  systems work on it the same way.
- **Running one instance in several systems needs nothing new.** Core already supports it: each system's runtime
  gives the instance a handle, so a call through either system reaches the same object, and its publishes go out to
  every system it's in (core's "one instance, two registries" test). Subscriptions belong to the system they were
  made in.
- **The editor's `joins` is already exported**, so the platform imports it from `@composable/editor`.
