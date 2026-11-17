# Foundation (one stack, proven by the thin slice) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `ui-workspace` runs on `@pritzlaff/nano`. It loads a separate bundle of built-in components, imports the thin-slice
example (input → debounce → map → log) from its `nano.json` and ES modules, and shows it in an explorer, pod views and
the wiring view, with the map swapped live. nano-core and every package built on it are gone.

**Architecture:** Three separate pieces, none importing another's internals:
- `packages/ui` (`@pritzlaff/nano-ui`): the `nano.ui` provider (built-in pods and the `HostUI` interface), their
  views, the generic `<nano-pod-view>`, the explorer, the wiring view and `importApp`.
- `examples/slice`: a `nano.json` and its own provider module.
- `packages/ui-workspace`: the host.

Provider modules are built as ES modules with `@pritzlaff/nano`, `lit` and `typebox` left external, and the host
resolves those three through an import map. The host holds one `Application`. Importing means merging the incoming
deployment into it with `apply`. The deployment's `providers` and `views` are host data, which nano only
shape-checks.

**Tech Stack:** Bun (build and test), TypeScript, Lit 3.3.3, typebox 1.4.4, happy-dom 21.0.4 (unit), Playwright 1.65.0
(e2e).

**Spec:** `docs/superpowers/specs/2026-11-15-use-case-suite-design.md` (model:
`docs/superpowers/specs/2026-11-14-pods-runtimes-application-design.md`).

## Global Constraints

- CLAUDE.md: no concept drift. The only new public names are the ones this plan lists, and every other new export
  is a question for the user. In `packages/nano`, a source file is at most 150 lines, an exported type has at most
  10 members, and every export is in `design.md`. Apply the same 150-line limit to every new file in `packages/ui`.
- New pieces go in their own packages over `@pritzlaff/nano`, never inside it. `packages/nano` changes only in Task 1.
- Nothing in a component or an application may depend on a particular host.
- An example that only works when compiled into the host fails the decoupling goal.
- An imported app's providers are loaded with `import()` from URLs on the host's own origin.
- A name clash on import is refused, with a message naming the clash.
- Lit web components and the `--nano-*` theme contract (`packages/elements/src/tokens.ts`).
- Nothing throws across a public function. Failures are `NanoResult` values, as in `@pritzlaff/nano`.
- Tests: `cd packages/nano && bun test --isolate`; `cd packages/ui && bun test --isolate`;
  `cd packages/ui-workspace && bun test --isolate`; `cd examples && bun test --isolate`; `bunx tsc --noEmit` at the
  root; `bunx playwright test`. Never run a bare root `bun test`.
- Never stage `kerits/`, `designs/` or `spikes/`.

## Review Focus

1. **A provider URL that 404s, or a module without a default `Provider`:** the import fails with a reason naming the
   URL, and the application is unchanged. This is pinned in Task 4.
2. **Importing the same example twice:** refused with `clash: pod <name> is already loaded`, and the application is
   unchanged. This is pinned in Task 4.
3. **A view whose pod `apply` has removed:** the view shows "removed", stops listening, and nothing throws. This is
   pinned in Task 3.
4. **A map whose `code` doesn't parse, or throws:** a bad parse fails the build (`threw`, from `make`) and a throw
   fails that call. The host keeps running. This is pinned in Task 2.
5. **A `views` selector naming a tag that is never defined:** the generic `<nano-pod-view>` is shown. This is
   pinned in Task 3.

---

### Task 1: `AppDeployment` carries `providers` and `views`

**Files:**
- Modify: `packages/nano/src/deployment.ts`. In the type and in `Shape`, add
  `providers: Type.Optional(Type.Record(Id, Type.String({ minLength: 1 }), strict))` and
  `views: Type.Optional(Type.Record(Id, Type.String({ minLength: 1 }), strict))`.
- Modify: `design.md` (the `AppDeployment` row) and the model spec's "Data" block.
- Test: `packages/nano/test/deployment-host-data.test.ts`

**Interfaces:**
- Produces: `AppDeployment = { pods; runtimes; tags?; providers?: Record<string, string>; views?: Record<string, string> }`.
  `assemble` accepts both and otherwise ignores them. `app.deployment()` doesn't return them, because the host owns
  them (Task 7 merges them back in when saving).

- [ ] **Step 1: Write the failing tests**

```ts
test('given providers and views, when assembled, then it succeeds and builds the same runtimes as without them', ...)
  // assemble({ ...d, providers: { acme: './acme.js' }, views: { c: 'acme-counter' } }, registry()).ok === true
test('given a non-string provider URL or view, when assembled, then it is invalid-input naming the key', ...)
  // views: { c: 3 } → fail.type 'invalid-input', fail.reason contains 'views'
test('given a views key that is not an id, when assembled, then it is invalid-input', ...)   // views: { '': 'x' }
```

- [ ] **Step 2:** Run `cd packages/nano && bun test --isolate test/deployment-host-data.test.ts`. Expected: FAIL (the
  first test is refused as an unknown key).
- [ ] **Step 3:** Make the shape change above.
- [ ] **Step 4:** Run the whole nano suite and `bunx tsc --noEmit`. Expected: PASS, including `structure.test.ts`.
- [ ] **Step 5:** Commit `feat(nano): an AppDeployment may carry the host's providers and views`.

---

### Task 2: `@pritzlaff/nano-ui`, the built-in pods

**Files:**
- Create: `packages/ui/package.json` (name `@pritzlaff/nano-ui`; deps `@pritzlaff/nano`, `@pritzlaff/nano-elements`,
  `lit`, `typebox` as `workspace:*` / `^3.3.3` / `1.4.4`).
- Create: `packages/ui/bunfig.toml`, preloading `./test/dom.ts` (copy `packages/elements/test/dom.ts`).
- Create: `packages/ui/src/interfaces.ts`, `src/pods/input.ts`, `src/pods/debounce.ts`, `src/pods/map.ts`,
  `src/pods/log.ts`, `src/provider.ts`, `src/index.ts`.
- Test: `packages/ui/test/slice.test.ts`

**Interfaces:**
- Produces (`interfaces.ts`): `Any = defineSchema('Any', Type.Unknown())`, `Nothing = defineSchema('Nothing', Type.Null())`, and:
  - `Input = iface('nano.ui.Input', { submit: op.action('submit', Any, Any) })`. It returns its input, so its result
    can be piped.
  - `Debounce = iface('nano.ui.Debounce', { push: op.action('push', Any, Nothing), flushed: op.event('flushed', Any) })`.
  - `MapIface = iface('nano.ui.Map', { map: op.action('map', Any, Any) })`.
  - `Log = iface('nano.ui.Log', { log: op.action('log', Any, Nothing), entries: op.action('entries', Nothing, Type.Array(Type.Unknown())), clear: op.action('clear', Nothing, Nothing) })`.
    Use `defineSchema` for the array.
  - `HostUI = iface('nano.ui.HostUI', { alert: op.action('alert', Type.String(), Nothing), approve: op.action('approve', Type.Object({ title: Type.String(), detail: Type.Optional(Type.String()) }), Type.Boolean()), setAppBar: op.action('setAppBar', Type.String(), Nothing) })`.
    Use `defineSchema` for each. This task defines only the interface; Task 7 implements it.
- Produces (pods), each `implementation('nano.ui/<name>', …)`:
  - `nano.ui/input`.
  - `nano.ui/debounce`, config `{ quietMs: integer 0..60000 }`, default 300. `push` returns at once. After `quietMs`
    of quiet it publishes `flushed` with the last value. The timer is cleared in `addOnCloseListener`.
  - `nano.ui/map`, config `{ code: string }`, a function body over `x`, for example `"return String(x).toUpperCase()"`,
    compiled with `new Function('x', code)` in `make`.
  - `nano.ui/log`, config `{ max?: integer 1..1000 }`, default 100. It keeps the newest `max` entries.
- Produces (`provider.ts`): `uiProvider = provider('nano.ui', [input, debounce, map, log])`.
- Produces (`index.ts`): `export default uiProvider`, plus the named exports above.

- [ ] **Step 1: Write the failing tests** (headless, through `assemble` and `Application.create`, as in
  `examples/messenger/messenger.test.ts`)

```ts
const slice: AppDeployment = { pods: {
    in: Pod.eager(input), wait: Pod.eager(debounce, { config: { quietMs: 10 } }),
    up: Pod.lazy(map, { config: { code: 'return String(x).toUpperCase()' } }), out: Pod.lazy(log) },
  runtimes: { main: { pods: ['in', 'wait', 'up', 'out'], subscriptions: [
    { kind: 'pipe', from: 'in', source: port(Input, Input.ops.submit), to: 'wait', target: port(Debounce, Debounce.ops.push) },
    { kind: 'pipe', from: 'wait', source: port(Debounce, Debounce.ops.flushed), to: 'up', target: port(MapIface, MapIface.ops.map) },
    { kind: 'pipe', from: 'up', source: port(MapIface, MapIface.ops.map), to: 'out', target: port(Log, Log.ops.log) } ] } } }
test('given the slice, when "h", "hi" are submitted within the quiet time, then the log holds only "HI"', ...)
  // call in.submit('h'), in.submit('hi'); wait 40ms; out.entries(null) → success(['HI'])
test('given a map whose code does not parse, when it is called, then it fails with threw and the app keeps running', ...)
  // code: 'return (' → app.call('main','up').map(1) → { ok: false, fail: { type: 'threw' } }; in.submit still succeeds
test('given a map whose code throws, when it is called, then that call fails and the next succeeds', ...)
  // code: 'if (x === 1) throw new Error("no"); return x' → map(1) fails, map(2) → success(2)
test('given a log with max 2, when three entries are logged, then it keeps the newest two', ...)
test('given a debounce, when the application closes before it flushes, then nothing is published after close', ...)
```

- [ ] **Step 2:** Run `cd packages/ui && bun install && bun test --isolate`. Expected: FAIL (the modules are missing).
- [ ] **Step 3:** Implement the interfaces, the four pods, the provider and the index as specified.
- [ ] **Step 4:** Run the tests and `bunx tsc --noEmit` at the root. Expected: PASS.
- [ ] **Step 5:** Commit `feat(nano-ui): the nano.ui provider (input, debounce, map, log) and the HostUI interface`.

---

### Task 3: Pod views (the contract, the faces, `<nano-pod-view>`)

**Files:**
- Create: `packages/ui/src/views/view.ts` (the contract and `viewFor`), `src/views/pod-view.ts`,
  `src/views/faces.ts` (`nano-input`, `nano-debounce`, `nano-map`, `nano-log`), `src/views/define.ts`.
- Modify: `packages/ui/src/index.ts` (adds `views` and `defineViews`).
- Test: `packages/ui/test/views.test.ts`

**Interfaces:**
- Produces (`view.ts`):
  - `type ViewTarget = { app: Application; registry: Registry; runtime: string; pod: string }`. Every view is a custom
    element with a `target: ViewTarget` property, and that is the whole contract. A view reaches its pod only
    through `target.app.call(target.runtime, target.pod)` and `target.app.listen`.
  - `type ViewMap = Record<string, string>`, mapping an implementation coordinate to a custom-element tag.
  - `viewFor(pod: string, deployment: AppDeployment, defaults: ViewMap): string` returns, in order:
    1. `deployment.views[pod]`, if that tag is defined (`customElements.get`);
    2. else `defaults[deployment.pods[pod].implementation]`, if defined;
    3. else `'nano-pod-view'`.
- Produces (`index.ts`): `views: ViewMap = { 'nano.ui/input': 'nano-input', 'nano.ui/debounce': 'nano-debounce', 'nano.ui/map': 'nano-map', 'nano.ui/log': 'nano-log' }`,
  and `defineViews(): void`, which defines the five tags and is idempotent. A provider module exports its default
  views the same way: a named `views` export beside its default `Provider`. Provider `meta` is not used.
- `<nano-pod-view>` shows:
  - the pod's name, implementation, config (JSON) and runtimes, which are the runtimes whose `pods` include it;
  - each interface it provides, with each op's name and kind;
  - live metrics from `listen`: per port, a count of `sent` where `to === pod` and the last `delivered` result's value
    (matched by `id`).
- Faces:
  - `nano-input`: a text field. Enter calls `submit`.
  - `nano-debounce`: shows pending, from a `sent` to its `push`, and flashes on its `flushed`, from a `sent` with
    `from === pod`.
  - `nano-map`: shows `code` from config and the last input and output.
  - `nano-log`: lists `entries`, re-read after each `delivered` of a `log` call to it.
  - Every view stops listening when it disconnects, and when an `applied` event removes its pod. In that case it
    renders "removed".

- [ ] **Step 1: Write the failing tests** (happy-dom; build the Task 2 slice; mount views with `document.createElement`)

```ts
test('viewFor: the deployment selector wins, then the implementation default, then nano-pod-view', ...)
test('viewFor: a selector naming an undefined tag falls back to nano-pod-view', ...)          // Review Focus 5
test('given nano-input and nano-log on the slice, when "hi" is entered, then nano-log shows HI', ...)
test('given nano-pod-view on up, when map is called twice, then it shows 2 calls to nano.ui.Map/map and the last result', ...)
test('given a mounted view, when apply removes its pod, then it renders removed and its listener is gone', ...)  // Review Focus 3
```

- [ ] **Step 2:** Run `cd packages/ui && bun test --isolate test/views.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified. Style only with `t(...)` tokens and `base` from `@pritzlaff/nano-elements`.
- [ ] **Step 4:** Run the ui suite and tsc. Expected: PASS.
- [ ] **Step 5:** Commit `feat(nano-ui): pod views — a view is web components over a pod, chosen by selector, default or generic`.

---

### Task 4: Import (`importApp`, `merge`) and the slice example

**Files:**
- Create: `packages/ui/src/import.ts`
- Create: `examples/slice/nano.json`, `examples/slice/shout.ts` (provider `example.slice` with
  `example.slice/shout`, which provides `MapIface` and returns `` `${x}!` ``, and its named export
  `views: { 'example.slice/shout': 'nano-map' }`), `examples/slice/slice.test.ts`.
- Test: `packages/ui/test/import.test.ts`, with fixtures in `packages/ui/test/fixtures/` (a good app, a 404 provider, a
  module without a default `Provider`).

**Interfaces:**
- Produces:
  - `type Loaded = { deployment: AppDeployment; registry: Registry; views: ViewMap }`.
  - `merge(current: AppDeployment, incoming: AppDeployment): NanoResult<AppDeployment>`. It is pure. It unions
    `pods`, `runtimes`, `tags`, `providers` and `views`. A pod or runtime name already present is `invalid-input` with
    `clash: pod <name> is already loaded` (or `runtime`). A provider already loaded under the same URL is fine; one
    under a different URL is a clash.
  - `importApp(url: string, loaded: Loaded): Promise<NanoResult<Loaded>>`:
    1. `fetch(url)` and parse the JSON;
    2. for each entry in `providers`, resolve it against `url`, run `import()`, and require `default` to be a
       `Provider` whose `coord` matches the key;
    3. add the providers the registry doesn't already have;
    4. return the merged deployment and `views` (the defaults merged).

    It never throws, and on failure `loaded` is unchanged: its registry is added to only after every module has
    loaded. The caller applies the deployment.
- `examples/slice/nano.json`:
  - pods and pipes exactly as in Task 2's `slice`, runtime `main`, map code `return String(x).toUpperCase()`;
  - `"providers": { "nano.ui": "/bundle/nano-ui.js", "example.slice": "./shout.js" }`.

- [ ] **Step 1: Write the failing tests** (`Bun.serve({ port: 0 })` over the fixtures dir, serving `.ts` built on the
  fly with `Bun.build`, `@pritzlaff/nano` external)

```ts
test('given the good app, when imported into an empty Loaded, then the deployment, registry and views come back', ...)
test('given a provider URL that 404s, then it fails naming the URL and loaded is unchanged', ...)    // Review Focus 1
test('given a module without a default Provider, then it fails naming the URL', ...)                  // Review Focus 1
test('given the same app imported twice, then the second is refused with clash: pod in is already loaded', ...)  // Review Focus 2
test('merge: tags, providers and views are unioned; a provider under another URL is a clash', ...)
```
- `examples/slice/slice.test.ts`: `nano.json` assembles against `uiProvider` plus `example.slice`. After `apply`
  swaps `up` to `example.slice/shout`, submitting `hi` logs `hi!`.

- [ ] **Step 2:** Run both suites. Expected: FAIL.
- [ ] **Step 3:** Implement as specified.
- [ ] **Step 4:** Run `packages/ui`, `examples` and tsc. Expected: PASS.
- [ ] **Step 5:** Commit `feat(nano-ui): importApp loads a nano.json and its provider modules; the slice example`.

---

### Task 5: The explorer

**Files:**
- Create: `packages/ui/src/explorer.ts` (`<nano-explorer>`, built on `nano-tree` from `@pritzlaff/nano-elements`).
- Test: `packages/ui/test/explorer.test.ts`

**Interfaces:**
- `<nano-explorer>`, with property `target: { app: Application; registry: Registry }`.
- It shows: the application → each runtime → each pod (implementation, config) → its subscriptions in that runtime.
  Call edges are listed as "built on → <pod>", and pipes as `<source op> → <to>.<target op>`.
- It re-renders on `applied`, and shows `built` and `closed` as the pod's state.
- It dispatches `nano-open: CustomEvent<{ runtime: string; pod: string }>` (bubbles, composed) when a pod is chosen,
  including through a "built on" row. That is the drill-down.

- [ ] **Step 1: Write the failing tests**

```ts
test('given the slice, then it lists runtime main with pods in, wait, up, out and their pipes', ...)
test('given an edge db ← api, when "built on → db" is chosen, then nano-open fires with { runtime, pod: "db" }', ...)
test('given apply adds a pod, then the explorer shows it without being remounted', ...)
```
- [ ] **Step 2–4:** Run, implement, and run again: ui suite and tsc. Expected: PASS.
- [ ] **Step 5:** Commit `feat(nano-ui): the explorer — application, runtimes, pods, edges, with drill-down`.

---

### Task 6: The wiring view, rebuilt from `packages/circuit`

**Files:**
- Create: `packages/ui/src/wiring/types.ts`, `wiring/model.ts`, `wiring/layout.ts`, `wiring/render-*.ts`,
  `wiring/wiring.ts` (`<nano-wiring>`).
- Port: from `packages/circuit/src`, keep `types.ts`, `layout.ts`, `constants.ts` and `render-*.ts` where they don't
  import nano-core or nano-app, and replace their nano-app types (`Box`, `Kind`, `Screen`) with local ones. Rewrite
  `model.ts`.
- Test: `packages/ui/test/wiring.test.ts`

**Interfaces:**
- `circuitOf(deployment: AppDeployment, registry: Registry): Circuit`, with the same `Circuit` shape as
  `packages/circuit/src/types.ts`:
  - one `Layer` per runtime, in deployment order;
  - one `Footprint` per pod in it;
  - one `Pad` per op of each interface the pod's implementation provides (`dir` `in` for actions, `out` for events
    and action results);
  - one `Cable` per subscription (a pipe joins the source and target pads; a call edge is a cable with `type: 'call'`).

  A pod placed in two runtimes appears on both layers, and a side block links its footprints.
- `<nano-wiring>`, with property `target: { app; registry }`. It rebuilds on `applied`. On each `sent` it lights the
  cable for that `(runtime, from, to, port)` for 600ms.

- [ ] **Step 1: Write the failing tests**

```ts
test('circuitOf(slice): one layer, four footprints, three cables joining in.submit→wait.push, wait.flushed→up.map, up.map→out.log', ...)
test('circuitOf: a pod in two runtimes has a footprint on each layer and one side block', ...)
test('given a mounted nano-wiring, when in.submit is called, then the in→wait cable is lit', ...)
```
- [ ] **Step 2–4:** Run, implement and port, and run again: ui suite and tsc. Expected: PASS.
- [ ] **Step 5:** Commit `feat(nano-ui): the wiring view on the new model`.

---

### Task 7: `ui-workspace` on `@pritzlaff/nano`

**Files:**
- Delete: every `packages/ui-workspace/src` and `test` file that imports `@pritzlaff/nano-core`, `@pritzlaff/nano-app`,
  `@pritzlaff/nano-runes`, `@composable/*` or the iframe sandbox (`src/sandbox/`, `src/shared/*` for core and runes).
  Keep the theme files (`lib/themes.ts`, `lib/nano-vars.ts`, `lib/ledger-themes.ts`, `lib/theme-state.ts`,
  `components/theme-picker.ts`, `boot-theme.ts`) and `components/split-pane.ts`, together with any tests that cover
  only them. Check each kept file with `grep -L`.
- Create: `src/main.ts`, `src/host.ts` (the one `Application`, `Loaded`, `importApp` + `apply`, save), `src/host-ui.ts`
  (implementation `workspace.host/ui` of `HostUI`: `alert` uses `toast()`, `approve` uses a `<dialog>` and resolves
  `true` or `false`, `setAppBar` sets the title), `src/shell.ts` (`<workspace-shell>`).
- Modify: `package.json` scripts.
  - `build` produces:
    - `bun build src/main.ts --outdir public --format esm`, with `@pritzlaff/nano`, `lit`, `lit/*` and `typebox`
      external;
    - `public/shared/{nano,lit,typebox}.js`, the shared libraries;
    - `public/bundle/nano-ui.js`, `packages/ui/src/index.ts` built the same way;
    - `public/examples/slice/{nano.json,shout.js}`.
  - `public/index.html`'s import map points those three specifiers at `./shared/*.js`.
- Test: `packages/ui-workspace/test/host.test.ts`

**Interfaces:**
- On start, the host:
  1. loads `/bundle/nano-ui.js` and adds it to the registry;
  2. creates an application from `{ pods: { ui: Pod.eager(hostUi) }, runtimes: { main: { pods: ['ui'], subscriptions: [] } } }`;
  3. lists the `nano.ui` built-ins.
- Its panels (on `split-pane`) are:
  - the built-ins, where choosing one applies a new pod into `main`, named `<kind><n>`;
  - "Connect": choose a source pod and op, then a target pod and op, and it applies a pipe;
  - `<nano-explorer>`;
  - the view area: the view `viewFor` gives for the opened pod, with a picker of the default, `nano-pod-view` and any
    other tag a loaded `views` map gives for that implementation. Picking one sets `views[pod]` in the host's data.
  - a "Change implementation" picker: every registry implementation providing the same interfaces. Picking one
    `apply`s the pod with it.
  - `<nano-wiring>`;
  - the stream (the last 200 events).
- **File** has three entries:
  - **Import URL:** `importApp`, then `apply`. A failure is shown with `toast()`, and nothing changes.
  - `?src=<url>` on load does the same.
  - **Save:** downloads `nano.json` as `{ ...app.deployment(), providers, views }`, with the host pod `ui` and runtime
    `main` left out when empty of anything else.
- The host pod is named `ui`, never `host`.

- [ ] **Step 1: Write the failing tests** (happy-dom)

```ts
test('given a fresh host, then the built-ins input, debounce, map and log are listed and main holds only ui', ...)
test('given the slice imported, then the explorer lists in, wait, up, out and Save round-trips providers and views', ...)
test('given an import whose provider 404s, then a toast names it and the deployment is unchanged', ...)
test('given HostUI.approve called from a pod, then a dialog opens and choosing Approve resolves true', ...)
```
- [ ] **Step 2–4:** Run, implement, and run again: `cd packages/ui-workspace && bun test --isolate`, `bun run build`
  and tsc. Expected: PASS, and `public/` holds `main.js`, `shared/`, `bundle/nano-ui.js` and `examples/slice/`.
- [ ] **Step 5:** Commit `feat(ui-workspace): the host on @pritzlaff/nano — built-ins, import, explorer, views, wiring`.

---

### Task 8: Use case 1, end to end in the browser

**Files:**
- Delete: `e2e/inbox.e2e.ts`, `e2e/nano-json.e2e.ts`, `e2e/sandbox.e2e.ts`, `e2e/fixtures/demo.nano.json`, and the
  template web servers in `playwright.config.ts` (keep only `make ui PORT=3210`).
- Create: `e2e/slice.e2e.ts`

- [ ] **Step 1: Write the test**, as one Playwright test with these steps:

```ts
// open http://localhost:3210/?src=/examples/slice/nano.json
// the explorer lists in, wait, up, out; nano-wiring shows 4 footprints and 3 cables
// open "in", type "hi" + Enter; open "out": nano-log shows "HI" within 2s
// open "up", Change implementation → example.slice/shout; type "hey" in "in": nano-log shows "hey!"
// on "out", pick nano-pod-view: it shows ≥1 call to nano.ui.Log/log
// Save: the downloaded JSON has pods.up.implementation === 'example.slice/shout' and views.out === 'nano-pod-view'
```
- [ ] **Step 2:** Run `bunx playwright test e2e/slice.e2e.ts`. Fix the host (not the test) until it passes.
- [ ] **Step 3:** Commit `test(e2e): use case 1 — import, see, swap live, save`.

---

### Task 9: Retire the old stack; the new model takes the name `@pritzlaff/nano-core`

**Files:**
- Delete: `packages/core`, `packages/app`, `packages/runes`, `packages/editor`, `packages/wires`, `packages/shell`,
  `packages/people`, `packages/platform`, `packages/bundle`, `packages/circuit` and `templates/inbox` (inbox returns as
  use case 2).
- Modify: `packages/elements`. Delete `model-element.ts`, `placed-element.ts`, `catalog.ts` and their tests and
  exports, drop its `@pritzlaff/nano-core` dependency, and set its version to `0.4.0`.
- Rename: `packages/nano/package.json` gets the name `@pritzlaff/nano-core` and version `0.4.0`. Its folder stays
  `packages/nano`. Replace every `'@pritzlaff/nano'` specifier (exact, not `nano-*`) in `packages/`, `examples/`,
  `e2e/`, `scripts/`, `docs/`, `design.md`, `README.md` and the ui-workspace import map and build externals. Its
  README gets a "0.4.0 replaces the 0.3 model" note linking the model spec.
- Modify: the publish list, which becomes `['nano', 'elements', 'ui']` in dependency order:
  - `scripts/build-packages-list.ts`;
  - the Makefile's `publish` loop and comments;
  - `.github/workflows/publish.yml`'s test loop.

  `packages/ui` is published as `@pritzlaff/nano-ui` `0.1.0`.
- Modify: `scripts/smoke-packages.ts`. A scratch consumer installs the built `nano-core`, `nano-elements` and
  `nano-ui`, type-checks, and runs the Task 2 slice headlessly.
- Not done here: `nano-runes` is no longer published, and its 0.3.0 stays on npm. Deprecating anything on npm is the
  user's to do.

- [ ] **Step 1:** Run `grep -rl "nano-app\|nano-runes\|@composable/\|ModelElement\|PlacedElement" --include=*.ts --include=*.json packages examples scripts e2e templates Makefile`.
  Expected: only the paths listed for deletion, plus `templates/nano-template` (Task 10).
- [ ] **Step 2:** Delete them, rename the package, then run `bun install`.
- [ ] **Step 3:** Run every suite from Global Constraints, `bunx playwright test` and `make smoke`. Expected: PASS.
  The Step 1 grep prints only `templates/nano-template`.
- [ ] **Step 4:** Commit `chore: one stack — the new model is @pritzlaff/nano-core 0.4.0; the old packages are retired`.

---

### Task 10: `nano-template` on the new stack

**Files:**
- Rewrite: `templates/nano-template/src`. Its Timer, Picker and Store become one provider, `acme.template` (the
  template's README already says to rename it), with implementations `acme.template/timer`, `picker` and `store`:
  - **timer:** `start`, `stop`, and the event `tick`;
  - **picker:** `pick`, `setOptions`, and the event `changed`;
  - **store:** `get`, `set`, `remove`, and the event `changed`. It keeps the store in `localStorage`, or in memory
    when there is none.

  Each has a view (`<nano-timer>`, `<nano-picker>`, `<nano-store>`) built from the kit and exported in the module's
  `views` map. Add a `nano.json` that places all three in runtime `main`, with a pipe `picker.changed → store.set`.
  For that pipe, `pick` publishes `{ key: 'choice', value }`.
- Modify: `templates/nano-template/package.json`. Dependencies become `@pritzlaff/nano-core ^0.4.0`,
  `@pritzlaff/nano-elements ^0.4.0` and `@pritzlaff/nano-ui ^0.1.0`. The build emits `dist/index.js`, with the
  three libraries external, and `dist/nano.json`. Remove `manifest.json`.
- Modify: `README.md`, `AGENTS.md` and `CLAUDE.md` of the template, for the new model and the import-by-URL flow.
- Modify: `scripts/link-local.ts`, `scripts/template-check.ts`, the Makefile's `link-templates` (template only) and
  `serve-inbox` (removed).
- Test: the template's `test/*.test.ts`, run headlessly through `assemble` and `Application.create`, plus one view
  test each. In `e2e/slice.e2e.ts`, add a second test that imports the template's built `nano.json` into the host,
  served under `/examples/template/`, and sees `<nano-timer>` tick.

- [ ] **Step 1:** Write the template's failing tests (timer ticks then stops; a pick reaches the store through the pipe;
  the store falls back to memory without `localStorage`).
- [ ] **Step 2:** Run `make link-templates && cd templates/nano-template && bun test --isolate`. Expected: FAIL.
- [ ] **Step 3:** Rewrite as specified.
- [ ] **Step 4:** Run the template tests, `make template-check`, and `bunx playwright test`. Expected: PASS. The Task 9
  grep prints nothing.
- [ ] **Step 5:** Commit `feat(template): nano-template on nano-core 0.4 — a provider module, its views and a nano.json`.
