# Workspace restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring back the workspace that commit 35f1675 deleted (shell, golden-layout dock, import/open/save,
sandboxed iframes) on `@pritzlaff/nano-core` 0.4, with a pod's isolation as data on the pod.

**Architecture:** nano gains two data fields (`Pod.isolation`, `AppDeployment.layout`) and one option
(`Application.create(…, { isolate })`). Nano never opens frames: for a non-host pod it asks `isolate` for a stand-in
implementation, which the workspace builds over a `MessagePort` into an iframe. Everything else is `ui-workspace`,
ported from `35f1675^` (read old files with `git show 35f1675^:packages/ui-workspace/<path>`) onto today's
`host.ts`, `host-ui.ts` and nano-ui's explorer, wiring and views.

**Tech Stack:** Bun, TypeScript, TypeBox 1.x, Lit 3, golden-layout 2.6.0, happy-dom (unit), Playwright (Chrome).

**Spec:** `docs/superpowers/specs/2026-11-15-workspace-restore-design.md`

## Global Constraints

- No new export, public method or option beyond the three the spec decides: `Pod.isolation`, `AppDeployment.layout`,
  `Application.create`'s `isolate`. nano-ui **loses** `importApp`, `merge` and `Loaded`. Anything else new in a
  published package (nano-core, nano-elements, nano-ui) is a question for the user, not a ruling.
- `packages/nano`: source files ≤150 lines, exported types ≤10 members, every export named in `design.md`
  (`packages/nano/test/structure.test.ts`; the baseline may only shrink).
- `packages/ui-workspace` source files ≤150 lines (spec).
- `isolation` values: `'host' | 'sandbox' | 'isolated-sandbox'`; absent means `host`.
- iframe `sandbox` attribute: `sandbox` → `allow-scripts allow-same-origin`; `isolated-sandbox` → `allow-scripts`.
- Frame ready timeout: `READY_MS = 10_000`.
- golden-layout `2.6.0` exactly.
- A non-host pod with no `isolate`: build fails `invalid-input`, reason `no host for isolation <mode>`.
- Tests: `cd packages/nano && bun test --isolate`; `cd packages/ui && bun test --isolate`;
  `cd packages/ui-workspace && bun test --isolate && bun run build`; `cd examples && bun test --isolate`;
  `bunx tsc --noEmit` at the root; `bunx playwright test` (Chrome; needs the sandbox disabled). Never a bare root `bun test`.
- Never stage `kerits/`, `designs/`, `spikes/`. No npm publish/login. Commits end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A frame sending garbage** (wrong shape, unknown call id, an op it doesn't have, oversized data, schemas with
   `pattern`/`format`): dropped with a `warning`, never a host exception. Pinned in Task 3.
2. **A frame that never answers or dies mid-call:** pending calls resolve to a failure, never hang. A later restart
   builds a fresh frame. Pinned in Task 3.
3. **An imported `layout` naming missing pods, or not golden-layout-shaped:** the dock opens, the missing pods'
   panels are dropped with a toast, and an unreadable layout falls back to the default. Pinned in Task 8.
4. **Changing a pod's isolation or removing it while its frame is open:** the old frame is closed and its iframe
   removed, with no leaked iframes. Pinned in Task 4 (unit, frame count) and Task 11 (e2e).
5. **A cross-origin provider moved to `host` and the approve declined:** the build fails, and the module is never
   imported into the page. Pinned in Task 6.

---

### Task 1: `Pod.isolation` and `AppDeployment.layout` (nano)

**Files:**
- Modify: `packages/nano/src/pod.ts`, `packages/nano/src/pods.ts` (Shape), `packages/nano/src/deployment.ts` (type + Shape)
- Modify: `design.md` (Pod and AppDeployment rows), `docs/superpowers/specs/2026-11-14-pods-runtimes-application-design.md` (Data block: both fields, one line each saying host-owned / deployer's choice)
- Test: `packages/nano/test/isolation-layout.test.ts`

**Interfaces:**
- Produces: `Pod = { implementation: string; config?: unknown; eager: boolean; isolation?: 'host' | 'sandbox' | 'isolated-sandbox' }` (no new exported type; use `Pod['isolation']`). `Pod.lazy/eager(impl, { config?, isolation? })` omit `isolation` when it is `undefined` or `'host'`. `AppDeployment.layout?: Record<string, unknown>`.

- [ ] **Step 1: Write the failing tests**
  - `Pod.lazy(impl, { isolation: 'sandbox' })` → `{ implementation, eager: false, isolation: 'sandbox' }`; `{ isolation: 'host' }` → no `isolation` key.
  - `Pods.create({ a: { implementation, eager: false, isolation: 'iframe' } }, …)` → `invalid-input`; each of the three values → ok.
  - `assemble({ …, layout: { dock: { root: null } } }, registry)` ok; `layout: 'x'` → `invalid-input`; `layout: [1]` → `invalid-input`.
  - `app.deployment()` has no `layout` key after creating from a deployment with one, and keeps a pod's `isolation`.
  - `apply` of the same deployment with one pod's `isolation` changed reports it in `applied.changed`.
- [ ] **Step 2:** Run `cd packages/nano && bun test --isolate test/isolation-layout.test.ts`; expect failures.
- [ ] **Step 3:** Implement: the `isolation` union in the pods Shape (`Type.Optional(Type.Union([Type.Literal('host'), Type.Literal('sandbox'), Type.Literal('isolated-sandbox')]))`); `layout: Type.Optional(Type.Record(Type.String(), Type.Unknown()))` in the deployment Shape. Update the two docs.
- [ ] **Step 4:** Run the whole nano suite and root `bunx tsc --noEmit`; both pass.
- [ ] **Step 5:** Commit `feat(nano): a pod's isolation and the host's layout, as data`.

### Task 2: `Application.create(…, { isolate })` (nano)

**Files:**
- Modify: `packages/nano/src/application/index.ts` (Opts, Live), `packages/nano/src/application/messages.ts` (`Live.isolate?`), `packages/nano/src/application/instances.ts` (`build`)
- Modify: `design.md` (Application row), the pods-runtimes spec ("The live Application" section)
- Test: `packages/nano/test/isolation.test.ts`

**Interfaces:**
- Consumes: Task 1's `Pod.isolation`.
- Produces: `Application.create(runtimes, { policies?, timeoutMs?, isolate?: (name: string, pod: Pod) => Implementation })`. In `build`, a pod whose `isolation` is set and isn't `'host'` is built from `isolate(name, pod)` instead of the registry. No `isolate` → `invalid-input` `no host for isolation <mode>`. A returned implementation whose `coord` ≠ `pod.implementation` → `invalid-input` `isolate gave <coord> for <pod.implementation>`. `isolate` throwing → `threw`.

- [ ] **Step 1: Write the failing tests**
  - A `sandbox` pod: `isolate` is called once with `('c', pod)`, and `app.call('r','c').inc(null)` is served by the stand-in's handlers.
  - Host pods never call `isolate`.
  - No `isolate`: the call resolves `{ ok: false, fail: { type: 'invalid-input', reason: 'no host for isolation sandbox' } }`.
  - A wrong coord gives `invalid-input`.
  - `apply` switching `c` from host to `isolated-sandbox`: the old build closes with `changed`, and the next call goes through `isolate`.
  - A stand-in's close listener runs on `app.close()`.
- [ ] **Step 2:** Run it; expect failures.
- [ ] **Step 3:** Implement. `Live` gets `isolate?` (keeps `Live` at 10 members). Keep `instances.ts` ≤150 lines.
- [ ] **Step 4:** Run the nano suite (structure test included) and root tsc.
- [ ] **Step 5:** Commit `feat(nano): Application.create takes isolate, the host's stand-in for a non-host pod`.

### Task 3: The sandbox protocol, frame side and host side (ui-workspace, headless)

**Files:**
- Create: `packages/ui-workspace/src/sandbox/protocol.ts` (messages, checks), `src/sandbox/serve.ts` (frame side), `src/sandbox/frame-context.ts` (the frame's `NanoContext` proxy), `src/sandbox/stand-in.ts` (host side), `src/sandbox/edges.ts`
- Reference: `35f1675^:packages/ui-workspace/src/sandbox/{protocol,serve,stand-in}.ts` (the old checks and the regex guard carry over)
- Test: `packages/ui-workspace/test/sandbox.test.ts` (a `MessageChannel` in Bun: `serve` on `port1`, the stand-in on `port2`, no iframe)

**Interfaces:**
- Consumes: Task 2's `isolate`; nano's `matches`, `NanoContext`, `Implementation`, `isNanoResult`.
- Produces:
  - `type Edge = { pod: string; runtime: string; implementation: string; provider: string; provides: string[]; tags: string[] }`
  - `type Msg`, host→frame: `build { pod, runtimes, coord, url, config, edges }`, `call { id, port, input }`, `outresult { id, result }`, `edges { edges }`, `close { reason }`, `view-result { id, result }`, `stream { event }`, `probe { url }`.
  - `type Msg`, frame→host: `ready`, `failed { error }`, `result { id, result }`, `publish { op, data }`, `outcall { id, pod, runtime, op, input }`, `view-call { id, op, input }`, `closed`, `described { providers }`, `warn { reason }`.
  - `checkMsg(x: unknown): Msg | string`. Over 1 MiB of JSON is refused, and schemas in `described` carrying `pattern`/`format`/unsafe `patternProperties` are refused.
  - `edgesFor(d: AppDeployment, registry: Registry, pod: string): Edge[]`: the call subscriptions from `pod` in every runtime it is placed in, in deployment order.
  - `serve(port: MessagePort, load: (url: string) => Promise<Implementation>, opts?: { render?(tag, target) }): void`
  - `type Frame = { port: MessagePort; ready: Promise<void>; dispose(): void; element?: HTMLIFrameElement }`
  - `standIn(real: Implementation, deps: { url: string; open(pod: string): Frame; edges(pod: string): Edge[]; onApplied(fn: () => void): () => void; warn(reason: string): void; readyMs?: number }): Implementation`. Same coord, provides, dependencies and config as `real`. `make` opens the frame, posts `build`, awaits `ready` within `readyMs ?? READY_MS`, and returns one handler per action port that posts `call` and awaits `result`.
  - `outcall` → the selection in `ctx.all({})` with that pod and runtime → `.call[op](input)` → `outresult`.
  - `publish` → the event op of that name among `real.provides` → `ctx.publish`.
  - `onApplied` → `edges` is posted again.
  - Close → `close`, then await `closed` (bounded by `readyMs`), then `dispose()`.
- Frame side: `ctx.one/all` match `edges` with `matches`; a Selection's `call.op(x)` posts `outcall`. `on` returns a
  no-op unsubscribe and posts `warn { reason: '<pod>: on does not cross a sandbox' }`.
- `warn { reason }` (frame→host) is passed to `deps.warn(reason: string): void`; the host shows it as a toast.
  **Spec deviation (ruled):** the spec puts this warning on the stream, but nano has no way for an implementation
  or host to emit a stream event, and adding one would be new API, so it is a toast. Ledger it.

- [ ] **Step 1: Write the failing tests** (two pods: `s` sandboxed via a stand-in over the channel, `h` host-mode, wired `s → h` by a call edge and `s.tick → h.record` by a pipe)
  - `app.call('r','s').echo('x')` → `success('x')`, and the stream shows `sent`/`delivered` for it.
  - Inside the frame, `ctx.one(H).call.record(1)` reaches `h` through the edge (`h` saw 1).
  - The frame's `ctx.publish(Ticks.ops.tick, 2)` pipes to `h.record` (`h` saw 2).
  - `app.close()` runs the frame's close listener, and `dispose` was called once.
  - A frame that never sends `ready` (`readyMs: 50`): the call resolves `{ ok: false }` with fail type `threw`, within 200ms.
  - The frame posts `{ type: 'result', id: 999 }`, `{ type: 'nope' }`, a 2 MiB `publish`, and a `described` with a `pattern` schema: none throws on the host, each is dropped with `console.warn`, and later calls still work.
  - After `apply` removes `s → h`, the frame's `ctx.one(H).ok` is `false` (edges re-pushed), and an `outcall` sent anyway resolves `not-found`.
- [ ] **Step 2:** Run `cd packages/ui-workspace && bun test --isolate test/sandbox.test.ts`; expect failures.
- [ ] **Step 3:** Implement, porting the old checks. Keep each file ≤150 lines.
- [ ] **Step 4:** Run the ui-workspace suite and root tsc.
- [ ] **Step 5:** Commit `feat(ui-workspace): sandboxed pods over a MessagePort, both ways`.

### Task 4: Frames, the frame boot, and `isolate` in the host

**Files:**
- Create: `src/sandbox/frames.ts` (srcdoc, layer, `openFrame`), `src/sandbox/boot.ts` (the frame's entry), `src/sandbox/sandboxed-view.ts` (`<nano-sandboxed>`)
- Modify: `src/host.ts` (pass `isolate` to `Application.create`; the host keeps each pod's provider URL from `providers`), `scripts/build.ts` (bundle `src/sandbox/boot.ts` → `public/sandbox/boot.js`, shared imports bare)
- Reference: `35f1675^:…/sandbox/{frames,boot,sandboxed-el}.ts`
- Test: `packages/ui-workspace/test/frames.test.ts` (happy-dom)

**Interfaces:**
- Consumes: Task 3's `standIn`, `serve`, `edgesFor`, `Frame`.
- Produces:
  - `openFrame(mode: 'sandbox' | 'isolated-sandbox'): Frame`: an iframe in the layer `#nano-sandbox-layer`, transferring `port2`.
  - `srcdoc(importMap, bootUrl, base): string`.
  - `<nano-sandboxed>`, which has `target: ViewTarget` and places its pod's frame (looked up by pod name in a `frameOf(pod)` map kept by the host) over itself.
  - In the frame, `boot.ts` serves the pod and renders its view (the module's `views` default for the implementation) with a proxy `target.app`: `call(runtime, pod)` works only for its own pod and posts `view-call`; `listen` hears `stream` events naming its pod.
  - The host answers `view-call` with `app.call(runtime, pod)` and relays stream events naming the pod.
  - The host's default view for a non-host pod is `nano-sandboxed`.

- [ ] **Step 1: Write the failing tests**
  - `srcdoc` makes every import-map URL absolute and escapes `<`.
  - `openFrame('isolated-sandbox')` creates one iframe with `sandbox="allow-scripts"`, and `'sandbox'` gives `allow-scripts allow-same-origin`.
  - `dispose()` removes the iframe, so after build→close→build the layer holds exactly 1 iframe (Review Focus 4).
- [ ] **Step 2:** Run it; expect failures.
- [ ] **Step 3:** Implement. The browser path is proven in Task 11.
- [ ] **Step 4:** ui-workspace suite plus `bun run build` (it produces `public/sandbox/boot.js`) and root tsc.
- [ ] **Step 5:** Commit `feat(ui-workspace): sandbox frames, their boot, and the host's isolate`.

### Task 5: Import moves from nano-ui into ui-workspace

**Files:**
- Move: `packages/ui/src/import.ts` → `packages/ui-workspace/src/import.ts`, and `packages/ui/test/import.test.ts` (+ any fixtures only it uses) → `packages/ui-workspace/test/import.test.ts`
- Modify: `packages/ui/src/index.ts` (drop the export line and the doc line), `packages/ui/README.md`, `packages/ui-workspace/src/host.ts` (import from `./import.ts`), docs naming nano-ui's `importApp`
- Test: the moved test, unchanged except for its import path

**Interfaces:**
- Produces: `importApp(url, loaded)`, `merge`, `Loaded` as module-local exports of `ui-workspace/src/import.ts` (no behaviour change in this task).

- [ ] **Step 1:** Move with `git mv`, fix the imports, and grep that nothing else imports them from nano-ui.
- [ ] **Step 2:** Run the ui, ui-workspace and examples suites, plus root tsc.
- [ ] **Step 3:** Commit `refactor: import is the workspace's — importApp, merge and Loaded leave nano-ui`.

### Task 6: Cross-origin import: confirm, probe, approve

**Files:**
- Modify: `src/import.ts` (drop the same-origin rule; take `deps`)
- Create: `src/import-confirm.ts` (the confirm dialog, port of `35f1675^:…/components/imports-confirm.ts`), `src/described.ts` (a Provider rebuilt from a probe)
- Test: `packages/ui-workspace/test/cross-origin.test.ts`

**Interfaces:**
- Consumes: Task 3's `probe`/`described` messages; Task 4's `openFrame`; HostUI `approve`.
- Produces:
  - `importApp(url, loaded, deps: { load(url): Promise<unknown>; probe(url): Promise<NanoResult<{ provider: Provider; views: ViewMap }>>; confirm(list: Foreign[]): Promise<boolean>; approve(title: string): Promise<boolean> })`
  - `type Foreign = { coord: string; url: string; origin: string; pods: { name: string; isolation: string; fullAccess: boolean }[] }`. `fullAccess` is true for `host` and `sandbox`.
  - Same-origin providers are loaded as today, with no confirm.
  - If any provider is cross-origin, `confirm` is asked once with every foreign provider. `false` → `failure('invalid-input', 'import cancelled')` and nothing registered.
  - Foreign providers are **probed, never loaded**. `described(probe)` rebuilds the Provider with nano's `defineSchema`/`op`/`iface`/`implementation`/`provider`. Hashes match, so pipes still fit.
  - Each described implementation's `make` (the host-mode path) first asks `approve('Run <coord> from <origin> in this page?')`. Yes → `load(url)` and delegate to the real implementation. No → throw `not approved`.
  - A `sandbox`-mode pod of a foreign provider (same-origin frame, so full access) asks the same `approve` in the
    host's `isolate` before its frame is opened. Only `isolated-sandbox` runs foreign code without asking again.

- [ ] **Step 1: Write the failing tests** (deps faked; the nano.json and module URLs on `https://other.test`)
  - A same-origin import never calls `confirm` or `probe`.
  - A foreign provider: `confirm` gets one entry, with `fullAccess` true for a `host` pod and false for an `isolated-sandbox` pod.
  - `confirm` → false: the registry gains nothing and the result is `import cancelled`.
  - `confirm` → true: `probe` is called and `load` is not; the described implementation's `provides[0].ops.x.coord` equals the real one's.
  - A host-mode pod of it: on `approve` false, the call fails and `load` was never called (Review Focus 5); on `approve` true, `load` is called once and the call succeeds. A `sandbox` pod of it asks `approve` too, and an
    `isolated-sandbox` pod does not.
- [ ] **Step 2:** Run it; expect failures.
- [ ] **Step 3:** Implement. `host.ts` wires real deps (`import()`, a probe through `openFrame('isolated-sandbox')`, the confirm dialog, `ui.approve`).
- [ ] **Step 4:** ui-workspace suite and root tsc.
- [ ] **Step 5:** Commit `feat(ui-workspace): cross-origin import, confirmed and probed; host mode asks first`.

### Task 7: The shell: app shell, drawer, app bar, pages

**Files:**
- Create (port): `src/shell/app-shell.ts`, `src/shell/routes.ts`, `src/shell/app-bar.ts` (shows HostUI's `setAppBar` text, then the File and View menus as `nano-menu`)
- Modify: `public/index.html` (routes: `/workspace` (default), `/themes`, `/settings`; the drawer nav), `public/app.css`, `src/main.ts`; delete `src/shell.ts` once Tasks 8–10 replace its parts (in this task it stays mounted inside `/workspace`)
- Reference: `35f1675^:…/components/{app-shell,app-bar}.ts`, `…/lib/routes.ts`, `…/public/{index.html,app.css}`
- Test: `packages/ui-workspace/test/shell.test.ts` (happy-dom)

**Interfaces:**
- Produces:
  - `<app-shell>` with `nav` and `title-actions` slots.
  - `<app-route path>`, with `#/` routing.
  - `<workspace-app-bar>`, which has `host: Host` and fires `nano-command` with `detail: 'new' | 'import' | 'open' | 'save' | 'save-as' | 'tabs' | 'clear' | 'save-layout' | 'restore' | 'reset'`.
  - Settings shows one button, "Forget pane sizes and the saved layout", which clears this browser's `split:*` keys and the host's kept layout.
  - Systems, the puzzle editor and the Components gallery are not ported.

- [ ] **Step 1: Write the failing tests**
  - Navigating to `#/themes` shows only that route.
  - An unknown hash shows the `*` route.
  - The app bar shows the text `setAppBar` was last called with.
  - Choosing File › Save fires `nano-command` with `save`.
- [ ] **Step 2:** Run; expect failures.
- [ ] **Step 3:** Port, removing the old `nano-app`, `nano-runes` and `PlacedElement` dependencies.
- [ ] **Step 4:** ui-workspace suite, `bun run build`, root tsc, and `bunx playwright test e2e/slice.e2e.ts`, which still passes against `/workspace`.
- [ ] **Step 5:** Commit `feat(ui-workspace): the shell is back — drawer, app bar, pages`.

### Task 8: The golden-layout dock and `layout`

**Files:**
- Create (port, split): `src/dock/dock.ts` (`<workspace-dock>`), `src/dock/panels.ts` (what each panel holds), `src/dock/layout.ts` (pure)
- Modify: `package.json` (`golden-layout: 2.6.0`), `scripts/build.ts` (the golden-layout CSS), `src/host.ts` (keeps `layout` like `views`; `data()` and `saved()` include it)
- Reference: `35f1675^:…/components/workspace-dock.ts`, `…/lib/dock-layout.ts` and its test
- Test: `packages/ui-workspace/test/dock-layout.test.ts`

**Interfaces:**
- Produces:
  - Panel ids: `explorer`, `wiring`, `stream`, `pod:<name>`.
  - `layout = { dock: <golden-layout ResolvedLayoutConfig as JSON> }`.
  - `defaultLayout(pods: string[]): Layout`: explorer on the left, pod views stacked in the middle, wiring and stream stacked on the right.
  - `prune(layout: unknown, pods: string[]): { layout: Layout; dropped: string[] }`. An unreadable layout returns `defaultLayout` with `dropped: []` and `invalid: true`.
  - View › Save layout writes the current arrangement into the host's `layout`. Restore goes back to it, Reset to `defaultLayout`, Tabs stacks every panel, and Clear closes pod panels.
  - Clicking or dragging a pod in the explorer opens or focuses `pod:<name>`, showing the pod's chosen view (or `nano-sandboxed`).
  - Closing a pod panel leaves the pod alone.

- [ ] **Step 1: Write the failing tests** (pure `layout.ts`, ported plus new)
  - `prune` drops `pod:gone` and keeps the rest.
  - `prune('nonsense', …)` gives the default with `invalid: true` (Review Focus 3).
  - `defaultLayout(['a','b'])` holds `pod:a` and `pod:b`.
  - `host.saved()` includes `layout` once one was saved.
- [ ] **Step 2:** Run; expect failures.
- [ ] **Step 3:** Implement. Opening a `nano.json` with a `layout` restores it, and dropped panels show a toast naming them.
- [ ] **Step 4:** Suite, build, root tsc.
- [ ] **Step 5:** Commit `feat(ui-workspace): the golden-layout dock, saved as nano.json's layout`.

### Task 9: Building in the workspace: drawer and pod editing

**Files:**
- Create: `src/edit.ts` (pure deployment edits), `src/dock/component-drawer.ts` (port of `35f1675^:…/components/component-drawer.ts`), `src/dock/pod-menu.ts` (the pod panel header menu)
- Delete: `src/shell.ts` (its forms are replaced)
- Test: `packages/ui-workspace/test/edit.test.ts`

**Interfaces:**
- Produces (pure; each returns a new `AppDeployment`):
  - `addPod(d, implementation: string, isolation?: Pod['isolation']): { d; name }`. The name is the implementation's last segment plus the first free number, placed in `main`.
  - `setImplementation(d, pod, coord)`, keeping config only if it still fits; the caller passes `fits`.
  - `setIsolation(d, pod, mode)`, `setView(d, pod, tag)`, `setConfig(d, pod, json: unknown)`.
  - `connect(d, runtime, sub: Subscription)`, `disconnect(d, runtime, sub)`.
  - `removePod(d, pod)`, which also drops its subscriptions, `views` entry, tags and its `pod:` panel from `layout`.
- The drawer lists registry implementations by provider. A click or a drag into the dock calls `addPod` (`isolated-sandbox` when the provider is foreign, from Task 6), applies, and opens the panel.
- The pod menu: implementation, view, isolation, config (JSON textarea), add call edge, add pipe, remove a connection, remove pod. Each is one `host.apply`.

- [ ] **Step 1: Write the failing tests** for each pure function.
  - `addPod` twice gives `log1` and `log2`.
  - `removePod` leaves no subscription naming it and no `pod:<name>` in `layout`.
  - `setIsolation(d,'a','host')` deletes the key.
  - `connect` refuses a duplicate by returning `d` unchanged.
- [ ] **Step 2:** Run; expect failures.
- [ ] **Step 3:** Implement, then delete `shell.ts`. Port `e2e/slice.e2e.ts` to the dock UI: the explorer opens panels, and the pod menu changes the implementation.
- [ ] **Step 4:** Suite, build, root tsc, `bunx playwright test e2e/slice.e2e.ts`.
- [ ] **Step 5:** Commit `feat(ui-workspace): add pods from the drawer, edit them from their panel`.

### Task 10: File: new, import, open, save, saved workspaces

**Files:**
- Create (port): `src/file/import-dialog.ts` (URL or file), `src/file/open-dialog.ts`, `src/file/saved.ts` (pure, port of `35f1675^:…/lib/saved-workspaces.ts`, trimmed to named `nano.json`s), `src/file/commands.ts` (`nano-command` → host)
- Modify: `src/main.ts` (`?src=` uses the same import path, cross-origin now allowed via confirm)
- Test: `packages/ui-workspace/test/saved.test.ts`

**Interfaces:**
- Produces:
  - `saved.list(): { name: string; at: string }[]`, `saved.put(name, d: AppDeployment)`, `saved.get(name)`, `saved.remove(name)`. These live in `localStorage` under `nano.workspaces`, survive a throwing `localStorage` (they become no-ops), and are listed newest first.
  - New: apply a deployment with only the host pod.
  - Import: from a URL, or a file whose provider URLs must be absolute (otherwise a toast and nothing imported).
  - Save: download `nano.json` = `host.saved()`.
  - Save as workspace: `saved.put`.
  - Open: list, open (apply plus restore layout), remove.

- [ ] **Step 1: Write the failing tests**
  - put/get round-trips a deployment with `layout`.
  - `list` puts the newest first.
  - A throwing `localStorage` gives an empty list with no throw.
  - Importing a file with a relative provider URL is refused with `provider URLs in a file must be absolute`.
- [ ] **Step 2:** Run; expect failures.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Suite, build, root tsc.
- [ ] **Step 5:** Commit `feat(ui-workspace): new, import, open, save and saved workspaces`.

### Task 11: End-to-end and docs

**Files:**
- Create: `e2e/workspace.e2e.ts`
- Modify: `playwright.config.ts` (a second web server: `make ui PORT=3211`, the same files on another origin), `packages/ui-workspace/README.md` (the shell, dock, isolation modes and their trust, cross-origin import), `design.md` if any wording is still missing

**Interfaces:** consumes everything above.

- [ ] **Step 1: Write the tests** (the spec's four, plus Review Focus 4):
  1. `/?src=/examples/slice/nano.json`: open `in` and `out` from the explorer into the dock, Save layout, reload with the same `?src=`, and both panels are back.
  2. Set `up` to `isolated-sandbox` from its pod menu: typing `hi` into `in` still logs `HI`, and `up`'s panel contains an iframe with `sandbox="allow-scripts"`.
  3. A sandboxed pod calls through its call edge and publishes along a pipe: use the template or slice wiring with `up` sandboxed, and the stream shows `sent` from `up`.
  4. Import `http://localhost:3211/examples/slice/nano.json` from the 3210 workspace: the confirm prompt appears, Cancel imports nothing, and the explorer is unchanged.
  5. Switch `up` back to `host` and remove it: `#nano-sandbox-layer iframe` count is 0.
- [ ] **Step 2:** Run `bunx playwright test`; fix until green.
- [ ] **Step 3:** Run every suite in Global Constraints.
- [ ] **Step 4:** Commit `test(e2e): the workspace — layout, sandboxes both ways, cross-origin confirm`.
