# @composable/editor — design

## Intent

The puzzle prototype (`puzzles/PuzzlePrototype.dc.html`, reference only, never committed) is rebuilt as small,
separate rune components over `@composable/core`. Each component holds only the state it needs, and each one can be
tested without a UI. Thin web components sit on top. The editor is one of possibly many editors: nothing in it is
special to the core, and no domain concept flows back into core or runes.

## Goals

1. **Purely additive.** A new package, `packages/editor` (`@composable/editor`), depending on `@composable/core`,
   `@composable/runes`, `typebox` and `lit`. No change to core or runes.
2. **Core types used directly, with no mapping.**
   - **A type** is a TypeBox schema (JSON Schema) with its name in `title`. A record is `Type.Object(…)`, and a
     brand is a copy of its base schema with a new `title`. Brands are names only; nothing checks them.
   - **An available component** has core's `Snapshot` instance shape: `{ id: string; ops: Op[] }`.
   - **A design-time connection** is a core `Subscription` without its `id`: `{ source, op, listener, target }`.
3. **All of each component's state can be set and is published**, so a later save/load component can subscribe to
   it and call the setters.
4. **Small components, wired by subscriptions in one registry:**
   - **`component-list`:**
     - **State:** `components: { id, ops }[]` and the selection.
     - **Actions:** `set`, `add`, `remove`, `add-op`, `remove-op`, `select`.
     - **Sources:** `components`, and the events `component-selected` and `op-selected`.
   - **`type-list`:**
     - **State:** `types: TSchema[]` and the selection.
     - **Actions:** `set`, `add`, `rename`, `copy-as-brand`, `remove`, `select`, `update`.
     - **Sources:** `types`, and the event `type-selected`.
     - `update` replaces a type by its `title`; it is what an edited type comes back through.
   - **`type-editor`:**
     - **State:** one type and its look.
     - **Actions:** `edit(type)` to load it; `add-field`, `remove-field`, `set-field` (name and type), `set-look`
       (preset, colour) and `reset-look`.
     - **Event:** `type-changed` with `{ type, look }`.
     - It knows nothing about lists.
   - **`connection-board`:**
     - **State:** pieces on a grid, each `{ instance, op, cell: { c, r } }`.
     - **Actions:** `set`, `place`, `move`, `take-off`.
     - **Sources:** `pieces` and `connections`, where `connections` is *derived* from the pieces.
     - **Joining rule:** two pieces join when they are next to each other in a row, left to right, and the left
       piece's output schema equals the right piece's input schema, or the input is `Unknown`. Schemas are equal
       when their canonical JSON is equal.
   - **The composed editor** is a registry holding these four, with subscriptions. One wiring
     (`type-list/type-selected → type-editor/edit`, `type-editor/type-changed → type-list/update`) is a test.
5. **Web components on top.** One small shared adapter: a custom element given a registry and an instance id. It
   adds a hidden view instance that subscribes to the model's sources, re-renders when they publish, and calls the
   model's actions through its own handle. The UI is just another subscriber. On top of that sit one Lit element per
   component, plus an `<editor-page>` laying the four side by side the way the prototype does, with a demo page.

## Non-goals

- **Applying connections to a live registry.** The board only publishes them. A Workflow component does that later.
- **Save and load.**
- **The prototype's Code view (TypeScript text) and point-by-point shape editing.** Looks come from the hash, a
  preset or a colour pick. This is a later pass.
- **Matching the prototype pixel for pixel.** It must be recognisably the same layout and colours, not a copy of
  its markup.
- **Changes to the old `sdk`, `connections` or `puzzle-editor` packages.**

## Anti-goals

- A component whose state includes another component's concerns, such as a type-editor holding the type list.
- Any import of editor concepts into core or runes.
- A file over ~200 lines.

## Settled by Claude (check these)

- **Looks are reused.** The old `puzzle-editor/src/model/looks.ts`, with its presets, swatches and the look derived
  from a hash, is copied and adapted to take the hash of the schema's canonical JSON. The hash is a small
  synchronous one in the editor package, since the core has none and it must run in the browser.
- **A hand-picked look is stored separately from the type**, in the type-editor's `look` state, and goes out
  with `type-changed`. The schema itself stays pure JSON Schema.
- **Built-in types** `string`, `number`, `boolean` and `unknown` are always present in `type-list` and cannot be
  removed.
- **The demo page** is `packages/editor/demo/index.html`, run with `bun packages/editor/demo/index.html`. It seeds the
  list with a few components, such as slider, doubler and chart, so the board has something to place.

- **One payload shape for a type and its look:** `TypeEntry = { type: TSchema; look?: Look }`.
  - `type-list` holds `TypeEntry[]`, so hand-picked looks are kept and saved with the list.
  - `type-selected`, `type-editor/edit`, `type-changed` and `type-list/update` all carry a `TypeEntry`, so the
    wiring needs no mapping.
- **Names are changed in the list only.** `type-editor` edits fields and the look, not the title. `update` replaces
  the entry with the same `title`. After a rename of the selected type, the list publishes `type-selected` again,
  so the editor reloads it.
- **Equality and the look hash include `title`.** A brand is therefore a different piece on the board: it doesn't
  join its base type and has its own look. This holds at design time only; the core doesn't check it at runtime.
- **A record field holds a copy of the field type's schema.** ponytail: editing a type doesn't update records that
  already use it. Switch to references when that matters.
- **How a row becomes subscriptions.** For neighbours `L` then `R` in a row, the subscription is
  `{ source: L.instance, op: key(L.op), listener: R.instance, target: key(R.op) }`.
  - A piece with no output (a sink) only joins on its left, and a piece with no input (a source) only joins on its
    right.
  - "Takes anything" means the input schema without its `title` is `{}`, which is `Type.Unknown()`.
  - The same instance may be placed more than once.
- **The grid** has unbounded, non-negative integer cells. Neighbours are strictly `c + 1` on the same `r`. Placing
  or moving onto an occupied cell is refused with an error.
- **The demo's components:**
  - **slider:** source `value-changed` (number) and action `set` (number);
  - **doubler:** action `map` (number → number);
  - **chart:** sink `push` (number);
  - **meter:** sink `show` with a brand of number, `Meters`, to show a piece that doesn't fit.

## Left to the builder

- The adapter's exact API, and how elements find their registry (a property is enough).
- How a selection is represented, by id or by index.
