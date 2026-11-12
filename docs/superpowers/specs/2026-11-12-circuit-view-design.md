# Circuit view: the app's pages as a tilted stack of wired boards

## Why

Users build a big workspace, then save focused pages from it: "Dashboard overview", "Order entry", "Approvals". Once
they have several pages they need to see, per page, which components it holds and where those components are wired:
to services off screen, to other pages, to other systems.

Today's connections view (`<c-wires>`, `packages/wires`) flips one live dock to show its back. It can't show a page
that isn't open, it has no idea of pages at all, and its jacks are small. The Application now knows every page's
placements, every system and every tag, so a view of the whole app is finally possible.

The reference prototype is `designs/Circuit.dc.html`, with a screenshot in `designs/lift-off.png`.

## Goals

- **A new Circuit view on its own page,** showing the whole app: every page as a layer, plus the non-visual
  components and systems.
- **The default arrangement:**
  - A tilted stack of page layers, with one page in focus and the others faded in front of and behind it, like a
    carousel.
  - Non-visual components (services, gateways, systems) to one side, as a stack or a grid.
- **Pills to jump to a page or a system:** they pan and zoom to it, and bring a page into focus. "Whole board" shows
  everything.
- **Pages look like themselves.** Each page draws its components at their indicative boxes from the page's saved
  layout, whatever layout system produced it (golden-layout today, column or flex layouts later), without the page
  being open.
- **Large, prominent connection points.**
  - Shape shows the kind: round for an event, rounded-square for a call.
  - Colour and glyph show the data type: string `Aa`, number `#`, boolean `?`, object `{}`, array `[]`, signal `•`,
    any `*`.
  - Inputs are drawn hollow and outputs filled, with labels beside them.
- **Cables** (subscriptions) between pads, coloured by type. A cable that leaves a page ends at a component in the
  side area, or on another page's layer.
- **Lift-off covers:**
  - Each page component has a cover (its live UI as a plain card), which a Covers slider lifts off the board.
  - You can drag a cover away until it disappears, or select one and press Delete to hide it.
  - "Put covers back" restores them all.
  - Hiding a cover only affects this view.
- **Inspection:** clicking a pad, cable, component or system opens a details drawer. It shows kind, type, connected
  routes and description, with "Follow cable" to pan to the other end.
- **Live:** the view follows the Application's `changed` source, so it stays current as the app changes.

## Non-goals

- **Editing.** No connect, disconnect, insert-step or remove actions. Editing stays in today's connections view until
  a later round.
- **Lanes and Code views.** The view switcher has room for them, but they're not built now.
- **Packets in flight,** traffic counters, and the "last packet" sample.
- **Tag pills.** A tag's jump target is a set of components, not a place. They come later.
- **A new page-layout system.** That's its own work item. This design only defines the geometry shape a layout must
  produce.

## Anti-goals

- **Two sources of truth for what's on a page.** The view reads placements from the Application. It never walks the
  live dock's DOM to decide membership (today's `<c-wires>` does).
- **Golden-layout knowledge outside the host.** The Circuit view and its model never read golden-layout's format.
- **Changing today's connections view.** It stays as it is, as the reference and the editing surface.
- **Built-in plumbing drawn as if it were the user's components:** `registry`, `application`, `app`, `alerts`,
  `ws-controls-*` and element views.

## Decided in conversation

- The work is additive. `<c-wires>` stays. Circuit is one of several selectable views (Circuit, Connections, and
  later Lanes and Code).
- Pages (screens) are the main unit of layers. A system-per-layer arrangement is the same idea grouped by registry,
  and may come later.
- Stacked, side-by-side or grid arrangements are layout choices over the same layers. The default is the tilted page
  stack with non-visual components to one side.
- Positions are indicative of how each page is shown, so the representation must cope with golden-layout and with
  traditional layouts (fixed, column, flex, responsive).
- The view comes first. Editing comes later.
- The view is its own page, not an overlay on the current workspace.

## Prep step (do first)

These are the fixes from the smells review, and the new view needs them:

1. **Membership comes from the Application.** `<c-wires>` keeps its live geometry, but which instances are on screen
   comes from the Application's placements for its dock's screen.
2. **Hide built-in plumbing.** One shared predicate, exported from nano-app, says which instances are infrastructure:
   `RESERVED`/`HOST_DRIVEN` ids plus element views. Both `<c-wires>` and Circuit use it, so `app`, `alerts` and
   `ws-controls-*` leave the rack.
3. **`viewIds` moves** from `@composable/platform` (now Lit views only) into nano-app, since it's a pure function over
   a snapshot.
4. **Placements gain geometry** (see below).
5. **Naming:** `<c-wires>`' `platform` property and "through the platform" comments now say application.

## Placement geometry

`placementsOf` (the host-supplied function) returns more:

```ts
type Box = { x: number; y: number; w: number; h: number }   // fractions of the page, 0..1
type Placement = {
  screen: string; panel: string; instance: string
  box?: Box                                  // where it sits on the page; absent if the host has no geometry
  tab?: { group: string; active: boolean }   // panels sharing one box as tabs: same group, one active
}
```

- **Golden-layout** (in `ui-workspace`, next to today's `placementsOf`): walk the saved config's row and column tree,
  dividing each container's box among its children by their saved sizes (their `size` with `sizeUnit` `%` or `fr`;
  equal shares when absent). A stack's children all get the stack's box, with `tab` set from its active item.
- **Other layouts** (later) supply their own adapter returning the same shape. A responsive layout reports its boxes
  at one reference width (desktop).
- The Application stores the boxes as plain data. A placement without a box is drawn in an automatic grid on its
  page's layer.
- An inactive tab is drawn as a tab behind the active one (its title visible), not as a separate footprint.

## The Circuit model (pure)

A pure function builds everything the view draws, from:
- the Application's snapshots (systems, instances, ops, subscriptions);
- screens and placements (with boxes);
- the catalog's kinds and titles;
- the shared infrastructure predicate.

It returns:
- **Page layers:** one per screen, in nav order, each with its components (instance, kind, title, box, tab, pads).
- **The side area:** each system as a block, plus the non-visual components of each system that aren't placed on
  any page. Shared components are those placed on more than one page; they're marked as such on each layer they
  appear on.
- **Pads:** one per op an instance offers, with direction (in or out), kind (event or call) and data type. The type
  comes from the op's schema: string, number, boolean, object, array, signal (no payload) or any.
- **Cables:** one per subscription, between two pads. Both ends are resolved to where they're drawn: a page layer, or
  the side area.

The model lives in a pure package or module (no Lit, no DOM) and is unit-tested on its own.

## The view

- **A new Lit package** (`@composable/circuit`), with an element `<c-circuit>` given the host runtime. It calls the
  Application, builds the model, and renders it. Like `<c-wires>`, it reaches the Application through ops.
- **Its own page** in `ui-workspace` at `#/wiring`, titled "Wiring". It's reached from the profile menu (with
  Components, Settings, Systems and Themes) and from the workspace controls' Connections button, which keeps its
  current flip. The page opens with the current workspace's page in focus when reached from a workspace.
- **A view switcher** at the top, Circuit | Connections. Connections links to the existing flip view of the current
  workspace.
- **The stage:**
  - One 3D world: the page stack tilted, the focus layer opaque, its neighbours faded by distance.
  - Arrow keys or swipe move the focus. The side area sits to one side, and the minimap shows the whole board.
  - Drag pans and wheel zooms (pinch or ctrl+wheel), as today.
- **Pills:** "Whole board", one per page (in nav order, showing the page's icon and title), and one per system.
  Choosing one animates pan, zoom and focus.
- **Covers:**
  - Plain cards titled with the panel's title, lifted by the slider.
  - Dragging one past a threshold, or Delete on a selected one, hides it. "Put covers back" restores all.
  - Hidden covers are remembered per page for the session only.
- **Detail drawer:** the prototype's layout (kicker, title, chips, rows, schema), read-only. "Follow cable" pans to
  the other end.
- **Accessibility:**
  - Pads, cables, components and pills are focusable buttons with labels (e.g. "c-input-0.value, String, out").
  - The drawer is a labelled region.
  - The view honours reduced motion: no animated tilt, and no carousel animation.

## Rulings on the builder's questions (my calls)

- **One panel shows one instance.** A placement's box is the panel's box.
- **"Non-visual" means unplaced:** an instance in a system that no page places. There's no catalog flag; this is what
  today's rack does.
- **Placements stay in the screen's system,** as the Application already enforces. "Shared" means the same instance
  placed on several pages of one system. A layer is labelled with its system.
- **`box` and `tab` widen the Application's `PlacementSchema`** as optional fields. Placements aren't saved in nano.json
  (they're recomputed from layouts), so documents are unaffected. A screen with no layout has no placements, so its
  layer is empty.
- **Pads come from the snapshot's ops,** which carry their input and output schemas, as today's `<c-wires>` uses them:
  - an op with an input and no output is an event in;
  - an op with an input and an output is a call (one pad; its reply has none);
  - an op with only an output is an event out (a source).

  The data type comes from the relevant schema's type. No schema, or no payload, is a signal. An unknown or union
  schema is any.
- **Cables:** a subscription with an infrastructure end is dropped, not drawn dangling. Only the focused layer draws its
  cables at full strength. An end placed on other pages lands on the first of those pages in nav order, and an
  unplaced end lands in the side area. A system block in the side area is a labelled box grouping that system's
  unplaced instances. It has no pads of its own.
- **Focus on arrival:** `ui-workspace` remembers the last workspace route shown (from `route:changed`) and gives it to
  `<c-circuit>` as its `focus`. With none, the first page is in focus. The switcher's Connections entry goes to that
  workspace and flips it. It's hidden when no workspace has been shown.
- **Covers are title cards only.** Nothing live is mounted, so sandboxed and headless components need nothing special.
- **Inactive tabs:** drawn as tab labels on the active tab's box. An inactive tab's cables attach to its label.
- **The spec's list is binding.** The prototype is a reference for look and feel, not a parity target.

## Left to the builder

- The visual constants (colours, sizes, tilt angles, fade curve) within the prototype's look.
- How the pure model is split across files, and whether it lives in nano-app or the new package's own pure module.
- How cables route (orthogonal like the prototype, or curved), as long as they're legible.
- The minimap's exact rendering.
