# Dependencies: components that name what they need, and a resolver that joins them

## Why

People will import and share components, such as an `acme/chat` widget that needs a database. Whoever runs the
component decides which database it gets: one the package ships (`acme/db`), one already in their app, or their own
(Postgres, local storage, AWS or GCP). They can also wrap one, such as validation with extra rules. Layered apps get
built the same way, top to bottom: app → BFF → API → storage. Each layer is a nano runtime, and the layers call each
other and await the results.

The spike in `spikes/layers/` (`nano.ts` and `example.ts`) proved the model with a "save a person" form across four
layers. This design turns it into the real thing.

## The model

- **Implementation:** plain, mostly functional TypeScript.
- **Interface:** a declared set of typed ops (TypeBox). Its id is the type coordinate, e.g. `example/db`.
- **Provider:** "`[X, Y, Z] => B`": an implementation of one interface, given clients for the interfaces it needs.
  - With no needs, it is `IO.pure`.
  - With needs, it is `IO.apply`: the dependencies are declared up front, so the whole graph is static data.
  - There is deliberately no `bind`/flatMap, i.e. no choosing a dependency at run time from a result.
- **Selector:** how a need says what it wants: an interface, plus optional tags, a layer, and a pinned instance.
- **Resolver:** `resolve(selector, context) → one instance, or why not`. It is isolated, swappable and tested on its
  own.
- **Binding:** the instance a need was resolved to. It is always recorded and visible, and always changeable.
- **Run time:** the resolved graph, run in observable runtimes. Every call between instances is schema-checked and
  traced by the runtime of the instance being called.

## Goals

1. **Interfaces and providers in core.** Generalise the spike's kit:
   - `iface(id, {op: {in, out, description?}})`;
   - `define(name, Interface, needs, deps => implementation)`;
   - typed clients, so `await deps.db.save(x)` is a schema-checked call through the target's runtime that returns its
     result.

   These must stay as easy to read as the spike's `example.ts`.
2. **Runes components can have needs.** A runes `component(...)`, i.e. a widget with an element, can declare needs,
   and its `make` receives the clients. A component with no needs is unchanged.
3. **Selectors and an isolated resolver.**
   - A selector is `{ implements: string; tags?: string[]; layer?: string; at?: string }`. `layer` is a system id
     (default: the requester's own system). `at` pins an instance id.
   - `resolve` is a pure function over a context: the candidate instances in the target system, each with the
     interfaces it implements and its tags, plus the catalog's providers. It returns:
     - `{ bound: coord }`;
     - `{ make: kind }`, when no instance fits and exactly one catalog kind does;
     - `{ choose: candidates }`, for ambiguity or nothing.
   - **The default policy:**
     - a pinned `at` wins, if it fits;
     - otherwise, exactly one existing instance that implements the interface and has every tag;
     - otherwise, exactly one catalog provider;
     - otherwise, the person chooses.
   - It never binds an instance to itself, so a wrapper's `inner` resolves to what it wraps.
   - "Implements" means the instance offers every op of the interface, by key (`<interface id>/<op>`).
4. **Bindings are recorded, live and changeable.**
   - **Bindings are first-class core data, not labels.**
     - A binding is `{ instance, need, to: Coord }`, held by the registry of the instance that has the need.
     - The registry gains `bind(instance, need, to)` and `unbind(instance, need)`, with matching `RegistryOps`.
     - `SnapshotSchema` gains `bindings`, next to `subscriptions`.
     - `DeltaSchemas` gain `binding-set` and `binding-cleared`.
     - Removing an instance clears its own bindings. Bindings that point *at* it stay, unbound in effect, so their
       calls fail clearly.
     - A component's declared needs (name and interface) appear on its snapshot instance, so views can show unbound
       needs.
   - **A binding vs a subscription.** A subscription is an event edge: an op to an action, many-to-many, within one
     registry. A binding is a call edge: one need to one instance, the whole interface, possibly in another registry,
     and its result is awaited. Neither replaces the other.
   - Clients call through the binding at call time, so rebinding a need takes effect on the next call without
     remaking the instance.
   - `registry.replace` at a bound id swaps the implementation live, as it does today.
   - An unbound need fails its calls with a clear error ("acme/chat needs db: not bound").
5. **The Application knows about needs.**
   - Ops to list an instance's needs (selector, binding and status), to set a need's selector, and to bind or unbind
     it.
   - An instance with an unbound need is **disabled**, and the `changed` source says so.
6. **Host UI in `ui-workspace`.**
   - **On create:** when a new instance has a need the resolver can't settle, a modal offers the matching instances,
     the matching catalog kinds ("make one"), and "Import a package…" (the existing import-by-URL). Cancelling leaves
     the widget disabled.
   - **Disabled widgets:** a disabled widget shows that it is disabled and what it needs, with a button that opens the
     same chooser.
   - **Dependencies panel:** on any instance, a panel lists its needs and their bindings. "Replace…" opens the
     chooser. Choosing an instance rewrites that need's selector (a pin, and the chosen instance's tags) and rebinds
     it.
7. **Saved and shared as data.**
   - `nano.json` instances gain `needs?: Record<string, Selector>`, holding the effective selectors (written whenever
     they differ from the component's defaults).
   - Loading re-resolves each need with the default policy, in document order. Pinned needs therefore come back
     exactly.
   - A need that won't resolve on load leaves its instance disabled, with a note, as other load problems are.
8. **The layered example ships as data.** The spike's "save a person" stack becomes:
   - real providers in a package (`packages/bundle` or a new example package);
   - a headless test in core/app that swaps storage and wraps validation;
   - a `nano.json` with four systems that a host can open.

## Non-goals

- A marketplace, and versioning of interfaces.
- Authoring interfaces or providers in the UI. Code defines them for now.
- Drawing dependency bindings in Circuit or `<c-wires>` (later; the snapshot's `bindings` make it possible).
- Fire-and-forget between layers as a separate feature. Code simply doesn't `await`, and events stay subscriptions.
- `bind`/flatMap, dynamic dependencies, and lifetimes or scopes (transient, per-request).

## Anti-goals

- **Implicit wiring.** A binding nobody can see, or one that changes without a recorded selector or binding.
- **The resolver buried inside instantiation.** It stays a separate function with its own tests.
- **A DI container, an effect system or a new runtime.** It is TypeBox, plain functions and the existing runtimes.
- **Breaking today's components, documents or subscriptions.** Needs are additive.

## Decided in conversation

- Implementations are vanilla TypeScript, and interfaces are declarative TypeBox. "Elysia-like" REST declarations
  were rejected.
- The layers are nano runtimes (systems), and they call and await across layers.
- The default resolution prefers an existing instance in the runtime that matches the type and the tags.
- Resolving is isolated so the policy can change later without changing anything else.
- Control matters: you can always see, and choose, which instance is actually used, live or at load.
- A package either ships a provider for what its components need or leaves it out. If it leaves it out, the host asks
  or disables the component.
- Everything persists to data so a configuration can be saved and shared.

## Rulings on the builder's questions (my calls)

- **Every binding is saved as a pin.** On save, each need's selector is written with `at` set to its current binding,
  like a lockfile. A reload therefore gives back the same graph, even after a wrap adds a second matching instance.
  Only an unpinned selector, typed by hand or shipped by a package, is resolved by policy.
- **Loading creates every instance first, then resolves every need.** This lets a need point at an instance later in
  the document or in another system.
- **Loading never makes instances.** A `{ make }` or `{ choose }` result on load leaves the instance disabled, with a
  note.
- **On create:**
  - If exactly one existing instance fits, the need binds without asking.
  - Otherwise the modal opens, offering existing matches, "make one" for matching kinds, and import.
  - Making one whose own needs are unsettled opens the next modal, one need at a time. Cancelling at any point leaves
    the requester disabled.
- **What "disabled" means:**
  - The instance is still made, and only calls through its unbound clients fail.
  - Calls into it still run.
  - Disabled doesn't spread to instances that depend on it.
  - Status is derived, not stored. "Disabled" means a declared need with no binding in the snapshot. The Application
    republishes `systems` on the binding deltas, as it does for any other change.
- **Widgets can be providers.** Runes `component(...)` gains an `implements` option that puts its ops under the
  interface's id. A storage provider can therefore have a view, such as a log of what was saved, to place next to the
  form.
- **Providers reach the catalog the way widgets do.** `define` returns a `Component`, which a package exports in its
  catalog as today. "Import a package…" therefore supplies providers unchanged.
- **The example's form is a visible widget.** The example `nano.json` opens to a workspace with the person form, plus
  the storage provider's view beside it. The BFF and API are placed too, so Wiring shows the layers.
- **Sandboxed components (the user's answer).**
  - In this round, a component with needs must be trusted and run in host mode, i.e. a consumer whose code runs in the
    host.
  - The design must still program to interfaces. A client talks only to `Runtime.call` (and `notify`), never to an
    instance's object, and a binding is a coordinate.
  - So the runtime doesn't care where the target runs. A sandboxed provider, which is already a proxy in its registry,
    can be bound and called today.
  - A sandboxed consumer is the later round: its clients cross the frame's messaging, and a binding grants its guard
    `allow` for exactly the bound coordinate. Nothing in this round may rule that out.
- **`layer` is an in-process system the Application holds, and tags are the Application's tags**
  (`instance:<system>/<id>`).

## Left to the builder

- Where the kit lives: core (`iface`, `define`, clients and `resolve`), with runes and app building on it, is my
  suggestion.
- The exact Application op names, and the modal's and panel's look, within the host's existing patterns.
- How "disabled" shows on a widget.
- How a `make: kind` result names the new instance.
