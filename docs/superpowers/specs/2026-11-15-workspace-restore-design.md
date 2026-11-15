# Restoring the workspace: shell, dock, import and sandboxed pods

*Agreed with the user on 2026-11-15. Items marked **(my call)** were mine; the user can overturn them. This step
comes before the key/value example (`2026-11-15-kv-store-example-design.md`).*

## Why

Commit 35f1675 moved `packages/ui-workspace` onto `@pritzlaff/nano-core` 0.4, but it **replaced** the host instead
of porting it. It lost the workspace shell (app bar, navigation drawer, pages), the golden-layout dock and its saved
layouts, import and open (URL and file, with a confirm prompt), saved workspaces, and sandboxed iframes. All of it
is in git at `35f1675^`. This step brings it back on the new model.

The workspace is the IDE over nano's data. You install a `nano.json`, drag pod views into a dock you arrange freely,
change pods and connections, and save the result as a `nano.json` to share. A pod's **isolation** (whether its code
runs in the host page or in an iframe) is the deployer's choice, kept as data on the pod.

## Model changes (user-decided)

1. **`Pod` gains `isolation?: 'host' | 'sandbox' | 'isolated-sandbox'`.** It is absent when `host`, the default.
   The deployer chooses it and can change it. It is saved in `nano.json`.
   - `sandbox`: an iframe with `allow-scripts allow-same-origin`.
   - `isolated-sandbox`: `allow-scripts` only, so the frame gets an opaque origin with no access to the host's
     storage or cookies.
   - Changing a pod's isolation through `apply` counts as a change: the instance closes and is rebuilt.
   - `Pod.lazy`/`Pod.eager` accept it in their options. `Pods.create` checks the value.
2. **`AppDeployment` gains `layout?`**, the dock layout. It is host-owned, like `providers` and `views`: nano checks
   that it is a plain JSON object and otherwise ignores it, and `app.deployment()` omits it. Layout is its own model,
   owned by the host.

Both need `design.md` updated and the spec `2026-11-14-pods-runtimes-application-design.md` amended.

### How an isolated pod is built (decision needed, see the end)

Nano doesn't open iframes. When a pod's isolation isn't `host`, the application asks the host for the
implementation to build in its place: a **stand-in** with the same coord, interfaces, dependencies and config
schema, whose handlers cross a `MessagePort` into the frame. Everything else (call edges, pipes, policy, timeouts,
the event stream, close) treats it like any other pod, so the frame boundary is policed and recorded like every
other message.

**Decided:** one new `Application.create` option, `isolate(name, pod) => Implementation`, synchronous (the
stand-in is built from the probed description; its `make` opens the frame, asynchronously). When it is absent, a
non-host pod fails to build with `invalid-input` ("no host for isolation sandbox"). This is a new public option,
so it is the user's call.

## The sandbox (ported from `35f1675^:packages/ui-workspace/src/sandbox/*`, then extended)

- **The frame:** a `srcdoc` page carrying the host's import map, with absolute URLs, and the boot module. Frames
  live in one fixed layer at the end of `<body>`. The host sends a `MessagePort`, and the frame imports the
  provider module **inside the frame**. The host page never imports a provider whose pods are all sandboxed.
- **Describing a provider without importing it:** to assemble, the host needs each implementation's coord,
  interfaces, ops (TypeBox schemas, which are JSON), dependencies and config schema. For a provider loaded only in
  frames, the host gets them by **probing** the module in a throwaway `isolated-sandbox` frame, which answers with
  the description as data. That is the old `probe`. Everything received is untrusted: shapes are checked, and the
  old regex guard against `pattern`/`format` schemas is kept.
- **Protocol (both ways):** `call`/`result` (the host calls a handler); `publish` (the frame's `ctx.publish`);
  `outcall`/`outresult` (the frame's `ctx.one(sel).call.op(x)`, made by the stand-in through the pod's real
  context, so it uses the pod's own call edges); `close` (the host closes the instance, and the frame runs its close
  listeners); `ready`/`failed`.
  - **Calling out is new.** The old sandbox couldn't, so a sandboxed pod with dependencies was refused.
  - `ctx.all` crosses the same way.
  - **The frame's `ctx.one`/`ctx.all` stay synchronous (my call):** the host pushes the pod's resolved call edges
    (target pod, runtime and the target's selector data) into the frame at build and after every `applied`, and the
    frame matches selectors against them with nano's own `matches`.
  - **A view in a frame reaches its pod through the host (my call):** the frame's view gets a proxy `app` whose
    `call` crosses the port (`view-call`/`view-result`) and goes through `app.call` in the host, so it is policed and
    recorded. Its `listen` hears stream events the host relays (`stream`), filtered to events naming that pod.
  - **`on` subscriptions don't cross (my call).** Nothing uses `on` today. A sandboxed pod that calls `on` gets a
    no-op and a `warning` on the stream.
- **Views of sandboxed pods** render **inside their frame**: `<nano-sandboxed>` is the view the host places, and it
  positions the pod's iframe over its dock panel (the old `sandboxed-el`). A host-mode pod's view renders in the
  page as today.
- **Failure:** a frame that doesn't send `ready` within 10s, fails to load, or sends malformed messages fails its
  pending calls (`threw`, with the reason) and its instance.

## The workspace (ported from `35f1675^`)

- **Shell:** `app-shell` with the navigation drawer, the app bar (`<nano-app-bar>`) and routes. The pages are
  **Workspace** (the dock), **Themes** and **Settings** *(my call: Systems and the puzzle editor were the old model's
  and stay gone; the Components gallery returns only if it ports without change)*.
- **App bar File menu:** New, Import… (URL or file), Open… (saved workspaces), Save (download `nano.json`), Save as
  workspace…
- **App bar View menu:** Tabs, Clear, Save layout, Restore, Reset.
- **Dock:** golden-layout 2.6.0 (`workspace-dock.ts`, `dock-layout.ts` with its tests). Its panels are:
  - **Explorer**, **Wiring** and **Stream** (nano-ui's elements)
  - one panel per **pod view**, opened by dragging or clicking a pod in the explorer or in the component drawer
  - closing a pod's view panel leaves the pod alone
- **The component drawer** lists the imported providers' implementations. Dragging one into the dock adds a pod
  (with a generated name, in runtime `main`, isolation `host`) and opens its view.
- **Editing a pod** (from its view panel's header menu):
  - implementation
  - view
  - isolation
  - config (as JSON)
  - adding or removing a **call edge** or a **pipe** from it
  - removing it

  Every edit is an `apply`. *(My call: the wiring stays read-only.)*
- **Layout:** the dock's arrangement is written to `nano.json`'s `layout` on Save. Opening a `nano.json` with a
  `layout` restores it. A layout that names pods that no longer exist drops their panels, with a message.
- **Saved workspaces:** named `nano.json`s kept in this browser (localStorage), listed in Open… and in the drawer.
- **Import:**
  - from a URL or a file (a file's provider URLs must be absolute)
  - a **confirm prompt** lists every provider module, its origin, and the isolation of each pod that will run its
    code
  - same-origin providers need no prompt
  - a cross-origin provider is allowed after confirmation, but a pod that runs it in `host` **or `sandbox`** mode is
    flagged in the prompt as running with the workspace's full access: a `srcdoc` frame with `allow-same-origin`
    has the host's origin, so only `isolated-sandbox` isolates **(my call)**
  - a cross-origin provider is only probed and run in frames until some pod needs it in `host`. Moving a pod to
    `host` or `sandbox` (from the edit menu) asks again through `ui.approve` before its code is imported into the
    page, and a drawer drop of a cross-origin implementation starts as `isolated-sandbox` **(my call)**
  - this replaces today's same-origin-only rule

## What stays

Today's `host.ts` (the app, registry, views, import, save), `host-ui.ts` (the `ui` pod: alert, approve,
setAppBar), nano-ui's explorer, wiring and views, and the themes are kept. The new shell is built on them.

## How it is proven

- **Unit:**
  - `dock-layout` (ported tests)
  - the protocol's message checks (malformed, oversized and regex schemas refused)
  - the `isolation` and `layout` checks in nano
  - stand-in calls over a `MessageChannel` in Bun, with no iframe: call, result, outcall through a call edge,
    publish, close, and a timeout
- **Playwright:**
  1. import the slice example by URL, drag two pod views into the dock, save, reload, and the layout returns
  2. set `up` to `isolated-sandbox`: it still transforms text, its view renders in a frame over its panel, and the
     stream shows its calls
  3. a sandboxed pod calls through its call edge into a host-mode pod and publishes an event that pipes onward
  4. importing a provider from a second origin shows the confirm prompt, and cancelling imports nothing
- All existing suites, `tsc` and the structure test stay green. The structure baseline may only shrink.

## Not in this step

The KV store example (next); the todo app; editable wiring; `on` across frames; Web Worker runtimes;
policies beyond `allow-all`.

## Decisions (user, 2026-11-15)

- **`Application.create` gains `isolate(name, pod) => Implementation`** (synchronous). A non-host pod with no
  `isolate` fails to build with `invalid-input`.
- **Import moves into `ui-workspace`.** nano-ui drops `importApp`, `merge` and `Loaded` from its exports.

## Left to the builder

File split within `ui-workspace` (keeping each file to 150 lines or fewer); exact menu labels and icons; how the
generated pod names look.
