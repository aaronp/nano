# Sandboxed components: trusted or sandboxed imports, and a deploy mode per instance

## Why

Most components will be imported from packages the host didn't write, and some of that code won't be trusted. The
platform shouldn't decide how much to trust it: the person running the host does, per package and per instance.

Two decisions, made at two moments:

- **Trust, when a package is imported.** Importing today runs the package's module in the host page
  (`ui-workspace/src/imports.ts:35-40`: `import()`, read `catalog`, call `define()`). Untrusted code has then already
  run with full access, so no later choice can protect the host. Trust must be chosen before the module loads.
- **Deploy mode, when an instance is created.** `host`, `sandbox` or `isolated-sandbox`, within what the package's
  trust allows.

Write as little as possible: a sandboxed instance is just another `Component` (same id, same ops) whose `make()` starts
an iframe and whose actions forward to it. Nothing that creates or wires instances changes.

## Goals

1. **Trust per import**: the import dialog chooses *trusted* (as today) or *sandboxed*. A sandboxed import never loads
   the package's module in the host page.
2. **Three deploy modes**:

   | Mode | Runs | Can reach |
   |---|---|---|
   | `host` | in the page, as today | everything |
   | `sandbox` | in an iframe, `sandbox="allow-scripts allow-same-origin"` | its own DOM/CSS; shares the host's origin (storage, cookies, the parent page). Isolates layout and failures, not untrusted code |
   | `isolated-sandbox` | in an iframe, `sandbox="allow-scripts"` (an opaque origin) | only its messages to the host |

   Trusted packages: any mode. Sandboxed packages: `isolated-sandbox` only. Built-in components (bundle, editor):
   `host` only (they have no package URL to load in an iframe).
3. **DeployStrategy**, application-level (ui-workspace): `(entry, mode) → Component`. `host` returns the component
   unchanged; the iframe modes return `sandboxed(...)`. Every place *the app* creates an instance goes through it. The
   core and the platform keep their plain ways to create instances.
4. **The mode is chosen in the UI** where instances are created: the platform's Add form and the dock's add-panel flow.
   Default: `host` for trusted and built-in kinds, `isolated-sandbox` for sandboxed ones (the only choice).
5. A sandboxed instance looks like any other to its neighbours, the inventory, the tree and the wires view.
6. **Guards, separate from sandboxing**: allow / deny selectors over the coordinates an instance may call, applied by
   a wrapper, so they work for any instance, in an iframe or not. Sandboxed deploys use one by convention.

## Non-goals

- Saved or tag-based deploy policies, and Blueprint boot. The DeployStrategy is the seam they will use.
- A package author requiring a minimum mode.
- Sandboxing built-in components; Web Workers for headless ones.
- Resource limits: an isolated iframe can still use CPU, memory, the network (`fetch`), and navigate itself.
- Moving a live instance between modes.

## Anti-goals

- Host code running a sandboxed package's module, ever (import probe included: it runs in an isolated iframe).
- Trusting what comes back from an iframe: every message is data, checked before use.

## Design

### Where it lives

`packages/ui-workspace/src/sandbox/` (application-level, as decided): the DeployStrategy, `sandboxed()`, the bootstrap
page, the port protocol, and the stand-in element. The platform gains one optional seam (below); the core is unchanged.

### `sandboxed(source, mode): Component`

`source = { url: string /* the package's module, absolute */, kind: string, entry: SerialEntry }`, where
`SerialEntry` is the catalog entry as data: `{ id: {ns,name}, title, tag?, description?, ops: Op[] }` (ops with their
TypeBox schemas, which are JSON).

The returned Component has `entry.id`, `entry.description`, and one action per op:
- `make(env)` creates the iframe (see Bootstrap), opens a `MessageChannel`, and returns a handle
  `{ frame: HTMLIFrameElement, ready: Promise<void>, … }`.
- An op with a run (it has an input) sends `call {id, op, arg}` and resolves with the `result {id, result}` that comes
  back; calls made before `ready` wait for it.
- An op that only publishes (output, no input) is a source. When the iframe sends `publish {op, data}`, the stand-in
  publishes it through `env.notify`.
- **Checks**: a result's value and a publish's data must pass `Value.Check` against the op's output; a message naming
  an op the entry doesn't offer, or of an unknown type, is dropped (and logged). The runtime already checks inputs.
- A part's outward call (the component calling another instance through its env, inside the iframe) arrives as
  `outcall {id, target, op, arg}`; the stand-in makes it through its own env handle and replies `outresult`. The
  stand-in itself doesn't filter: what an instance may call is a guard's job (below), and sandboxed deploys are
  guarded.

When the instance is removed from its last registry, the iframe is removed. (Builder's call how: e.g. the env's
`removed` with no handles left.)

### Bootstrap (the iframe)

A `srcdoc` page, the same for both modes, differing only in the `sandbox` attribute:
- an import map: the host's own (`ui-workspace/public/index.html`), with every URL made absolute, so the package's
  shared imports (`lit`, `@pritzlaff/nano-core`, …) resolve to the host's copies;
- a module script that waits for one `message` from `window.parent` carrying a `MessagePort` and
  `{ url, kind, render: boolean }`, then: imports `url`; calls `define()` (in the iframe, defining its elements there);
  creates a registry and runtime; instantiates `catalog[kind].component`; and answers on the port:
  - `call` → runs it through its runtime, replies `result`;
  - its instance's publishes (runtime traces) → `publish`;
  - calls from the instance to anything else → `outcall`, awaiting `outresult`;
  - `render: true` and the entry has a `tag` → it places `<tag name="…">` in its body, provided its registry.
- Isolated (opaque origin): fetches of the package module and shared modules are cross-origin, so the host must
  serve them with CORS (GitHub Pages does; the Vite dev server does). The host posts with target origin `*` and the
  iframe accepts only `event.source === window.parent`.

### Importing a sandboxed package

- The import dialog gets the trust choice (default: *sandboxed*). The remembered import records it
  (`importsStore`), so boot re-imports it the same way. Records without it (imported before this) are *trusted*.
- **Probe**: the host creates an isolated bootstrap iframe in *probe* mode: it imports the module, and answers with the
  catalog as data — `{ kind → SerialEntry }`. No `define()` in the host, no module in the host.
- The probe's answer is checked: the same manifest-vs-catalog check as today (`catalogMismatch`, adapted to
  `SerialEntry`), kind/tag/id shapes, and each op has `ns`, `name` and object schemas. Then the probe iframe goes.
- The host adds the kinds to its catalog as sandboxed entries (a component that is `sandboxed(source,
  'isolated-sandbox')`, allowed modes `['isolated-sandbox']`). No element is defined in the host for the package's
  tags. Dock palettes, the platform's Add, and the inventory see ordinary kinds.

### Trusted packages deployed sandboxed

The host already has the module (trusted import) and its real catalog. The DeployStrategy builds the `SerialEntry`
from the real entry and `sandboxed(...)` from the package URL the app recorded in `addCatalog(entries, { name, url })`.

### Guards: what an instance may call (core, `wrap.ts`)

- `wrap(outer, id, strategy, { …, outward?: Selectors })`. `Selectors = { allow?: string[]; deny?: string[] }`.
  The wrapper's inner-runtime Policy already decides which of a part's calls go on to the outer runtime; with
  `outward` set, a call goes on only if its coordinate matches `allow` (when given) and no `deny`. A refused call
  resolves with an error naming the coordinate; it is traced on the inner runtime like any call.
- A coordinate is `registry/instance/opKey`, e.g. `host/log/composable.bundle/log/info`. A selector is the same with
  `*` matching any run of characters (`host/log/*`, `*/platform/*`). Deny wins over allow.
- A `guard(outer, id, outward)` helper = `wrap(outer, id, Strategies.forward, { outward })`.
- Inbound filtering (who may call or connect to the instance) is not in v1: the runtime doesn't pass the caller to a
  run, so it needs its own design.

### Sandboxed deploys are guarded

- After instantiating and adding an iframe-mode instance, the app guards it with the selectors chosen at deploy time
  (the Add form and the dock's add flow get an "May call" field: one selector per line). Default: none, so an
  isolated instance can only answer calls and publish.
- `host` deploys are not guarded unless selectors are given (the same field, optional).
- The selectors are saved with the panel, like the mode.

### Showing a sandboxed instance: one generic element, iframes that never move

- **One host element, `<c-sandboxed name="…">`**, shows the sandboxed instance at `name` in the provided registry, for
  every sandboxed instance (trusted packages deployed in an iframe mode and sandboxed imports alike). The dock places
  it instead of the package's tag when a panel's mode isn't `host`.
- **An iframe is never moved in the DOM** (moving one reloads it, losing the instance it runs). All sandbox iframes
  live in one fixed-position layer at the end of `<body>`. `<c-sandboxed>` is a placeholder: while connected and
  visible, its instance's iframe is positioned over the placeholder's box (kept in step by `ResizeObserver` and
  scroll/resize listeners); otherwise the iframe is hidden (`display:none` keeps it running). Headless instances'
  iframes are simply never shown.
- **One visible view per instance**: the iframe is one view. A second `<c-sandboxed>` for the same instance shows a
  note ("shown elsewhere") instead. The UI inside the iframe talks to the iframe's own instance — the same instance
  host calls reach, so state is shared.

### DeployStrategy and the create paths

- Each catalog entry the app holds carries its allowed modes: built-in `['host']`; trusted imports all three;
  sandboxed imports `['isolated-sandbox']`. `KindSchema` (platform `kinds` op) gains `modes?: string[]` (described),
  filled from the entry, so the Add form offers only those, defaulting to the first.
- `type Mode = 'host' | 'sandbox' | 'isolated-sandbox'`;
  `type DeployStrategy = (kind: string, mode: Mode) => Component` — the app's one way to get the Component to
  instantiate for a kind. Refuses (throws) a mode the kind doesn't allow.
- **Platform seam**: `platform(host, catalog, opts?: { deploy?: (kind: string, mode?: string) => Component })`, and
  `createComponent` takes an optional `mode` (typed, described). With no `deploy`, it instantiates the catalog's
  component as today. The app passes its DeployStrategy.
- **Dock / placed widgets**: a placed widget's element is the app's to create; the app instantiates
  `deploy(kind, mode)` for it and adds it before placing the element (`PlacedElement` finds an existing instance by
  `name` and doesn't create its own). For a sandboxed instance, the element shown is the stand-in element, which
  shows the iframe. (Builder's call how the dock's add flow carries the mode.)
- **The mode is saved with the panel**: the dock's panel state becomes `{ widget, mode? }` (no `mode` = `host`), so a
  restored layout deploys the same way. Boot already awaits remembered imports (probes included) before restoring
  saved workspaces.

### Failures

- `ready` rejects if the iframe hasn't answered within 10 s (a constant), or reports a load error (bad module, CORS).
- A call made after a failure, or in flight when the iframe fails, resolves with an error naming the instance; there
  is no per-call timeout in v1.
- A failed instance stays in its registry (so its wiring is visible), and `<c-sandboxed>` shows the error.

### Messages and ops

- Messages are sent with `postMessage` (structured clone). Ops travel as data: TypeBox 1.x schemas are plain objects
  (their `~kind` is a string key), so `Ops.key`, `Ops.fits` and `Value.Check` work on received ones.
- `publish` carries what the instance publishes itself (`env.notify`, including an action's `emits`); a `call`'s
  result is only its `result`.
- Trust is per manifest URL. Changing it = remove the import and import again.

## Testing

- `sandboxed()` against a fake port: calls round-trip; publishes reach subscribers; a result or publish failing its
  schema is refused; unknown ops/messages are dropped; outcalls go out and come back; calls before ready wait.
- Bootstrap logic, as a function over a port (no iframe): runs calls, posts publishes and outcalls, answers a probe
  with the catalog as data.
- DeployStrategy: `host` returns the component; iframe modes return a component with the same id and op keys; a
  sandboxed kind refuses `host`/`sandbox`; a built-in refuses the iframe modes.
- Import: a sandboxed import never calls `importModule` in the host (stub deps), records its trust, and adds kinds
  whose components are sandboxed; boot re-imports with the recorded trust.
- Platform: `createComponent` with `mode` goes through `deploy`; without `deploy`, unchanged.
- Guards: allow-only, deny-only, deny beating allow, `*` patterns, `registry` targets, a refused call traced, and a
  guarded sandboxed stand-in whose outcall is refused.
- Iframes themselves (srcdoc, sandbox attribute, CORS) are checked in a real browser; happy-dom can't run them.

## Calls I made (check these)

- Code lives in ui-workspace (`src/sandbox/`), since it's the app's concern; the platform gets an optional `deploy`.
- New imports default to *sandboxed*; existing remembered imports stay *trusted*.
- `sandbox` mode (same origin) is offered only for trusted packages: for untrusted code it gives no protection.
- Results and publishes from an iframe are schema-checked by the stand-in; inputs are already checked by the runtime.
- One bootstrap page for probe and deploy; the import map is the host's, with absolute URLs.
- One generic `<c-sandboxed>` element instead of per-tag stand-ins; iframes live in a fixed layer and are positioned
  over it, never moved (so docking doesn't reload them).
- The deploy mode is saved in the dock's panel state.
- 10 s to become ready; no per-call timeout.
- Guards are an `outward` option on `wrap` (plus a `guard()` helper), not a new mechanism; outward calls only in v1.
- A sandboxed deploy with no selectors given may call nothing.
