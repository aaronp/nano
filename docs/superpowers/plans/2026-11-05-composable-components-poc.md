# Composable Components PoC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a typed `Context` messaging core (with `emit`, `call` and `capabilities`) and a set of small composable `Contexts.*`. Prove it with `make ui`: a build-time nested host, a runtime-loaded host and a cross-origin iframe event table, all using one API.

**Architecture:** `packages/sdk` is DOM-free core types (TypeBox 1.x) plus `Contexts.*` and `Host.define`, unit tested with `bun test`. The iframe bridge is in the SDK, and its window access is passed in, so it is testable without a browser. `templates/component-template` holds the fire-event component and its harness pages. `apps/host` is the root demo, served on two origins by one Bun script.

**Tech Stack:** Bun 1.3, TypeScript, `typebox@^1.4` (NOT `@sinclair/typebox`, see Global Constraints), `lit@^3`.

**Spec:** `docs/superpowers/specs/2026-11-05-composable-components-poc-design.md`

## Global Constraints

- **Use `typebox@^1.4`** (`import Type from 'typebox'`, `import Value from 'typebox/value'`). It validates plain JSON schemas after `structuredClone`/`postMessage`, which was verified on 2026-11-05. `@sinclair/typebox@0.34` throws `Unknown type` on cloned schemas, and manifests must cross the iframe bridge.
- **No stringly-typed identifiers.** Use structured refs everywhere. Strings are for display only and are never parsed.
- **`Context` has only** `capabilities()`, `emit(event, payload, scope?)` and `call(target, action, input, scope?)`. `scope` is internal to the SDK and components never pass it. Extra operations go on subtypes.
- **`packages/sdk/src/**` must not import DOM types or Lit**, except `packages/sdk/src/lit.ts`.
- Every TypeBox schema and field in `types.ts` carries a `description`. Object schemas also carry a `title`, and leaf fields carry `examples` where a value is meaningful.
- **Never throw out of `emit` or `call`.** Failures are returned as `Result` values.
- **Never compare Contexts or components across bundles with `instanceof`.** The runtime-loaded host bundles its own SDK copy.
- **No bus fallback.** An iframe child that fails its handshake shows an error and never creates a local bus.
- **Sandbox note:** `bun install` needs `BUN_TMPDIR=$TMPDIR BUN_INSTALL_CACHE_DIR=$TMPDIR/bun-cache` in this environment. The Makefile sets both only if `TMPDIR` is set.

## Deviations from the spec (decided while planning)

- `InstanceRef.namespace` is `string[]`, the path of container instance names from the root (for example `['root','pair-1']`), not a `string`. This keeps the path structured.
- `ComponentFactory.create(ctx, self: Instance)`: a component needs its own identity, and hosts need it to build their inner namespace.
- `Invocation` gains `target: InstanceRef`, so that a host can forward a call to a deeper target.
- `Component.environment?(): Environment` is optional. Hosts implement it to present their subtree.
- `Contexts.policy(inner, store, self)` takes a shared `PolicyStore` and the wrapped instance's ref, because wrappers sit outside `child` and need to know who is sending.
- `Contexts.iframeChild(factory, opts)` resolves to `{ ctx, component }`, not to a bare `Context`. The child must send its manifest and serve `onAction`.

## Review Focus

1. **Re-adding after removal:** unregistering an instance, then registering a new one with routes, must deliver each event exactly once, never twice. Test this in Task 2.
2. **A route cycle** (A's event routed to B, whose handler re-emits to A) must end with a loop-guard error, not hang. Test this in Task 3.
3. **A table origin that never answers:** the parent's handshake wait times out and the panel shows an error, while the rest of the page keeps working. Test this in Task 6.
4. **A call to an unknown or elided target** must return `not-allowed`/`error` promptly and never throw or hang. Test this in Tasks 3 and 5.
5. **A malformed or wrong-schema payload from the iframe** is rejected at the parent before any receiver sees it. Test this in Task 6.

---

### Task 1: Workspace and core types

**Files:**
- Create: `package.json` (root, `"workspaces": ["packages/*","templates/*","apps/*"]`, `"private": true`)
- Create: `tsconfig.json` (strict, `"module":"ESNext"`, `"moduleResolution":"bundler"`, `"lib":["ESNext","DOM"]`)
- Create: `Makefile` (target `test`: `bun test`; target `install`)
- Create: `.gitignore` (`node_modules`, `dist*`)
- Create: `packages/sdk/package.json` (name `@composable/sdk`, deps `typebox@^1.4`, `lit@^3`; exports `.` → `src/index.ts`, `./lit` → `src/lit.ts`)
- Create: `packages/sdk/src/types.ts`, `packages/sdk/src/index.ts`
- Test: `packages/sdk/test/types.test.ts`

**Interfaces:**
- Produces, as TypeBox schemas with `Static` types of the same name, all exported from `@composable/sdk`:
  - `ComponentId = { author: string; id: string }`
  - `EventDef = { name: string; schema: TSchema }`
  - `ActionDef = { name: string; input: TSchema; output?: TSchema }`
  - `Manifest = { id: ComponentId; version: string; emits: EventDef[]; consumes: ActionDef[] }`
  - `InstanceRef = { namespace: string[]; instance: string }`
  - `Instance = InstanceRef & { manifest: Manifest }`
  - `EventRef = { instance: InstanceRef; event: string }`
  - `ActionRef = { instance: InstanceRef; action: string }`
  - `Policy<T>`: `allow`/`deny` with `values: T[]`, or `{ type: 'all' }`
  - `Environment = { type: 'leaf'; instance: Instance } | { type: 'node'; instance: Instance; children: Environment[] }`
  - `Capabilities = { environment: Environment; events: Policy<EventRef>; actions: Policy<ActionRef> }`
  - `Invocation = { id: string; from: Instance; target: InstanceRef; action: string; input: unknown; stack: Invocation[] }`
  - `Result<T>` = `success` | `not-allowed` (with `reason`) | `error` (with `error: SystemError`)
  - `SystemError = { code: 'validation'|'unknown-target'|'unknown-action'|'loop'|'timeout'|'handler'|'bridge'; message: string }`
- Produces these TS-only types (functions are not schemas): `Scope = { stack: Invocation[] }`, `Context`, `Component`, `ComponentFactory` (exactly as in the spec, plus the deviations above).
- Produces these helpers in `types.ts`:
  - `defineManifest<const M extends Manifest>(m: M): M`
  - `sameInstance(a: InstanceRef, b: InstanceRef): boolean`
  - `ok<T>(data: T): Result<T>`, `notAllowed(reason): Result<never>`, `fail(code, message): Result<never>`
  - `allows<T>(p: Policy<T>, v: T, eq: (a: T, b: T) => boolean): boolean`

- [ ] **Step 1: Write the failing test**

```ts
test('manifest round-trips through structuredClone and still validates payloads', () => {
  const m = defineManifest({ id: { author: 'acme', id: 'x' }, version: '0.1.0',
    emits: [{ name: 'fired', schema: Type.Object({ text: Type.String() }) }], consumes: [] })
  expect(Value.Check(Manifest, m)).toBe(true)
  const cloned = structuredClone(JSON.parse(JSON.stringify(m)))
  expect(Value.Check(cloned.emits[0].schema, { text: 'a' })).toBe(true)
  expect(Value.Check(cloned.emits[0].schema, { text: 1 })).toBe(false)
})
test('allows: all / allow / deny', () => {
  const eq = (a: number, b: number) => a === b
  expect(allows({ type: 'all' }, 1, eq)).toBe(true)
  expect(allows({ type: 'allow', values: [1] }, 2, eq)).toBe(false)
  expect(allows({ type: 'deny', values: [1] }, 1, eq)).toBe(false)
})
test('sameInstance compares namespace paths structurally', () => {
  expect(sameInstance({ namespace: ['root'], instance: 'a' }, { namespace: ['root'], instance: 'a' })).toBe(true)
  expect(sameInstance({ namespace: ['root','h'], instance: 'a' }, { namespace: ['root'], instance: 'a' })).toBe(false)
})
test('every top-level schema has title and description', () => {
  for (const s of [ComponentId, Manifest, Instance, InstanceRef, Invocation, Capabilities])
    expect(s.title && s.description).toBeTruthy()
})
```

- [ ] **Step 2: Install, then run the test and verify it fails.** Run `make install && bun test packages/sdk/test/types.test.ts`. Expected: FAIL, because the module is not found.
- [ ] **Step 3: Implement `types.ts` and re-export it from `index.ts`.**
- [ ] **Step 4: Run the test and verify it passes.** Run `bun test packages/sdk`. Expected: PASS.
- [ ] **Step 5: Commit** with `git add -A && git commit -m "feat(sdk): workspace and core TypeBox types"`

---

### Task 2: `Contexts.bus` and `Contexts.child`: registration, routes and emit

**Files:**
- Create: `packages/sdk/src/contexts/bus.ts`, `packages/sdk/src/contexts/index.ts` (exports `Contexts` namespace object)
- Test: `packages/sdk/test/bus.test.ts`
- Create: `packages/sdk/test/fixtures.ts`. It holds `echoFactory(author, id)`, a component that consumes `log` (`Type.Unknown()`), emits `fired` (`{text:string}`) and records every `Invocation` it receives in a `received` array, plus `rootRef = { namespace: [], instance: 'root' }`.

**Interfaces:**
- Consumes everything from Task 1.
- Produces:
  ```ts
  type Route = { from: EventRef; to: ActionRef }
  interface BusContext extends Context {
    readonly self: Instance                 // the container this bus belongs to
    register(factory: ComponentFactory, instance: string, wrap?: (c: Context) => Context): Promise<Instance>
    unregister(ref: InstanceRef): Promise<void>       // disposes the component, drops its routes
    route(r: Route): void
    unroute(r: Route): void
    instances(): Instance[]
  }
  Contexts.bus(opts: { self: Instance; parent?: Context; maxDepth?: number /* default 16 */; onDeliveryError?: (e: SystemError, inv: Invocation) => void }): BusContext
  Contexts.child(bus: BusContext, self: Instance): Context
  ```
- Rules:
  - Registered instances get `namespace = [...bus.self.namespace, bus.self.instance]`.
  - `register` builds `ctx = wrap(Contexts.child(bus, instance))` once and calls `factory.create(ctx, instance)`.
  - Delivery calls `component.onAction(scopedCtx, inv)`. `scopedCtx` passes `{ stack: [...inv.stack, inv] }` as `scope` on every `emit` and `call` to that same `ctx`.
  - `child.emit` validates the payload against its own `EventDef`, builds an `Invocation` per route target (with a fresh `id` from `crypto.randomUUID()` and `stack` taken from the scope), validates against the target's `ActionDef.input`, delivers without awaiting, and returns `ok(undefined)`.
  - When a receiver throws or rejects, `onDeliveryError` is called with code `handler`, and other receivers are not affected.

- [ ] **Step 1: Write failing tests** in `bus.test.ts`:
  - `emit delivers to every routed target`: two echo instances `a` and `b`, a route from `a.fired` to `b.log`. After `a`'s ctx emits `{text:'hi'}` and a microtask flush, `b.received[0].input` equals `{text:'hi'}` and `b.received[0].from.instance === 'a'`.
  - `emit with no route returns success and delivers nothing`.
  - `emit of unknown event or bad payload returns error code validation`: `(await ctx.emit('fired', {text:1})).type === 'error'`, and `error.code === 'validation'`.
  - `delivery payload invalid for target input is not delivered`: target consumes `{n:number}`, so the delivery is dropped and `onDeliveryError` is called with `validation`.
  - `throwing receiver does not block other receivers`: one bad and one good receiver. The good one still receives, and `onDeliveryError` is called once with `handler`.
  - `unregister stops delivery and calls dispose`.
  - `re-register after unregister delivers exactly once` (Review Focus 1): register `b`, unregister `b`, register `b` again and route it again. After one emit, `b.received.length === 1`.
  - `invocation scoped ctx extends stack`: `b`'s handler re-emits through the ctx it was given. `c` receives an invocation where `stack.length === 1` and `stack[0].from.instance === 'a'`.
- [ ] **Step 2: Run the tests and verify they fail.** Run `bun test packages/sdk/test/bus.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `bus.ts` according to the Interfaces block.**
- [ ] **Step 4: Run the tests and verify they pass.**
- [ ] **Step 5: Commit** with `git commit -am "feat(sdk): bus and child contexts with routed emit"`

---

### Task 3: `call`, environment tree and loop guard

**Files:**
- Modify: `packages/sdk/src/contexts/bus.ts`
- Test: `packages/sdk/test/call.test.ts`

**Interfaces:**
- Consumes `BusContext` and `Contexts.child` from Task 2.
- Produces these behaviours:
  - `child.call(target, action, input, scope?)` validates `input` against the target's `ActionDef.input`. It awaits `onAction` and returns its `Result`. If `output` is declared, `ok` data is validated against it.
  - A target in the bus's own namespace that isn't registered returns `fail('unknown-target')`.
  - A target outside the bus's namespace is forwarded to `opts.parent.call(...)` with the same scope. Without a parent, the result is `unknown-target`.
  - A target deeper than the bus (its namespace extends `[...self.namespace, self.instance, X]`) is delivered to registered instance `X` as an `Invocation` with the full `target`. That instance (a host) forwards it.
  - In every `emit` and `call`, `scope.stack.length >= maxDepth` gives `fail('loop')`.
  - `capabilities().environment` is `{ type:'node', instance: bus.self, children }`. Each child is `component.environment?.() ?? { type:'leaf', instance }`.
  - The bus's own `capabilities().events` and `.actions` are `{type:'all'}`. Policy wrappers narrow them in Task 4.

- [ ] **Step 1: Write failing tests:**
  - `call returns target result`: the echo fixture's `log` action returns `ok(input)`, so `call(bRef,'log',{x:1})` is `{type:'success',data:{x:1}}`.
  - `call to unknown target returns unknown-target and never throws` (Review Focus 4).
  - `call with invalid input returns validation`.
  - `call to unknown action returns unknown-action`.
  - `route cycle ends in loop error` (Review Focus 2): routes `a.fired→b.log` and `b.fired→a.log`, with both handlers re-emitting `fired` through the scoped ctx. `onDeliveryError` is eventually called with code `loop`, the depth stays at or below 16, and the test finishes within 1 s.
  - `environment lists registered instances as leaves`.
- [ ] **Step 2: Run the tests and verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `bun test packages/sdk` and verify everything passes.**
- [ ] **Step 5: Commit** with `git commit -am "feat(sdk): call, environment tree, loop guard"`

---

### Task 4: Policy and filter contexts

**Files:**
- Create: `packages/sdk/src/contexts/policy.ts`, `packages/sdk/src/contexts/filter.ts`
- Test: `packages/sdk/test/policy.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type PolicyStore = { events: Policy<EventRef>; actions: Policy<ActionRef> }   // shared, mutable
  interface PolicyContext extends Context { setPolicy(next: Partial<PolicyStore>): void }
  Contexts.policy(inner: Context, store: PolicyStore, self: InstanceRef): PolicyContext
  type Predicate = (m: { kind: 'emit'; event: string; payload: unknown } | { kind: 'call'; target: InstanceRef; action: string; input: unknown }) => boolean
  interface FilterContext extends Context { addPredicate(p: Predicate): void; removePredicate(p: Predicate): void }
  Contexts.filter(inner: Context, pred?: Predicate): FilterContext
  ```
- Rules:
  - The policy checks `emit` against `{instance: self, event}` and `call` against `{instance: target, action}`, using `allows` with structural equality. A denied message returns `notAllowed(...)` without reaching `inner`.
  - `setPolicy` mutates the shared `store`, so every `PolicyContext` built on that store sees the change.
  - `capabilities()` returns the inner capabilities with `events`/`actions` replaced by the store's values.
  - The filter returns `notAllowed('filtered')` when any predicate is false.
  - Both pass `scope` through unchanged.

- [ ] **Step 1: Write failing tests:**
  - `denied emit returns not-allowed and is not delivered`.
  - `setPolicy on shared store affects all wrapped instances`: two instances are wrapped with the same store. Denying `a.fired` blocks `a` but not `b`, and switching back to `{type:'all'}` re-enables `a`.
  - `denied call returns not-allowed`.
  - `capabilities reflects store`.
  - `filter predicate add/remove toggles delivery`.
- [ ] **Step 2: Run the tests and verify they fail.** Step 3: Implement. Step 4: Run and verify they pass.
- [ ] **Step 5: Commit** with `git commit -am "feat(sdk): policy and filter contexts"`

---

### Task 5: Debounce, trace and environment views

**Files:**
- Create: `packages/sdk/src/contexts/debounce.ts`, `trace.ts`, `env.ts`
- Test: `packages/sdk/test/wrappers.test.ts`

**Interfaces:**
- Produces:
  ```ts
  Contexts.debounce(inner: Context, ms: number): Context   // trailing debounce per event name for emit; call passes through
  type TraceEntry = { kind: 'emit' | 'call'; at: number; args: unknown[]; result: Result }
  Contexts.trace(inner: Context, sink: (e: TraceEntry) => void): Context
  Contexts.expose(inner: Context): Context                                     // identity view
  Contexts.elide(inner: Context, hide: (i: Instance) => boolean): Context      // hides matching subtrees; call to hidden target → notAllowed('elided')
  Contexts.mapEnv(inner: Context, fn: (e: Environment) => Environment): Context
  ```
- Rule: a debounced `emit` resolves immediately with `ok(undefined)`. Only the last payload in each `ms` window is forwarded.

- [ ] **Step 1: Write failing tests:**
  - `debounce forwards only last emit within window`: three emits 10 ms apart with `ms=50`. After 120 ms, the receiver has exactly 1 delivery, carrying the third payload.
  - `trace records emit and call with results`.
  - `elide hides subtree from environment and blocks calls to it` (Review Focus 4): the result `type` is `not-allowed`.
  - `mapEnv transforms environment`.
- [ ] **Step 2: Run the tests and verify they fail.** Step 3: Implement. Step 4: Run and verify they pass.
- [ ] **Step 5: Commit** with `git commit -am "feat(sdk): debounce, trace, environment views"`

---

### Task 6: Iframe bridge

**Files:**
- Create: `packages/sdk/src/bridge.ts` (attached to `Contexts` as `iframeParent`/`iframeChild`)
- Test: `packages/sdk/test/bridge.test.ts`
- Create: `packages/sdk/test/fake-windows.ts`, a pair of `EventTarget`s with `postMessage(data, targetOrigin, transfer)`. Each dispatches an `Event` carrying `data`, `origin`, `source` and `ports`, and drops the message if `targetOrigin` doesn't match.

**Interfaces:**
- Produces:
  ```ts
  type WindowLike = { postMessage(data: unknown, targetOrigin: string, transfer?: Transferable[]): void }
  type Listener = { addEventListener(t: 'message', h: (e: MessageEvent) => void): void; removeEventListener(t: 'message', h: (e: MessageEvent) => void): void }
  interface BridgeContext extends Context { readonly ready: Promise<Result<Instance>>; dispose(): Promise<void> }
  Contexts.iframeParent(bus: BusContext, opts: { self: Listener; child: WindowLike; origin: string; expected: ComponentId; instance: string; timeoutMs?: number /* 5000 */ }): BridgeContext
  Contexts.iframeChild(factory: ComponentFactory, opts: { self: Listener; parent: WindowLike; parentOrigin: string; timeoutMs?: number }): Promise<Result<{ ctx: Context; component: Component }>>
  const PROTOCOL = 'composable/1'
  ```
- Protocol:
  1. The child posts `{ proto, kind:'hello', manifest }` to its parent, addressed to `parentOrigin`.
  2. The parent accepts it only when `e.origin === origin`, `e.source === child`, `proto` matches, the manifest passes `Value.Check(Manifest, …)`, and the `ComponentId` matches `expected`.
  3. On acceptance, the parent registers a proxy instance on `bus`. The proxy's `onAction` forwards over the port. The parent then posts `{ proto, kind:'welcome', self: Instance, capabilities }` with a `MessageChannel` port.
  4. Over the port, messages are `{kind:'req', rid, op:'emit'|'call'|'onAction', args}` and `{kind:'res', rid, result}`.
  5. Every request times out after `timeoutMs` and returns `fail('timeout')`.
  6. The parent re-validates the child's `emit`/`call` args against the manifest before passing them to `bus`. Malformed port messages are ignored and reported through `bus` `onDeliveryError` with code `bridge`.
  7. In the child, `capabilities()` returns the cached `welcome` value.
  8. `dispose` (on either side) unregisters the proxy and closes the port.

- [ ] **Step 1: Write failing tests:**
  - `emit from iframe child reaches parent-routed receiver with child as from`.
  - `parent routed delivery reaches child component onAction with stack intact`.
  - `call round-trips both directions`.
  - `hello from wrong origin is ignored; ready times out with timeout` (Review Focus 3).
  - `wrong protocol version or mismatched ComponentId rejected`: `ready` resolves to `type:'error'`, code `bridge`.
  - `child payload failing schema rejected at parent before delivery` (Review Focus 5).
  - `malformed port message ignored, bridge keeps working`.
  - `dispose unregisters proxy`: a later route delivery reaches nothing.
- [ ] **Step 2: Run the tests and verify they fail.** Step 3: Implement. Step 4: Run and verify they pass.
- [ ] **Step 5: Commit** with `git commit -am "feat(sdk): iframe bridge contexts"`

---

### Task 7: `Host.define`

**Files:**
- Create: `packages/sdk/src/host.ts` (exports `Host`)
- Test: `packages/sdk/test/host.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type HostSpec = {
    id: ComponentId; version: string
    children: { factory: ComponentFactory; instance: string; wrap?: (c: Context) => Context }[]
    routes: { from: { instance: string; event: string }; to: { instance: string; action: string } }[]   // child-local names; resolved to refs
    exposes: { from: { instance: string; event: string }; as: string }[]
  }
  Host.define(spec: HostSpec): ComponentFactory  // manifest.emits = exposes, with the child's EventDef schema copied
  ```
- Rules:
  - `create(ctx, self)` builds an inner `Contexts.bus({ self, parent: ctx })` and registers the children and routes.
  - For each `exposes` entry, an internal boundary instance consumes the child event and calls `ctx.emit(as, input, { stack: [...inv.stack, inv] })`.
  - `onAction` with an `inv.target` deeper than `self` forwards into the inner bus. Otherwise it returns `fail('unknown-action')`.
  - `environment()` returns the inner bus's node with `instance: self`.
  - `mount(el)` creates one `<div>` per child that has a `mount` and mounts the child into it.
  - `dispose` disposes every child.

- [ ] **Step 1: Write failing tests:**
  - `exposed child event reaches outer receiver with original sender at stack[0]`: the outer echo receives `inv.from.instance === 'pair'` and `inv.stack[0].from.namespace` equals `['root','pair']`, with `instance 'fire-1'`.
  - `outer policy on host event blocks nested child's events`.
  - `nested child can call an outer instance (transparent)`: a nested echo calls the outer echo `b` (`{namespace:['root'], instance:'b'}`) via its ctx and gets `ok`.
  - `outer instance can call nested child by full ref`.
  - `environment shows host as node with child leaves`.
  - `dispose disposes all children`.
- [ ] **Step 2: Run the tests and verify they fail.** Step 3: Implement. Step 4: Run and verify they pass.
- [ ] **Step 5: Commit** with `git commit -am "feat(sdk): Host.define with transparent nesting"`

---

### Task 8: Lit helper and component template

**Files:**
- Create: `packages/sdk/src/lit.ts`, exporting `defineOnce(tag: string, ctor: CustomElementConstructor): void`, which is a no-op if the tag is already defined.
- Create: `templates/component-template/package.json` (name `@composable/component-template`, depends on `@composable/sdk: workspace:*`, `lit`; exports `.` → `src/fire-event.ts`)
- Create: `templates/component-template/src/fire-event.ts`, exporting `fireEvent: ComponentFactory` (id `{author:'demo', id:'fire-event'}`, emits `fired` with `{ text: string }` and a description and examples, consumes `setText`, `{ text: string }`)
- Create: `templates/component-template/src/standalone.ts`, `src/embed.ts`, `index.html`, `embed.html`, `build.ts`, `README.md` (how to clone and rename: change `ComponentId`, the tag and the package name)
- Test: `templates/component-template/test/fire-event.test.ts`

**Interfaces:**
- Consumes `Contexts.bus`, `Contexts.iframeChild` and `defineOnce`.
- `<fire-event-el>` renders an input and a button. A click calls `ctx.emit('fired', { text })` and shows the last `Result` type next to the button. `setText` sets the input's value.
- `standalone.ts`: a local root bus, a `fireEvent` instance, and a `logger` instance whose `log` action appends to a `<pre>`, with a route between them. It runs without a parent window.
- `embed.ts`: `Contexts.iframeChild(fireEvent, { self: window, parent: window.parent, parentOrigin: new URLSearchParams(location.search).get('parent')! })`. On failure, it renders a visible error and does nothing else.
- `build.ts`: `Bun.build({ entrypoints: [standalone, embed], target: 'browser', outdir: 'dist', splitting: false })` and copies the HTML. The output has no bare imports.

- [ ] **Step 1: Write the failing test** `fire-event manifest validates and setText returns ok`. It checks `Value.Check(Manifest, fireEvent.manifest)`, and that `onAction` for `setText` returns `success` (no DOM is needed when `mount` isn't called).
- [ ] **Step 2: Run the test and verify it fails.** Step 3: Implement. Step 4: Run and verify it passes.
- [ ] **Step 5: Verify the build has no bare imports.** Run `cd templates/component-template && bun run build.ts && ! grep -E "from ['\"](lit|@composable|typebox)" dist/*.js`. Expected: exit code 0.
- [ ] **Step 6: Commit** with `git add -A && git commit -m "feat(template): fire-event component and harness"`

---

### Task 9: Demo host app and `make ui`

**Files:**
- Create: `apps/host/package.json` (depends on `@composable/sdk`, `@composable/component-template`, `lit`)
- Create: `apps/host/src/pair-host.ts`, which exports `pairHost(id = 'pair-host')`. It returns `Host.define` with children `fire-1` and `fire-2` (both `fireEvent`), no internal routes, and exposes both children's `fired` as `fired`.
- Create: `apps/host/src/remote-pair-host.ts`: `export default pairHost()`. This is the runtime module served from origin B.
- Create: `apps/host/src/event-table.ts`: the `eventTable` factory (`{author:'demo', id:'event-table'}`, consumes `log` with `Type.Unknown()`). It renders a table with these columns: origin ID (`stack[0]?.id ?? inv.id`), time, event action, original sender (`stack[0]?.from ?? from`), path (`[...stack, inv].map(s => s.from.instance).join(' › ')`, display only) and payload JSON. It also has a clear button.
- Create: `apps/host/src/table-embed.ts`, `table.html` (origin B, the iframe child using `parent` from a query parameter)
- Create: `apps/host/src/main.ts`, `index.html` (origin A)
- Create: `apps/host/serve.ts`, which builds both bundles with `Bun.build`. It serves `dist-a` on port 5173 and `dist-b` on port 5174. Responses on B include `Access-Control-Allow-Origin: http://localhost:5173`.
- Modify: `Makefile` to add `ui: install` → `bun apps/host/serve.ts`

**Interfaces:**
- `main.ts` sets up the following:
  1. Root bus: `Contexts.bus({ self: { namespace: [], instance: 'root', manifest: rootManifest } })` and a shared `PolicyStore` set to `{events:{type:'all'}, actions:{type:'all'}}`.
  2. It registers `pair-1` (the build-time `pairHost()`), with `wrap = c => Contexts.policy(c, store, ref)`.
  3. It creates the iframe `http://localhost:5174/table.html?parent=http://localhost:5173` and `Contexts.iframeParent(bus, { self: window, child: iframe.contentWindow, origin: 'http://localhost:5174', expected: {author:'demo', id:'event-table'}, instance: 'table' })`. Once `ready`, it routes `pair-1.fired → table.log`.
  4. The **Add host** button runs `await import('http://localhost:5174/pair-host.js')`, registers `pair-N` with a policy wrap, and routes it to the table. On failure, the error shows in that panel only.
  5. The **Policy panel** has one checkbox per registered `pair-*`. Toggling it calls `setPolicy({events: {type:'deny', values: [unchecked EventRefs]}})`, or `{type:'all'}` when every box is checked.
  6. Each panel header shows the delivery mode (`build-time`/`runtime`/`iframe`) and the status (`connected`/`loading`/`error: …`).

- [ ] **Step 1: Run `make test`.** Expected: every SDK and template test passes.
- [ ] **Step 2: Implement the files above.**
- [ ] **Step 3: Run `make ui`.** Expected: the console prints both URLs, and `curl -sI http://localhost:5174/pair-host.js` shows `Access-Control-Allow-Origin: http://localhost:5173`.
- [ ] **Step 4: Check it by eye at http://localhost:5173.** Each of the following must hold:
  - Typing and clicking in each of `pair-1`'s two fire-events adds exactly one row to the iframe table. The original sender is `fire-1` or `fire-2`, and the path is `fire-1 › pair-1` (or the equivalent).
  - After clicking **Add host**, the new `pair-2` buttons also add rows, each exactly once.
  - Unchecking `pair-1` in the policy panel stops its rows from appearing, and re-checking it resumes them.
  - If you stop origin B and reload, the table panel shows an error after 5 s while `pair-1` still renders.
- [ ] **Step 5: Commit** with `git add -A && git commit -m "feat(host): demo app with build-time, runtime and iframe components"`
