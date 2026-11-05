# Composable Components — Proof-of-Concept Design

Date: 2026-11-05
Supersedes, for PoC purposes: `composable-widgets-mvp-spec.md` (still the long-term reference).

## Intent

Prove a small, typed messaging API that lets components compose into an event-driven data flow, independent of where they run. Web components on a dashboard are the first consumer, not the centre of the design.

The centrepiece is the **`Context`**: the only thing a component uses to talk to the world. It has two intentions, fire-and-forget (`emit`) and direct invocation (`call`), plus `capabilities()` for discovery. Every other concern (routing, policy, filtering, debounce, tracing, transport) is a separate, small `Context` implementation that typically wraps another `Context`. This is a very lightweight ZIO or Scalaz Streams for UI components: `Contexts.debounce(underlying, 100)`.

Transport is invisible to components. In the PoC the base is an in-page bus plus an iframe bridge. Streaming and REST contexts should later drop in without changing component code.

The long-term aim is a **remix ecosystem**. An author ships a suite of components plus a "batteries included" component that composes them. Another author builds on top, enriching events or wiring one component into another. The user decides what is switched on.

## Goals

1. A tightly typed core (`ComponentId`, `Manifest`, `Instance`, `Invocation`, `Result`, `Capabilities`, `Context`, `Component`, `ComponentFactory`) built with TypeBox. Every schema and field carries `title`/`description`/`examples` that justify its purpose.
2. A `Contexts` namespace of small, composable, independently unit-tested implementations.
3. One component API that works the same way whether a component is compiled in, loaded at runtime from a URL, or running in an iframe on another origin.
4. Hosts are ordinary components. Nesting works without special cases.
5. A cloneable component template.
6. `make ui` shows it working in a browser.

## Non-goals (for the PoC)

- Automated browser tests. Watching `make ui` is the acceptance test. Core logic is unit tested.
- Export repos, CI, GitHub Pages, package publishing, theming, layout persistence, Gridstack, drag-and-drop.
- Network/stream/REST contexts. The design must allow them, but none is built.
- Durable or exactly-once delivery.

## Anti-goals (would be a failure even if the demo works)

- **Stringly-typed identifiers.** Never encode structure as `"author/id@event"` in APIs or data. Use `{ author, id }`, `{ namespace, instance }`, etc. Strings are for display only and are never parsed.
- **One big platform library or central mediator.** Concerns live in separate small contexts.
- **A fat `Context` interface.** It stays at `capabilities`, `emit`, `call`. Extra operations go on subtypes (below).
- **Components that know their transport, or that create their own bus when hosted.** An iframe component that fails its handshake must show an error, not fall back to a local bus.
- **Untyped payloads.** Payloads are checked against the manifest schemas.

## Core model

The TypeBox shapes are indicative. The builder tightens them, but names and structure are as agreed.

```ts
// build-time coordinates: fixed by the author, unique within their author namespace
ComponentId = { author: string; id: string }

EventDef   = { name: string; schema: TSchema }                        // something this component may emit
ActionDef  = { name: string; input: TSchema; output?: TSchema }       // something it can be called with
Manifest   = { id: ComponentId; version: string; emits: EventDef[]; consumes: ActionDef[] }

// deploy-time: stamped by the host that places the component
Instance   = { namespace: string; instance: string; manifest: Manifest }

// refs: structured, never strings
EventRef   = { instance: InstanceRef; event: string }
ActionRef  = { instance: InstanceRef; action: string }

Policy<T>  = { type: 'allow'; values: T[] } | { type: 'deny'; values: T[] } | { type: 'all' }
// the environment is a tree: containers are nodes, and nothing about nesting is special-cased
Environment  = { type: 'leaf'; instance: Instance } | { type: 'node'; instance: Instance; children: Environment[] }
Capabilities = { environment: Environment; events: Policy<EventRef>; actions: Policy<ActionRef> }

Invocation = { id: string; from: Instance; action: string; input: unknown; stack: Invocation[] }
Result<T>  = { type: 'success'; data: T } | { type: 'not-allowed'; reason: string } | { type: 'error'; error: SystemError }

interface Context {
  capabilities(): Capabilities;                                            // discovery + "may I?"
  emit(event: string, payload: unknown): Promise<Result>;                  // fire and forget
  call(target: InstanceRef, action: string, input: unknown): Promise<Result>; // direct invocation
}

interface Component {
  onAction(ctx: Context, inv: Invocation): Promise<Result>;  // the single inbound path
  mount?(el: HTMLElement): Promise<void>;                    // UI components only
  dispose(): Promise<void>;
}

interface ComponentFactory { manifest: Manifest; create(ctx: Context): Component }
```

Here `InstanceRef = { namespace, instance }`, which is `Instance` without the manifest.

### Semantics

- **Single inbound path.** Both `emit` deliveries and `call`s arrive at the receiver as `onAction`. A component never subscribes to anything.
- **Context assembly, layered from the inside out.** This is my call. `bus.register(factory, instanceRef, wrap?)` builds `wrap(Contexts.child(bus, instance))`. `child` is innermost and binds the sender identity, so every wrapper outside it is already per-instance and knows who is sending. A shared `PolicyContext` is built from a shared policy store, so one `setPolicy` affects every instance that uses it.
- **Invocation-scoped context.** This is my call. The `ctx` passed to `onAction(ctx, inv)` is scoped to `inv`. Anything emitted or called through it extends `inv.stack` rather than starting a new one. That is how identity survives hosts and bridges without adding methods to `Context`. The scoping mechanism stays internal to the SDK.
- **Event identity** is `stack[0].id`, the ID of the originating invocation. Each hop has its own `Invocation.id`. This is my call; it replaces "the id is kept unchanged".
- **`emit` is fire and forget.** This is my call. It resolves once the sender-side checks have run: validation, then the policy and filter wrappers on the sender's context. It returns `not-allowed` or `error` from those checks, and otherwise `success`. It does not wait for deliveries. Delivery failures (receiver errors, bridge timeouts) go to `trace` and are not returned to the sender. `call` does wait, and returns the target's `Result`.
- **Who receives an `emit`.** The bus holds **routes** of the form `{ from: EventRef, to: ActionRef }`. An emitted event is delivered as an `onAction` to each routed target, subject to policy. With no route, an emit goes nowhere and still returns success.
- **Addressing is fixed or dynamic, and the caller chooses.** A component may target a known instance, or search `capabilities().environment` by `ComponentId` or by action schema. Discovery is a reading of manifests, not a separate API.
- **Validation.** The payload of `emit` is checked against the emitter's `EventDef.schema`. A `call` input and a routed delivery are checked against the target's `ActionDef.input`. A failed check returns `{ type: 'error' }`, not an exception.
- **Stack and identity.** `Invocation.id` is created once, at the original emit or call, and is kept through every wrapper, bridge and nested host. Each hop appends to `stack`. The original sender is therefore always `stack[0].from`, and messages are never re-published as new ones.
- **Loop guard.** If the stack exceeds a configured depth, the result is an error.
- **Errors are isolated.** One receiver throwing does not stop delivery to the others.

### Liskov subtypes

Each `Contexts.*` constructor returns a `Context` subtype carrying extra operations for whoever owns it. Components only ever see `Context`.

| Constructor | Returns | Extra operations |
|---|---|---|
| `Contexts.bus(opts)` | `BusContext` | `register(factory, instanceRef)`, `unregister(instanceRef)`, `route(r)`, `unroute(r)` |
| `Contexts.child(parent, instance)` | `Context` | none; it stamps `from` and extends the stack |
| `Contexts.policy(ctx, caps)` | `PolicyContext` | `setPolicy(...)` |
| `Contexts.filter(ctx, pred)` | `FilterContext` | `addPredicate`, `removePredicate` |
| `Contexts.debounce(ctx, ms)` | `Context` | none |
| `Contexts.expose(ctx)` / `Contexts.elide(ctx, pred)` / `Contexts.mapEnv(ctx, fn)` | `Context` | none; they present a container's subtree as is, with parts hidden, or transformed |
| `Contexts.trace(ctx, sink)` | `Context` | none; it is the AOP/debug hook |
| `Contexts.iframeParent(bus, iframe, expected, instanceRef)` | `BridgeContext` | `dispose()` (registers and unregisters a proxy instance on `bus`) |
| `Contexts.iframeChild({ parentOrigin })` | `Promise<Context>` | none; it resolves after the handshake |

Wrappers shape outgoing traffic. If shaping incoming traffic turns out to be needed, add a mirror `Components.*` wrapper (for example `Components.debounce(component, ms)`). It is not needed for the PoC.

### Iframe bridge

Cross-origin `postMessage` handshake, checked by origin and source window,, then a dedicated `MessageChannel`. The parent checks the expected origin, the source window, the protocol version and the message shape. The child sends its manifest in the handshake, and the parent rejects it if the `ComponentId` doesn't match what it expected. Requests carry IDs and time out. On disconnect, the parent unregisters the proxy instance.

Inside the frame, `capabilities()` stays synchronous by caching the latest capabilities pushed from the parent. Messages carry only serialisable data. TypeBox schemas are plain JSON, so manifests cross the bridge unchanged.

### Hosts and nesting

A host is a `ComponentFactory` like any other. **My call:** to avoid a component-config mechanism, a host is built with a factory function rather than configured at runtime:

```ts
Host.define({
  id: { author: 'demo', id: 'pair-host' },
  children: [ /* { factory, instance } */ ],
  routes:   [ /* internal routes between children */ ],
  exposes:  [ /* child events re-emitted as the host's own emits; host actions forwarded to children */ ],
})  // → ComponentFactory with a static manifest
```

**Transparent by default, with no special cases (decided).** The environment is a tree, of the form `Leaf(instance) | Node(instance, children)`. A host's bus presents itself to its parent as a `Node` holding its children's subtree. Whether children are visible, hidden or remapped is decided only by which context wraps the host (`expose`, `elide`, `mapEnv`), not by host logic. A `call` to an instance anywhere in the visible tree passes through each container's context on the path, so each container's policy applies at its boundary. Calls go up to the common ancestor, then down to the target.

Inside, the host creates its own `BusContext` for its children. When an exposed child event fires, the host forwards it out through its own `ctx` with the original `Invocation.id`, and the stack extended. It is not re-emitted as a new event. Disposing a host disposes its children and its bus.

**My call:** Generic component config (passing parameters at placement time) is deferred. Parameterised components are made with factory functions like the one above.

## The demo (`make ui`)

The UI is minimal. Plain Lit elements in a vertical list are fine.

**Root app (origin A, for example `localhost:5173`)**
- `Contexts.bus()` at the root, wrapped in a `PolicyContext` whose switches the user can toggle.
- **Pair host (build-time):** a `Host.define` component compiled into the app. It contains **two fire-event components**, each with a text input and a button. Its manifest exposes both children's `fired` events.
- **Event table (iframe, origin B, for example `localhost:5174`):** consumes `log` (input `Type.Unknown()`). It lists every delivery it receives, showing the invocation ID, the event, the original sender (`stack[0].from`), the full stack path and the payload. It has a clear button.
- **Routes:** the pair host's exposed events go to `table.log`.
- **"Add host" button:** dynamically `import()`s a pair host module served from origin B, registers it, and routes its exposed events to the table.
- **Policy panel:** one on/off switch per host instance's exposed `fired` event (a `Policy<EventRef>` entry), which calls `PolicyContext.setPolicy`. While a switch is off, that host's clicks stop appearing in the table. This is my call. The policy is keyed by event, not by route, so the agreed types stay unchanged. Each host exposes one merged `fired` event. Showing `not-allowed` on a nested button is not required, because `emit` doesn't wait for delivery past the host boundary.
- **Status per panel:** delivery mode (build-time, runtime or iframe) and connection state. A load or handshake failure stays inside its own panel.

**What it proves:** a click in a build-time nested child, or in a runtime-loaded nested child, appears exactly once in a cross-origin iframe table, with a matching ID and the true original sender. Toggling a policy switch stops and restarts delivery. All three delivery modes use the same `Context` API.

## Repository layout

Bun + TypeScript workspace:

| Path | Contents |
|---|---|
| `packages/sdk` | Core types (TypeBox), `Contexts.*`, `Host.define`, iframe bridge. **No DOM or Lit dependency in the core**, so it can be unit tested with `bun test`. A thin Lit binding can sit in a subpath (for example `sdk/lit`). |
| `templates/component-template` | Cloneable starter: a fire-event example component, `index.html` (standalone, with a local `Contexts.bus()` and a console/log sink) and `embed.html` (uses `Contexts.iframeChild`). It builds a browser ESM bundle with no bare imports. |
| `apps/host` | The root demo app, the event-table component (served as an iframe page) and the runtime pair-host module (both served from origin B). |
| `Makefile` | `make ui`: install, build, and serve origins A and B. `make test`: `bun test` across the workspace. |

Dependencies are linked within the workspace. Nothing is published in the PoC.

## Testing

Unit test the SDK heavily with `bun test` (MessageChannel is available in Bun). At minimum cover:
- routing
- validation failures
- the policy allow, deny and toggle cases
- filter predicates being added and removed
- debounce timing
- trace observation
- the loop-guard depth
- receiver error isolation
- `unregister` stopping delivery, and re-registering not duplicating it
- `Invocation.id` and stack being kept through child contexts, nested hosts and the iframe bridge
- the bridge rejecting a bad origin, a wrong protocol version, malformed messages and a mismatched `ComponentId`
- request timeouts

The browser demo is checked by eye.

## Left to the builder

- The exact TypeBox definitions and metadata wording, provided every field is documented and justified.
- How the bus and the routes are implemented internally.
- The bridge's wire-message format.
- The Bun serving and bundling approach for the two origins.
- The visual layout.
- How `capabilities().events` and `actions` are derived from routes and policy.
- Whether capability changes are pushed to components. **My call:** not in the PoC. Components re-read `capabilities()` when they need to, or simply act on a `not-allowed` result.
