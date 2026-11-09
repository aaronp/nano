# Wires: the workspace's connection view — design

## Intent

A connections icon in the Workspace tilts the **live** dock in 3D to show what is behind it: every panel's jacks
(its component's ops), the rack below (components in the system with no panel), and the real connections between
them, pulsing as real messages flow. You connect components there. The view is a faithful port of the wires
prototype (`wires/Main.dc.html`, reference only, never committed), in both its modes. **Relay wires** and **Puzzle
blocks** are two renderings of one data model: the host system's components and subscriptions. The goal is a
visual pipeline: an input, then map, debounce and so on, with every step in between visible and wired from the back.

## Goals

1. **A trace hook in core.**
   - **API:** `runtime.listen(fn): () => void`, the counterpart of `registry.listen`. It reports, as plain data:
     - each **call**: `{ kind: 'call', time, from, target, op, data, result }`;
     - each **publish**: `{ kind: 'publish', time, from, op, data, result }`;
     - each **delivery**: `{ kind: 'delivery', time, from, target, op, data, subscription, result }`.
   - **Policies:** a policy-wrapped runtime passes `listen` through.
   - **Later:** histograms, pause, rewind/replay and snapshots all build on this. They are not part of this design.
2. **`@composable/wires`.** A faithful Lit port of the prototype's flip-to-wire view: same markup, inline styles,
   SVG and interactions, in its own shadow DOM, independent of the site theme.
   - **The front pane is the real dock.** `<c-wires>` takes the live `<workspace-dock>` as its child and rotates it
     in a `transform-style: preserve-3d` stage. The components keep running while it turns.
   - **Camera:** Front, Angled, Back or Under, and float height, as in the prototype.
   - **Relay wires mode:**
     - Jacks sit on the back of each panel and on each rack module.
     - A wire is a cord from an output jack to an input jack, drawn as the prototype draws it.
     - A wire pulses when the trace reports a delivery on its subscription.
   - **Puzzle blocks mode:** the same connections laid out as chains of interlocking pieces on the back of the pane,
     with leads to each widget and rack box, as the prototype lays them out. That includes forks (one output to
     several inputs) and combines (several outputs into one).
   - **The right panel:**
     - **View** and the mode toggle;
     - **Operators:** the host's merged catalog. Adding one puts a new component in the rack, through the platform's
       `create-component`.
     - **Routes:** each connected group of components, coloured, with its connections;
     - **Legend.**
3. **The data comes from the system, and edits go back to it.**
   - **The model:** the host registry's snapshot, plus the panels' positions read from the dock and the trace.
     - **A panel's component** is the `model` of the composable element inside it. A panel without one, such as
       Notes, has no jacks.
     - **Jacks:** an op with an input is an **in** jack; an op with an output and no input is an **out** jack.
     - **The rack:** every instance with no panel. That excludes `registry`, views, and the platform itself.
     - **Routes:** the groups of components connected to each other by subscriptions.
   - **Connecting:** drag from an out jack to an in jack, or join pieces in puzzle mode. It calls the platform's
     `connect`, and only fitting inputs light up (`Ops.fits`).
   - **Disconnecting:** deleting a wire or a joint calls `disconnect`.
   - **Deleting a component:** deleting a rack module or piece calls the platform's `remove-from-system`, which now
     also closes the subscriptions where that component is the source.
4. **Closing a panel sends its component to the rack.**
   - **Dock panels never remove their instance.** Placed elements get a `keep` attribute, and the dock's templates
     set it. A closed panel's component stays in the system with its state and connections, and shows in the rack.
   - **Dragging a rack module onto the front** opens it as a dock panel again. The panel uses the element from the
     catalog entry whose component the instance was made from, attached to the same instance by name.
5. **The connections icon** in the Workspace toolbar toggles the tilted view and the right panel. Flipping back
   restores the plain dock.

## Non-goals

- Pause, rewind/replay, histograms, state snapshots, undo/redo. They come later, on the trace hook.
- Connections across systems. The view shows the host system.
- The prototype's simulated widgets and simulated traffic. Ours are real.

## Anti-goals

- A second data model for connections. Wires and puzzle pieces are both drawn from subscriptions.
- The wiring view knowing particular components. It sees ops, schemas and the catalog only.
- A file over ~250 lines.

## Settled by Claude (check these)

- **Wire colours** come from the route, and routes are assigned colours from the prototype's palette in order.
- **Saving and reverting** are dropped. The prototype's Save, Revert and Reset acted on its own simulated graph,
  while ours edits the live system directly.
- **Jacks are laid out by the prototype's rules** for each panel's real size: out jacks along the top of the panel's
  back face, and in jacks along the bottom.
- **Only one dock is tilted:** the Workspace route's.
- **A transform's input and output are separate ops,** as our components already have them. Map takes `map` (an in
  jack) and publishes `mapped` (an out jack); Debounce takes `enqueue` and publishes `flushed`.
  - **A wire** always goes from a publishing op to an op with an input. In puzzle mode a component's piece shows its
    in jacks on the left and its out jacks on the right, and a chain is those wires laid end to end.
  - **Actions that return a value but don't publish** (call-style, the prototype's "aux" jacks) get no jack. A
    subscription can't use them.
- **Rack drawing:** a rack component with no out jack, such as a Log, is drawn as the prototype's store **block**
  (the 3D box, like "Audit Log"). Every other rack component is drawn as an operator **module**.
- **The Operators palette** is the merged catalog as it stands: bundle's input, range, log, debounce, map and
  filter, plus the editor's parts.
- **Route names are generated,** as `<first source> → <last sink>`. Colours don't persist when a route merges or
  splits.
- **A rack module's element** is found by identity. An instance keeps a reference to its component, so the catalog
  entry is the one whose `component` is the same object. No change to the registry.
- **The trace is synchronous.** `time` is `Date.now()` taken in the runtime, and each delivery carries its
  subscription's id.
