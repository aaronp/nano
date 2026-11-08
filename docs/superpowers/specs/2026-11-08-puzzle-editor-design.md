# Puzzle editor: a case study in composition and isolation

Date: 2026-11-08. Status: reviewed (builder check); calls marked *(call)* settle its questions.

## Intent

The puzzle prototype (`puzzles/PuzzlePrototype.dc.html`) lets someone design types, components with typed
actions, and connections between them, shown as jigsaw pieces whose edges are the types. We rebuild it on the
`@composable` SDK as a **litmus test of the SDK itself**: if the editor can be written as an isolated System of
small single-purpose components, bundled as one widget *and* usable piece by piece in other Systems, and wired to a
real System with no glue code, the SDK's model (components, ops, Systems, links, composites) is doing its job.

## Goals

1. **Lift the prototype into SDK terms.** The editor's document uses SDK types directly: TypeBox schemas (identified
   by `typeHash` SAIDs), `Manifest`s, and connection/chain intents from `@composable/connections`.
2. **Isolation.** The editor is a composite: its own System, where children each own a slice of state and talk
   only through ops. Nothing outside reaches its internals.
3. **Composition.** One bundled `<puzzle-editor>` that looks like the prototype, and the same pieces standalone:
   `<type-editor>`, `<component-list>`, `<connection-editor>`, each placeable in any System.
4. **Chains as actions: out of scope here.** Exposing a chain A → B → C as one action belongs in its own package,
   built on the SDK rather than in it. *(user, after review)* The editor does not need it in v1.
5. **Plugs into a real System without mapping.** Because the editor's inputs are SDK types, a host links a System
   component's `changed` (an `Instance[]`) straight into the editor's `set-instances` (one link), and the editor's
   `intents-updated` straight into an orchestrator's `set-intents` (one link).

## Non-goals (for now)

- Map components (user-written TypeScript transforms). They need a sandbox (Worker/iframe) and an editor of their
  own; a later project. Draft components authored in the editor stay design-only until then.
- Database / IndexedDB sinks. They are ordinary components that can be linked to `model-updated` later.
- Cardinality rules (how many instances a component may have).

## Anti-goals

- The editor must not reach into a System's runtime directly (no `SystemRuntime` in its components). Everything
  it knows arrives through its ops; everything it produces leaves through its ops.
- No second data model beside the SDK's ("elements/actions" from the prototype map onto manifests/ops; there is no
  translation layer to maintain).
- No new SDK concepts beyond subscriptions as data, `Systems.restrict` and the orchestrator's ops (below). The SDK stays the
  solid core (Components, Ops, Systems, pub/sub/actions); anything built from those lives in its own package.

## Decisions

### 0. Prerequisite (SDK): a System keeps its subscriptions as data

Today a link made with `connect` is recorded, but a component's own `handle.subscribe` is not visible to anyone,
and link changes are not announced as deltas. Subscriptions become first-class data of a System:

```ts
type Subscription = {
  id: string
  source: InstanceId | '*'    // whose output ('*': anyone)
  op: string                  // which output op (a source, or an action whose outcome is used)
  listener: InstanceId        // who receives it
  target?: string             // the listener's op it feeds (made by someone else); absent: the listener's own handler
}
type System = { id: string; manifest: Manifest[]; instances: Instance[]; subscriptions: Subscription[] }
type SystemDelta =
  | { type: 'added'; instances: Instance[] } | { type: 'removed'; instances: Instance[] } | { type: 'manifest'; manifest: Manifest[] }
  | { type: 'subscription-opened'; subscriptions: Subscription[] } | { type: 'subscription-closed'; subscriptions: Subscription[] }
```

- **One concept.** `system.subscribe({ source, op, listener, target })` replaces `connect` (a link is a subscription
  with a `target`); a component's own `handle.subscribe(op, fn, { from })` records a subscription with
  `listener = itself` and no `target`. `system.unsubscribe(id)` removes either kind. `links()` goes away.
- **Every change is a delta**, whoever made it: opening one (`system.subscribe`, or a component's own
  `handle.subscribe`) sends `subscription-opened`, and closing one (`unsubscribe`, the returned unsubscribe function,
  or an instance being unregistered, which closes all its subscriptions) sends `subscription-closed`. Like the other
  deltas they reach every component registered in the System through `onSystemUpdated` (and the owner through
  `updates()`), so any component sees subscriptions come and go.
- **Rich results, not exceptions.** The runtime's `register`, `subscribe`, `unsubscribe`, `bind` and `unbind` return
  `Result`s (`subscribe` → `Result<Subscription>`), like `call` and `notify`.
- **The core is permissive; restriction is a view you pass in.** Any holder of a System may subscribe or unsubscribe
  any instance. `Systems.restrict(system, as)` returns the same API that answers `not-allowed` for anything that
  involves an instance other than `as` (a subscription whose listener is not `as`, unsubscribing someone else's,
  binding another's dependency). That is how a component is given only power over itself; other restrictions are
  written the same way.
- The System component's ops follow: `subscribe`, `unsubscribe`, `subscriptions` and the source
  `subscriptions-changed` replace `connect`, `disconnect`, `links` and `links-changed`. The orchestrator and binder
  use `subscribe` / `unsubscribe` and react to deltas as before.

This lands before the editor. It is what explicit user linking, configuration-driven page wiring and policies are
built from: components that read `subscriptions` and call `subscribe` / `unsubscribe`.


### 1. The document

The prototype's model is lifted as it is: types and draft components have **stable ids** while being edited, and
TypeBox schemas, SAIDs and manifests are *derived* from them. *(call; review Q4)* An edit or rename therefore carries
through to every field and op that uses the type, and a custom look stays with its type.

```ts
type TypeRef = { type: string /* EditorType id */; array: boolean }
type Look = {
  shape: { start: [number, number]; segs: { c1: [number, number]; c2: [number, number]; p: [number, number] }[] } // the prototype's bezier edge
  colour: string
  pattern: 'none' | 'diagonal' | 'anti-diagonal' | 'vertical' | 'horizontal' | 'dots'                          // marks a brand
}
type EditorType =
  | { id: string; kind: 'primitive'; name: 'string' | 'number' | 'boolean' }                      // built in
  | { id: string; kind: 'record'; name: string; fields: { name: string; ref: TypeRef }[]; look?: Look }
  | { id: string; kind: 'brand'; name: string; of: string /* EditorType id */; look?: Look }
  | { id: string; kind: 'live'; schema: TSchema }                                                   // from a live manifest; id = its SAID; read-only
type DraftComponent = { id: ComponentId; ops: { name: string; description?: string; input?: TypeRef; output?: TypeRef }[] }
type EditorDoc = {
  types: EditorType[]                       // built-ins and drafts; live types are not saved (they come from the System)
  components: DraftComponent[]              // drafts only; live components come from the System
  connections: { intents: Intent[]; layout: Record<string /* workflow id */, { c: number; r: number }> }
}
```

- **Schemas and SAIDs are derived.** `schemaOf(type, types)`: a record is `Type.Object(fields, { $id: name })`, a
  brand is the target's schema with its own `$id`, an array field is `Type.Array(...)`. A type's SAID is
  `typeHash(schemaOf(...))`, which replaces the prototype's SHA-256 of its own canonical text.
- **Looks.** A type with no `look` gets one derived from its SAID (a preset family plus SAID bytes for the shape;
  colour and brand pattern from SAID bytes), so editing it changes its look, as in the prototype. Editing the shape
  stores a `look` on the type (by id), which then stays through edits.
- **Live types** are collected from the manifests of live instances (each distinct schema, by SAID). They are
  read-only and shown with their own section, like the built-ins.
- **Components.** Draft manifests are derived from `DraftComponent`s. Live components come from `set-instances`.
  *(call)* If a live component has the same `ComponentId` as a draft, the live one is used and the draft is marked
  *implemented* (kept, not deleted). Chains through a draft with no live instance are not viable (`no-match`).
- **Connections** are exactly the current `connection-designer` document: workflow intents laid out as contiguous
  rows on the board (`layout`), plus fan-out connection rules. Its pure model (`palette`, `place`, `take`, `move`,
  `pin`, `toggle`, …) moves into the editor package unchanged.
- **Board joins are horizontal only in v1** (input on the left, output on the right). The prototype also allows
  inputs on the top and outputs at the bottom; that needs branching layouts and is left for later.

### 2. Components inside the editor (its System)

| Child | Owns | In (sinks / actions) | Out (sources) |
|---|---|---|---|
| `type-editor` | `types` (built-ins, drafts) and the live types it is given | `set-types (EditorType[])`, `set-live-types (TSchema[])`, edit actions (add record, add field, add brand, rename, delete, set shape/colour/pattern) | `types-updated` (all types, with derived schemas, SAIDs and looks) |
| `component-list` | `components` (drafts) and live instances | `set-instances (Instance[])`, `set-drafts (DraftComponent[])`, `set-types`, edit actions (add draft component, add/remove op, set op types) | `components-updated` (live + draft manifests), `instances-updated (Instance[])`, `live-types (TSchema[])` |
| `connection-editor` | `connections` and a **Live** switch | `set-connections`, `set-components`, `set-instances`, `set-looks`, edit actions (place, take, move, pin, toggle, add rule, remove), `set-live (boolean)` | `connections-updated`, `intents-updated` (only while Live is on; `[]` when switched off) |
| `document` | nothing | `load (EditorDoc)`: calls `set-types`, `set-drafts`, `set-connections` in turn | `model-updated (EditorDoc)` |

Internal links (made with `route` in the composite):

- `type-editor.types-updated → component-list.set-types` and `→ connection-editor.set-looks`
- `component-list.components-updated → connection-editor.set-components`
- `component-list.instances-updated → connection-editor.set-instances` *(call; review Q2: `set-instances` is owned by
  one child and forwarded inside, so the host links it once and no new SDK concept is needed)*
- `component-list.live-types → type-editor.set-live-types`
- the three `*-updated` sources → the `document` child, which keeps the latest of each and notifies `model-updated`

The composite (`puzzle-editor`) exposes `document.load`, `document.model-updated`, `component-list.set-instances`,
`connection-editor.intents-updated` and `connection-editor.set-live`, under the children's own op names, as
`compose` does today. *(call)*

- **Live.** *(call; review Q3)* Board edits never touch a real System unless the user switches **Live** on, as the
  current designer does. While on, every change notifies `intents-updated`; switching it off notifies `[]`, so a
  linked orchestrator removes what it made. Per-intent enabled flags stay as they are.
- **Status.** *(call; review Q5)* `connection-editor` plans locally (`plan` over the live instances it is given), so
  status shows standalone and bundled, with or without an orchestrator. There is no `set-status`.
- **`load`** *(call; review Q1)* is an ordinary action on the `document` child that calls the three `set-*` sinks
  through its handle in the editor's System. It does not use `pipe`.

Each child owns its state in the `define` model (`state`) and notifies on every change; views re-render from it.

### 3. `pipe`: moved out

Chains as one action (a `pipe`) are not an SDK feature. They come later as their own package, built on System calls
(see Follow-ons).

### 4. The orchestrator gets ops

So the editor can drive it through a link rather than code, the orchestrator policy component gains a
`set-intents (Intent[])` sink. A host links `puzzle-editor.intents-updated → orchestrator.set-intents`.
`Orchestrators.create(system, intents)` keeps working; `status()` stays a host API.

### 5. Views

- `<puzzle-editor>`: a close port of the prototype's layout and visual values (left panel with Elements/Types tabs,
  List/Code views, "+ New record type", built-ins, the board, the status line "N placed · N connections · N problems",
  Show model, Clear all, and the shape editor dialog with starting shapes, colour swatches, brand patterns,
  add/remove point and mirrored handles). Values are replicated in Lit with the `--c-*` theme tokens, not copied.
- `<type-editor>`, `<component-list>`, `<connection-editor>`: each the corresponding part of that UI as a standalone
  `View` with a `static factory`, placeable in any System.
- The Types *Code* view prints types as TypeScript (as the prototype's "Types as TypeScript") and parses edits back
  (records, fields, arrays, `type X = Y` brands), reporting line-numbered errors as the prototype does.

### 6. Package layout

- `packages/puzzle-editor`: `model/` (pure: document, types and looks, components, the board model moved from
  `connection-designer`), `components/` (the four children and the composite), `views/` (Lit).
- Subscriptions as data, rich results, `Systems.restrict` in `@composable/sdk`; orchestrator ops in
  `@composable/connections`.
- `packages/connection-designer` is removed once `<connection-editor>` replaces it; `ui-workspace`'s Connections
  page hosts `<puzzle-editor>` linked to the page System as in goal 5.

## Testing

- SDK subscriptions: both kinds recorded and listed, deltas for each change (whoever made it), `unsubscribe` of
  either kind, `subscription-opened` / `subscription-closed` reaching every registered component (including closes
  caused by unregistering), results instead of throws, `Systems.restrict` refusing others with `not-allowed`.

- Pure model: type/brand → schema and SAID, edits and renames carrying through by id, look derivation and custom
  looks surviving edits, live types collected by SAID, draft vs live components, the board edits (existing tests
  move), TypeScript print/parse round trip.
- Components: each child through a System (`set-*` in, `*-updated` out); the composite end to end (`load`,
  model-updated after edits, Live gating `intents-updated`, internals not visible from outside).
- Integration: a page System with a System component and an orchestrator, linked to `<puzzle-editor>` with no glue
  code; a chain designed on the board becomes viable and carries data.
- Views: happy-dom tests for placement, drag and drop and the shape editor's point editing.

## Left to the builder

- File splits inside the package, internal state shapes, helper names.
- How look presets are parameterised from SAID bytes, as long as it is deterministic and close to the prototype.
- The exact visual values: replicate the prototype's inline styles faithfully through the theme tokens.

## Follow-ons (after the editor; each its own package on the SDK)

- **Platform:** a Platform System that creates and registers other Systems and answers "which components are in
  this System" and "which Systems is this component in".
- **Chains:** a chain component (the old `pipe`): steps as component coordinates plus ops, exposed as one action,
  checked against the steps' types.
- **Workflow list:** a component that instantiates named chains (slider → debounce → map → log → database) from the
  puzzle editor's declarative workflows.
