# Wrappers: replace, HasRuntime, strategies, hiding by owner

## Why

A running instance should be wrappable without its neighbours knowing: whatever was routed to instance X (calls and
deliveries) goes to a wrapper first, which can buffer, log, notify, fan out, race, or map before delegating — AOP
around a live component. Uses: observability on every message in and out; buffering while the inner component is
swapped (local storage → remote storage); turning a point-to-point call into a broadcast or a race; replacing one
part of a "works out of the box" reference implementation with your own.

The same mechanism is a composite component (A → B → C exposed as one component with its own runtime): a wrapper is a
composite with one part. So this design is also the basis for bundles.

Write as little as possible: reuse Registry, Runtime, Policy, Trace, Owner and subscriptions; close small gaps only.

## Goals

1. **`Registry.replace(id, inst, owner?)`** — swap what sits at an id, keeping every subscription that names the id
   (as source or listener). The one new core operation.
2. **`HasRuntime { runtime: Runtime }`** and a guard **`hasRuntime(v)`** — the type a composite's value has. Its
   runtime holds the parts, under their own ids. Anyone with the value can replace a part, rewire, call into the
   parts, or watch their traffic (`runtime.listen`).
3. **Wrappers** — `wrap(...)` turns a live instance X into a wrapper at X, with X inside the wrapper's runtime; a
   **strategy** decides where each call goes. Built in: forward, broadcast, race, buffer. Optional op mapping.
   `unwrap` puts the original back.
4. **Hide by Owner, not by id** — views stop parsing `~view` out of instance ids; they hide entries whose owner kind is
   `view`. The `~view-N` id stays as a plain unique id.

## Non-goals

- Sandboxing (iframes), Blueprints (portable packages, desired state), layouts — separate designs, later.
- Tree / table / wires drilling into a HasRuntime instance. `hasRuntime` makes it possible; the view work is next.
- Interchangeable components "for free". Making a different component fit is the wrapper's job (op mapping), not the
  framework's. No interfaces/typeclass system.
- Following an inner part's dynamically registered ops (`env.register` after wrapping).
- Carrying state from an old part to its replacement. A swap moves traffic, not data.
- Platform systems as HasRuntime: the platform holds many runtimes (`State.systems`); it stays as is.

## Anti-goals

- Stringly-typed structure: no `X~inner` ids, no new id conventions to parse.
- A wrapper visible to X's neighbours: their subscriptions, op keys and calls must not change.

## Design

### 1. `Registry.replace(id, inst, owner?)` (core)

- Errors if nothing is at `id`.
- Puts `inst` at `id`. Subscriptions are untouched (they name ids). Owner: the given one, else the existing entry's.
- Emits a new delta **`instance-replaced`**: `{ type, instance, ops, component, description?, owner? }` (the same
  fields as `instance-added`, describing the new instance), added to `DeltaSchemas` with a description, so it is also
  a `RegistryOps.deltas` source and a registry op.
- The runtime handles it like removed-then-added for environments: the old instance's env loses its handle for this
  registry, the new one's gains it. No `instance-removed`/`instance-added` are emitted, so nothing that reacts to a
  removal (closing subscriptions, `PlacedElement` cleanup) fires.
- A `replace` registry op (`RegistryOps.replace`), typed and described like `add`.

### 2. `HasRuntime` (core)

```ts
export type HasRuntime = { runtime: Runtime }
export const hasRuntime = (v: unknown): v is HasRuntime => …   // has a runtime with call, notify, listen and registry
```

A live object: it does not cross an iframe. Remotely, the inner runtime's own `registry` instance and its ops give
the same access — nothing extra needed now.

### 3. Wrappers (core, one new file `wrap.ts`)

```ts
wrap(outer: Runtime, id: string, strategy: Strategy, opts?: { map?: Record<string, { part: string; op: string }>; owner?: Owner }): Result<Wrapper>
unwrap(outer: Runtime, id: string): Result<void>
```

- **The wrapper's component** has X's component id and description, and offers every op X offers (same keys), plus its
  own control ops in the `composable/wrapper` namespace (below). Keeping X's component id means the inventory still
  shows it as that kind. (Builder's call how the component is assembled.)
- **Its value** is `HasRuntime` (plus whatever the strategy keeps): a fresh registry (id: builder's call, unique) and
  runtime. X's original instance is added there **under the id X**. More parts can be added through the runtime.
- **Calls and deliveries in** — each of X's op keys that has a run runs the strategy, which calls parts through the
  inner runtime (`runtime.call`), so every hop is a `Trace` on the inner runtime. The wrapper's actions do **not**
  copy X's `emits`; X's source-only ops (no run) are offered as sources only. So every publish out comes from one
  place, the republish below, and none happens twice.
- **`from`** — every call the wrapper makes, into a part or on to the outer runtime, is from the wrapper's outer
  coordinate `{ registry: outer.registry.id, instance: X }`.
- **Publishes out** — the wrapper listens to the inner runtime's traces; a successful `publish` by a part of an op the
  wrapper offers is republished from the wrapper's own env, so X's neighbours see it from X as before.
- **Calls from a part to its old neighbours** — the inner runtime is created with a `Policy` that sends a call whose
  target is not in the inner registry, or is `registry`, on to the outer runtime, from the wrapper's coordinate. A
  part keeps working as if it were still in the outer registry. Accepted limit: a part calling an outer neighbour
  whose id is also a part's id reaches the part (inner wins). Whoever adds parts picks their ids.
- **`wrap` order** — instantiate the wrapper (it makes its inner registry and runtime), `outer.registry.replace(id,
  wrapper, owner)` (X's env loses its outer handle), then add X to the inner registry (X's env gains the inner one).
  X's env never holds both. The outer entry keeps its
  existing owner unless one is given (the widget that placed X still owns X). Inside, X's original is owned by
  `{ kind: 'wrapper', name: id }`.
- **`unwrap`** — errors unless the instance at `id` is a wrapper with exactly one part. Removes the part from the
  inner registry first (its env loses the inner handle), then `outer.registry.replace(id, part)`. The wrapper and its
  inner runtime are dropped; the part publishes once, to the outer registry only.
- **Op mapping** — `map[outerOpKey] = { part, op }` sends that outer op to a different part and op key, for a part
  whose ops have different keys. Unmapped keys go to the part(s) by the same key.

**Strategy**

```ts
type Strategy = (op: string, arg: unknown, parts: string[], call: (part: string, op: string, arg: unknown) => Promise<Result>) => Promise<Result>
```

`parts` are the inner registry's instance ids except `registry`, in order added. Built in:

| Strategy | One call |
|---|---|
| `forward` | to the first part. Logging = `forward` + `runtime.listen`; no separate strategy |
| `broadcast` | to every part; value of the first success, `detail` = every result; error only if all fail (a part without the op counts as a failure) |
| `race` | to every part at once; first success wins; losers run to the end and are ignored (there is no cancel); error (with every error in `detail`) if all fail |
| `buffer(inner = forward)` | while paused, queue; on resume, run the queue in order through `inner`, and calls arriving during the drain queue behind it; while not paused, `inner` |

The value returned stays the op's own type; extra results go in `detail`. A mapped op's input is checked by the outer
runtime against the outer op, then by the part against its own op: a mismatch is that hop's error.

**Control ops** (registered on the wrapper, `composable/wrapper/*`, typed and described): `pause`, `resume`
(meaningful with `buffer`; others ignore them) and `parts` (`Null → string[]`). Swapping a part is
`wrapper.runtime.registry.replace(partId, newInst)` — through HasRuntime, or remotely through the inner registry's ops.

**Buffered calls stay pending until resumed.** A caller awaiting one waits; a publisher's delivery loop waits too.
runes doesn't await its publishes, so its components don't stall. Bounding the wait (timeout, max queue) is left out
until needed.

### 4. Hide by owner (platform, wires)

Replace the `~view` id checks — `platform/src/view.ts` (two), `wires/src/model.ts` (two), `wires/src/render-detail.ts`
— with "the entry's owner kind is `view`", read from the snapshot. Subscriptions whose listener is such an entry are
hidden as before. The `registry` and platform-id checks stay.

## Testing

- replace: keeps subscriptions both ways; emits `instance-replaced` and not removed/added; an unknown id errors; the new
  instance publishes and receives through the runtime; the old one no longer does.
- wrap with forward: a neighbour's call and a subscribed delivery reach the part; the part's publish reaches X's
  subscribers from X; a part's call to an outer neighbour works; the inner runtime traces each hop; unwrap restores.
- broadcast, race, buffer (pause → calls pending → swap the part → resume → the new part gets them in order), map.
- A runes component and a `ModelElement` view on X keep working across wrap and unwrap.
- Views: an entry owned by a `view` is hidden whatever its id; one named `~view` but owned otherwise is shown.

## Calls I made (check these)

- `Owner.kind` is a free string; `wrapper` joins its examples.
- Code lives in core (`wrap.ts`), not a new package: it only uses core.
- The wrapper keeps X's component id, so it reads as the same kind everywhere.
- `replace` emits its own delta rather than removed + added.
- Logging is not a strategy: it is the inner runtime's traces.
- Views drilling into wrappers is the next design, not this one.
