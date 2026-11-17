# Nano: one stack, and a suite of use cases that prove it

*Decided with the user on 2026-11-15. Items marked **(my call)** are mine, listed in "Calls I made".*

## Why

Nano's goals are:

1. small, self-contained bundles behind simple interfaces;
2. any component can be swapped by writing to its interface;
3. the benefits of event-driven systems: observability, encapsulation, single responsibilities, isolation, and
   new behaviour from existing parts;
4. cross-cutting concerns (identity, signing and keys, storage, messaging, settings, notifications) isolated, so
   their components are reused and truly decoupled;
5. higher levels of abstraction built on lower layers, with those configurations and deployments easy to share;
6. the user stays at the centre and in control.

We prove them with applications people recognise, built so that each piece can be seen, taken apart, wrapped and
replaced:

- **Familiar apps with good UX** that come apart into components: an email inbox, with its contact list, message list
  and message view, each replaceable.
- **New components plug in trivially** to a wider ecosystem.
- **Clear sandboxing, separation and observability:** a policy pod between a domain action and its database, or a
  wrapper round messaging that adds rate limiting or validation.

The realistic path for a user is **breaking down a monolith**. Storage and messaging come out first, then API settings,
then the business or validation rules inside some big `doIt`. At each step the user can:

1. see which actions the monolith plugs into;
2. observe the traffic, messages and results that cross that boundary;
3. eventually wrap or replace the module.

## The split brain, and the decision

The repo has two stacks:

- **`@pritzlaff/nano-core`** (`packages/core`, with `runes`, `elements`, `app`, `bundle`, `platform`, `wires`, `circuit`,
  `editor`, `shell`, `people`) is the model that every UI package and `ui-workspace` run on.
- **`@pritzlaff/nano`** (`packages/nano`) is the model re-cut on 2026-11-13 (`2026-11-13-runtime-model-design.md`) as a
  deliberate clean break, because nano-core's model was tangled. It has been refined since then: pods, effect-pods,
  values and application, and pods, runtimes and application. It has no UI consumer, only `examples/`.

The runtime-model spec scoped "the host UI (`ui-workspace`) on the new model" (its goal 8) and deferred the other UI
packages until the model was right. The model work never came back to goal 8, so we have two implementations.

**Decision:** unify by replacing. `@pritzlaff/nano` is the one model. `ui-workspace`, and the UI pieces worth keeping, move
onto it. `nano-core` retires.

| Today | What happens |
|---|---|
| `core` (nano-core) | retires once nothing depends on it |
| `editor` (puzzle editor) | retires |
| themes (`--nano-*` tokens) and the shadcn-like kit (`elements/src/kit`) | reused |
| `elements` (`ModelElement`, `PlacedElement`) | checked, then ported or rebuilt so an element binds to a pod |
| `runes` (a component as plain state and functions) | checked; it may become a friendlier way to write an `implementation` |
| `bundle` (input, range, log, debounce, map, filter) with their web components | rebuilt as the built-in pods, each with a visual face |
| `circuit` (the 3D "show the wiring" view) | rebuilt on the new model; the user loves it |
| `platform` (systems tree, inventory table) | rebuilt as the explorer |
| `wires`, `shell`, `app`, `people` | rebuilt or retired as the slices need them (my call, decided per slice) |

## What we're building

### The host

`ui-workspace` keeps its look: clean and empty at first, themed, with a dock of panels. It lists the **built-in
components** (input, debounce, map, log, and the theme and component pieces), which you can drop in and wire by hand,
for example input → debounce → map → log. You can open or import an example `nano.json`, and it arrives as a working
application.

It needs:

- **An explorer:** the application, its runtimes, the pods in each, and their implementations, subscriptions and
  live state.
- **The wiring view:** the 3D view, with web components as boards on layers and wires between them.
- **Pod views.** A view is an association of one or more web components with an underlying pod (the user's
  definition). A view is not a pod.
  - **A default view.** A pod usually has a clear "most specific" or default view, found by a selector such as its
    implementation (the contacts list for `acme/contacts`).
  - **Generic views.** A "View Pod" web component works for any pod. It shows the pod's coordinates (name,
    implementation, runtimes), its operations, and live metrics of the data running through it, taken from the
    stream.
  - **Chosen in the deployment.** The deployment holds a selector naming the web component that shows a pod. Changing
    the selector shows a different view or replaces it, and the change is saved with the rest.
  - **Drill-down.** From a high-level pod (a contacts CRUD API) you can open the pods it is built on (its validation
    and storage), following its call edges, each shown with its own view.
  - The exact shape (the selector, how a web component is named, and how the default is resolved when nothing is
    selected) is the first step of the foundation, proposed to the user before anything is built on it.

A visual web component is how you **see** a functional piece: values moving through debounce and map, and steps
firing.

**Composable micro-frontends, decoupled from the host.** The host knows nothing about any application at build
time. Built-in components, example applications and the host ship separately, and an application arrives only by
being imported: its `nano.json` plus the code of its providers, loaded as ES modules when it is imported. The
isolation comes from pods, runtimes and the application, not from bundling.

**The host is a pod too.** The host's own abilities, such as "show alert", "approve action" and "set app bar", are
an interface provided by a host pod. It is placed in the runtimes that may use them, so a call edge to it is the
capability. An application asks for an approval through its edge, and each host provides the same interface in its
own style. A policy pod (use case 7) can ask the host to approve an action. The interface's ops are proposed to the
user with the thin slice. (My call: the pod isn't named `host`, because `host` is already the sender of
`app.call`'s messages.)

**Swappable hosts (later).** The same applications run in other hosts, which may use a different style or a different
UI framework. Those hosts reuse the runtimes and applications already built. They change only the view selectors,
for a different look and feel, or they theme the same web components. Nothing in a component or an application may
depend on a particular host.

### Two low-level abstractions everything stands on

- **Storage:** a key-value store (`get`, `put`, `update`, `delete`), and a SQL-like store (`insert`, `update`,
  `delete`, `select`) alongside it.
- **Messaging:** `send(to, msg)`, `poll(me)`, `markRead(msgId)`.

Library-like code stays ordinary code inside implementations. Pods sit at the boundaries worth seeing and swapping.

### The use cases

1. **The thin slice (first).** input → debounce → map → log in the new host, visible in the explorer and the
   wiring view, with one piece swapped live. This proves the host, the built-ins, pod views and live `apply` on the
   new model before anything bigger.
2. **Email.** One cohesive app made of two sub-domains, contacts and messages, each with its own CRUD-like interface
   and its own views:
   - **Contacts:** a list widget; choosing one emits `contact selected`.
   - **Messages:** a pipe from `contact selected`; it loads and shows that contact's history, and choosing one emits
     `message selected`.
   - **Message:** a pipe from `message selected`; it loads and shows the message.
   - Each view loads from a domain API pod. The API is built from transforms (ETL-style mapping) and validation over
     the low-level store, and messages also use low-level messaging. Everything is in memory first, then on browser
     storage (IndexedDB).
3. **A portable backend.** A second store takes over from the first. For this round it is browser-local, behind a
   bridge pod that maps its native interface onto the key-value interface (my call: a differently-shaped IndexedDB
   or localStorage store standing in for "the user's other backend"). The user places that backend's pod in their
   application and repoints the store edge, and email keeps working. In principle the same holds for Postgres,
   NoSQL, REST or Firestore: the user authenticates with that backend's runtime, places its pod, and repoints the
   edge.
4. **Migration by ETL.** The ETL example moves the existing data from the old store into the new one. It is reused,
   not a special feature.
5. **AI with settings.** An AI runtime holds **Jev Settings** (the API-key form, keeping the key in its own store)
   and **chat** (`string => string`, with a call edge to Jev Settings). Chat is placed in the runtimes of apps that
   want it, where its input can be piped from another component's string output. Jev Settings is placed only in the
   AI runtime and the Settings runtime, so app code has no edge to the key. The end-to-end tests use a fake chat
   behind the same interface; a real AI call from the browser is optional.
6. **One settings experience.** A **Settings** runtime has a text filter, vertical tabs listing every settings pod
   placed into it, and a details area showing the chosen pod's settings component. Settings from unrelated imported
   apps (email, ETL, AI) appear together, and none of those apps knows about the others. My guess is that a settings
   pod is any pod that provides a `Settings` interface, found with `ctx.all(Settings)`.
7. **A policy in the path.** A policy or validation pod is inserted between a domain action and its store, or
   wrapped round messaging (rate limiting or validation), while the app runs. It is a pod: the edge is repointed
   through it with `apply`, so it is saved with the deployment (a runtime `Policy` is not, D80).
8. **Archetypes.** 3-tier (form → bff → api → storage, as `people` does today), ETL, and chat/messaging, each
   importable alongside the others.
9. **Monolith extraction.** An app with one big `doIt` has its business or validation rules pulled behind an
   interface. The user sees its actions, watches its traffic, then wraps or replaces it. The identity use case
   (Vault/Signer/Identity out of a monolith) is the first real instance.

### Tests

Every use case has end-to-end tests: headless tests that drive the application through `app.call` and the stream,
and browser tests that drive the host and its web components. The visual components are importable into
`ui-workspace` so each case can also be proven by hand.

## Order

Two projects, done in this order:

1. **The foundation:** pod views and their mapping; elements and runes checked and ported or rebuilt; the built-ins;
   `ui-workspace` on `@pritzlaff/nano` with the explorer and the wiring view; nano-core and the puzzle editor retired.
   It is proven by use case 1.
2. **The suite:** use cases 2 to 9, roughly in that order. Each is a plan of its own, and each one that can't be
   built cleanly is a model gap to fix before going on.

## Goals, non-goals, anti-goals

- **Goals:** one stack; use cases 1 to 9 working in the host, each with end-to-end tests; every layer of every use
  case visible in the explorer and the wiring view, and swappable live.
- **Non-goals for this round:** server-side backends (all storage and messaging is browser-local); a marketplace;
  porting the puzzle editor; every library call as a pod.
- **Anti-goals:** a second model, or a compatibility layer that keeps nano-core alive; new concepts bolted on without
  the user's say (CLAUDE.md's no-drift rule holds); demos whose components only work inside one app.

## Constraints

- CLAUDE.md applies: no concept drift, small files and types, and every export in `design.md`.
- Lit web components and the `--nano-*` theme contract; Bun for building and testing.
- The thin slice comes first, before any larger demo.

## Where things live

New pieces go in their own packages over `@pritzlaff/nano`, never inside it: storage, messaging and REST clients
are application-layer components, not part of nano (the user's rule). `packages/nano` gains an export only with the
user's say. Three things stay separate, and none imports another's internals:

- **A bundle of default components:** the built-in pods (input, debounce, map, log and so on), their views and the
  generic "View Pod", built as an importable ES module.
- **Examples:** full applications (email, AI with settings, ETL and so on), each a `nano.json` with its providers'
  code built as ES modules. They depend on nano and on shared interfaces, never on the host.
- **The host (`ui-workspace`):** it loads the default bundle and imports examples the way a user would. An example
  that works only when compiled into the host fails the decoupling goal.

## Decided with the user (2026-11-15)

- **No runtime handle on the application.** `app.runtime(id)` doesn't come back. Calls stay `app.call(runtime, pod)`;
  lifecycle (`restart`, `apply`, `close`) stays on the application, because a pod placed in two runtimes is one
  instance (D60). A runtime view is added only if a concrete use case shows it is needed.
- **A view is web components associated with a pod**, chosen by a selector in the deployment, with a default per
  pod and generic fallbacks ("Pod views" above).
- **Decoupled, not bundled.** The default components, the examples and the host are separate, and applications come
  in by import ("Where things live"). Showing the same applications in several hosts comes later.

## Left to the builder

- Which old UI packages are ported and which are rebuilt, once each has been checked.
- The concrete shape of the pod-view mapping, as a proposal for the user (it is theirs to decide).
- The browser test tooling.
- The exact shapes of the messaging interface (what `me` is in `poll(me)`) and of the SQL-like `select` query. Each
  is fixed in the plan of the first use case that needs it, and shown to the user there.

## Calls I made

- `wires`, `shell`, `app` and `people` are decided per slice, not up front.
- For this round, the portable-backend case uses a second browser-local store behind a bridge pod.
- Settings pods are found by a `Settings` interface (a guess, to be decided when use case 6 is designed).
- The view selectors live in `nano.json` as an optional `views` map on `AppDeployment`, beside `tags`, which nano
  carries and saves but doesn't interpret. This changes nano's data type, so it needs the user's agreement in the
  foundation plan. The alternative is a host-side file next to `nano.json`.
- A view talks to its pod the way the host does: through `app.call` and the stream. UI state that other pods react
  to, such as "contact selected", is an action or event of a pod, so it can be piped.
- During the transition, `ui-workspace` moves onto `@pritzlaff/nano` with only the thin slice, the explorer and the
  wiring view. The rest drops out of the host until a slice rebuilds it. `nano-core` is deleted once nothing imports
  it, and nothing bridges the two stacks.
- Importing an app whose pod or runtime names clash with what's loaded is refused, with a message naming the clash.
  Namespacing is decided when use case 6 needs it.
- For this round, an imported application's providers are ES modules loaded with `import()` from URLs on the
  host's own origin. Cross-origin loading, iframe sandboxing and CORS come later. How a `nano.json` names its
  modules (a field on `AppDeployment`, or a small import manifest next to it) is proposed to the user in the
  foundation plan, alongside the `views` shape.
- Use case 7's policy is a pod placed in the path, not a runtime `Policy`, so it is saved and can be inserted live.
- Tests use a fake chat; a real AI call is optional.
