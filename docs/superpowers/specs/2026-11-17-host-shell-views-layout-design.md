# Host shell, views, layout, packaging and home-origin pods — design (2026-11-17)

## Intent

The workspace is an IDE for nano apps: drop components on a page, wire them in Connections, save a `nano.json`, and
open that same file in a different host — plain HTML, React, Svelte — and have it work. The host itself is *just
another nano component*: what it offers participants (toasts, the app bar, the layout, deploying pods, passkeys) is
interfaces and actions, governed by the same policy as everything else.

Four sections, built in this order (each depends on the one before): 1 views and layout, 2 the host shell as nano
components, 3 packaging, import and open, 4 pods at their home origin.

**Goals.** One saved `nano.json` carries providers, pods, wiring, views and layout as data. Headless tests first (the
todo / chat case-study style), then the golden-layout implementation in `packages/ui-workspace`. Security in mind
throughout: nothing crosses a frame but schema-checked op messages; the user is in charge.

**Non-goals.** A second delivery mechanism; two views of one pod; a layout format every engine must speak; fitting the
design to the vault use case alone.

**Anti-goals.** Concept drift (CLAUDE.md): every new exported name, field or option below marked **(proposed)** is the
user's to approve during planning. Hand-rolled structure that restates Pod, Subscription, policy or coordinates.

## Existing concepts this builds on

Implementation, Interface, Op, Pod (incl. `isolation: host | sandbox | isolated-sandbox`), Runtime, Subscription (call
edge, pipe), `PolicyRules`, coordinates, the `AppEvent` stream. `AppDeployment.modules` (where a provider loads from),
`AppDeployment.views` (host-owned, pod → tag today), `AppDeployment.layout` (deployer's plain object). The host pod
`ui` (`workspace.host/ui`, providing nano-ui's `HostUI`: `alert`, `approve`, `setAppBar`). The nano-template module
convention: default export the provider, named export `views` (implementation coord → tag), importing defines the
tags. The import confirm for foreign-origin providers (`import.ts` `Foreign`).

## 1. Views and layout

- **At most one view per pod.** Two displays of the same data are two pods joined by an ordinary subscription (a
  query/selection pod over a store; a second store instance fed from the first by a pipe into an action such as
  `set`). This is component and deployment design, not a nano change.
- **The implementation names its view.** A provider module's `views` export (implementation coord → tag) is the
  default; `AppDeployment.views` (pod → tag) overrides one pod. This is today's mechanism, made the documented rule
  (and written into design.md). A view is a custom element given `target: { app, registry, runtime, pod }` (nano-ui
  `ViewTarget`) and reaches its pod only through calls and listening.
- **A pod with no view, or not in the layout, runs unseen** (a backend store).
- **Layout's key is the pod's instance coordinate** (runtime + pod). `layout` stays the deployer's plain object, owned
  by a layout engine, in any shape the engine likes, **(proposed)** with one convention:
  - `layout.slots`: the placed pods, each `{ runtime, pod }` with an engine-neutral `id`;
  - optional `layout.geometry` **(proposed)**: a neutral description of where slots sit — `rows`/`cols` (relative,
    nested splits with weights) or absolute boxes — written by an engine that can, so a nano `map` pod can transform it
    into another arrangement (flex, tabs, sub-pages);
  - `layout.<engine>`: the engine's own state (e.g. `layout.workspace` for golden-layout, as saved today).
  An engine that understands none of its siblings' state still has `slots` (and `geometry` if present).
- **Headless test:** `examples/todo/side-by-side.json` — two todo-list pods, a pipe from one to the other, a layout
  placing both. Test: it assembles, its `slots` name both pods, adding through one shows in the other, no browser.

## 2. The host shell as nano components

- The host provides interfaces, each an ordinary implementation (headless first, then the workspace's real one):
  - **Notifications** — `alert` (exists in `HostUI`; toast in the workspace).
  - **App bar** — `setAppBar` (exists; sets the title). Extending it to place a pod's view in the app bar is
    **(proposed)**: the bar's content is a pod reference, never markup.
  - **Layout** **(proposed interface)** — `slots()`, `geometry()`, and an event when either changes; the golden-layout
    implementation reads the dock (this replaces `main.ts` reaching into `<workspace-dock>`'s private golden-layout).
  - **Deployer** **(proposed interface)** — `deployPod`, `removePod`, updating a runtime. Each implementation decides
    (typically `approve` → the user), then applies. **Already-approved providers only** (user's decision): nano needs
    nothing new — `assemble` already refuses a pod whose implementation is not in the host's `Registry`, and only
    the host's import path (with its foreign-provider confirm) adds providers to it. Which deploys a host accepts is
    the Deployer *implementation's* choice — a prompt, or a data-driven rules implementation behind the same
    interface, as `PolicyRules` sits behind `Policy`.
  - **Passkeys** **(proposed interface)** — a `get`/`create` action with the PRF extension, on the host's origin; the
    browser prompt is the consent; policy rules limit callers.
- **Platform policy:** typically only the host may change runtimes and pods; everything else goes through the
  Deployer's actions. This already holds by construction: `apply` lives on the `Application`
  (`application/apply.ts`) and only the operator holds `app`. No new rule kind.
- **Headless test** (chat/todo style): a headless host provider (Notifications records alerts; Layout over plain data;
  Deployer approving by a flag). A pod calls `deployPod`; denied without a rule; approved → the pod appears and is
  callable; refused → nothing changes.

## 3. Packaging, import and open

- **Package** = the template's build: `dist/index.js` (provider default export + `views`) and `dist/nano.json`. This
  convention becomes documented as the package contract.
- **Import** places a file's runtimes/pods alongside the current app (clashes refused, as today). **Open** replaces the
  workspace with the file (File › Open; File › New = an empty deployment keeping the host's own pods).
- **Trust → isolation.** The user chooses at import/open; the choice is written into each imported pod's `isolation`,
  so it travels with the file. Opening a file may only **tighten** a pod's isolation without asking (`host` <
  `sandbox` < `isolated-sandbox`); loosening asks the user. The home-origin value (section 4) is not on that order:
  any change into or out of it asks. *(My call.)* Untrusted pods run sandboxed and, this round, headless (the generic
  pod view over their ops); views rendered inside the sandbox frame are later work. *(My call, per "sandboxed =
  headless".)*
- Files saved before `slots` existed (only `layout.workspace`) are read by the golden-layout engine, which derives
  `slots` from its own state on open. *(My call.)*
- XSS: views come only from loaded provider modules the user approved; nothing in a `nano.json` is rendered as markup.

## 4. Pods at their home origin

- A third place a pod can run: in a frame **at its provider's own origin** (e.g. `vault.example`), so it owns its
  IndexedDB, login and sync. Proposed as a new `isolation` value **(proposed name)**; no new URL field.
- **The frame page** (user's decision): nano provides one standard page **(proposed)** that a site hosts at its
  origin; it boots a runtime, loads the module `AppDeployment.modules` names for the pod's provider, and speaks the op
  protocol. The module URL stays the only address; the template build does not change.
  Differs from `sandbox`/`isolated-sandbox`, which are opaque-origin frames.
- **Consent both ways:** the host's user approves the foreign origin (the existing foreign-provider confirm); the served
  side may restrict which host origins it serves **(proposed: an origin allow-list on the serving side; empty = any
  host)** — built only if it is a few lines, else out of scope for now.
- **Only op messages cross,** schema-checked; host policy rules limit which pods may call the foreign pod (gateway
  pattern, as in `examples/chat`).
- **WebAuthn:** a passkey is bound to its origin's domain; a home-origin frame needs `allow="publickey-credentials-get;
  publickey-credentials-create"` and the user's click inside the frame, so such a pod shows a minimal view (e.g. an
  Unlock button). Opaque sandboxes cannot use WebAuthn.
- **The PRF secret stays inside the component that asked for it,** used there to authenticate/decrypt; components
  expose operations (`unlock`, `sign`, a store), not the secret. (A component can still leak it; the design never
  requires it.)
- **Vault flow** (the worked example, not the fit target): import an app with an Auth pod at `vault.example` → user
  unlocks with a passkey → the vault calls the host's `deployPod` offering a KeyValueStore at its origin → the host
  approves (user prompt) and places it gateway-style in chosen runtimes → the user wires it in Connections → Save.
  Authentication state (a passkey unlock, a bearer cookie that later expires) is the component's own concern, at its
  origin, not nano's. What nano and the host contribute is policy: application `Policy` and the host's Deployer
  decide who may reach or deploy such a pod, so imported code cannot just import an authenticated site and scrape it.

**Out of scope, noted (a separate design):** loading a saved deployment does not mean every pod in it can be
instantiated. In the auth flow, an action in one component (authenticate) creates a pod in its runtime, and a later
host request deploys it into other runtimes; a reopened file may name pods whose preconditions (auth, approval) do
not hold yet. How a deployment records and replays such flows is not specified here.

## Left to the builder / planning

Exact interface coordinates and op schemas; whether `slots` carry titles; `geometry`'s precise schema; how Open
confirms discarding unsaved work; the WebAuthn test strategy (virtual authenticator in Playwright).
