# Puzzle Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the puzzle prototype on the `@composable` SDK as an isolated System of small components, usable bundled (`<puzzle-editor>`) or piece by piece, and linkable to a real System with no glue, after first making subscriptions first-class System data.

**Architecture:** SDK first: subscriptions become data with `subscription-opened` / `subscription-closed` deltas, the runtime returns `Result`s, `Systems.restrict` limits a holder to itself. Then `packages/puzzle-editor`: a pure model (types with stable ids → TypeBox schemas and SAIDs, looks, draft components, the board model moved from `connection-designer`, TypeScript print/parse), four `define`d components inside one composite, and Lit views ported from the prototype.

**Tech Stack:** TypeScript (strict), Bun (`bun test`, `bun build`), TypeBox 1.x (`typebox`), Lit 3, happy-dom for DOM tests.

**Spec:** `docs/superpowers/specs/2026-11-08-puzzle-editor-design.md`

## Global Constraints

- Prefer `Result`s over throwing in the runtime (`register`, `subscribe`, `unsubscribe`, `bind`, `unbind`); throwing stays only at build/definition time (`define`, `compose`, `lift`).
- No new SDK concepts beyond subscriptions as data, `Systems.restrict` and the orchestrator's `set-intents` op.
- Editor components never hold a `SystemRuntime`; everything arrives and leaves through ops.
- Draft components and types are saved in the `EditorDoc`; live ones are never saved (they come from the System).
- Board joins are horizontal only (input left, output right).
- Look patterns: `'none' | 'diagonal' | 'anti-diagonal' | 'vertical' | 'horizontal' | 'dots'`; swatches are the prototype's `SWATCHES`.
- Views use the `--c-*` theme tokens (`t.*` from `@composable/ui`), not hard-coded colours, except type looks.
- Every package keeps `bun test` green and `npx tsc -p .` (repo root) clean at each commit.
- Run commands from the repo root unless a step says otherwise; tests per package: `cd packages/<pkg> && bun test`.

## Review Focus

1. **Unregistering an instance with subscriptions** (as listener and as source): every one of them closes in one `subscription-closed` delta and disappears from `snapshot().subscriptions`. Test: Task 1.
2. **A type edited while other records and draft ops reference it** (rename, field change): references follow by id; derived SAIDs of every dependent record change; a custom look on the edited type survives. Test: Task 5.
3. **Loading an `EditorDoc` that references unknown type ids, or a malformed one**: `load` returns `fail('validation', …)` naming the first problem and leaves state unchanged. Test: Task 9.
4. **Live off while links exist**: switching Live off notifies `intents-updated` with `[]`, and a linked orchestrator removes every subscription it made. Test: Task 10.
5. **TypeScript code view with a typo** (unknown type, missing brace): parse returns line-numbered errors and changes nothing. Test: Task 7.

---

### Task 1: Subscriptions as System data

**Files:**
- Modify: `packages/sdk/src/types.ts` (add `Subscription`, extend `System`, `SystemDelta`)
- Modify: `packages/sdk/src/system.ts` (record subscriptions; `subscribe` / `unsubscribe` replace `connect` / `links`; deltas)
- Modify: `packages/sdk/src/handle.ts` (handle subscriptions are recorded with `listener = self`, no `target`)
- Modify: `packages/sdk/src/components.ts:181` (composite routes use `inner.subscribe`)
- Modify: `packages/sdk/src/index.ts` (export `Subscription`; drop `Link`)
- Test: `packages/sdk/test/system.test.ts`

**Interfaces:**
- Produces:
  - `type Subscription = { id: string; source: InstanceId | '*'; op: string; listener: InstanceId; target?: string }` (in `types.ts`)
  - `type System = { id: string; manifest: Manifest[]; instances: Instance[]; subscriptions: Subscription[] }`
  - `SystemDelta` adds `{ type: 'subscription-opened'; subscriptions: Subscription[] } | { type: 'subscription-closed'; subscriptions: Subscription[] }`
  - `SystemRuntime.subscribe(s: { source: InstanceId | '*'; op: string; listener: InstanceId; target: string }): Result<Subscription>` (a link: the listener's `target` op is called with the output)
  - `SystemRuntime.unsubscribe(id: string): Result<void>` (`fail('unknown-target')` if no such id)
  - `SystemRuntime.connect` and `SystemRuntime.links` and type `Link` are removed.
  - Subscription ids: `` `${systemId}:s${n}` `` with a per-System counter.

- [ ] **Step 1: Write the failing tests** in `packages/sdk/test/system.test.ts` (replace the `connect:` test; keep its assertions about `via`, outcomes as sources and correlation, rewritten onto `subscribe`):

```ts
test('subscriptions are data: both kinds listed, opened and closed as deltas for everyone', async () => {
  const { s, page } = setup({ id: 's1' })
  const a = x(), b = x(), watcher = x()
  s.register('a', a); s.register('b', b); s.register('w', watcher)
  const r = s.subscribe({ source: 'a', op: fired.name, listener: 'b', target: log.name })
  expect(r).toEqual(ok({ id: 's1:s1', source: 'a', op: fired.name, listener: 'b', target: log.name }))
  const off = page.subscribe(fired, () => {}, { from: 'a' })
  expect(s.snapshot().subscriptions.map(x => [x.listener, x.target])).toEqual([['b', log.name], ['page', undefined]])
  expect(watcher.deltas).toContain(`subscription-opened:b`)   // describe() prints listeners for subscription deltas
  off()
  expect(watcher.deltas.at(-1)).toBe('subscription-closed:page')
  await a.notify(fired, { text: 'hi' }); await flush()
  expect(b.got.map(g => g.input)).toEqual([{ text: 'hi' }])
  expect(s.unsubscribe('s1:s1')).toEqual(ok(undefined))
  expect(s.unsubscribe('nope').type).toBe('error')
})

test('unregistering an instance closes all its subscriptions, as listener and as source, in one delta', () => {
  const { s } = setup({ id: 's1' })
  const a = x(), b = x(), c = x(), watcher = x()
  s.register('a', a); s.register('b', b); s.register('c', c); s.register('w', watcher)
  s.subscribe({ source: 'a', op: fired.name, listener: 'b', target: log.name })
  s.subscribe({ source: 'b', op: fired.name, listener: 'c', target: log.name })
  s.subscribe({ source: '*', op: fired.name, listener: 'c', target: log.name })
  s.unregister('b')
  expect(watcher.deltas.filter(d => d.startsWith('subscription-closed'))).toEqual(['subscription-closed:b,c'])
  expect(s.snapshot().subscriptions.map(x => `${x.source}->${x.listener}`)).toEqual(['*->c'])
})

test('subscribe validates: unknown instances or ops that do not fit are errors, not throws', () => {
  const { s } = setup()
  s.register('a', x()); s.register('b', x())
  expect(s.subscribe({ source: 'a', op: fired.name, listener: 'nope', target: log.name }).type).toBe('error')
  expect(s.subscribe({ source: 'a', op: log.name + 'x', listener: 'b', target: log.name }).type).toBe('error')
  expect(s.subscribe({ source: 'a', op: fired.name, listener: 'b', target: fired.name }).type).toBe('error')
})
```

Update the test file's `describe(d)` helper to print subscription deltas as `` `${d.type}:${d.subscriptions.map(s => s.listener).join(',')}` ``.

- [ ] **Step 2: Run to see them fail**

Run: `cd packages/sdk && bun test test/system.test.ts`
Expected: FAIL (`s.subscribe is not a function` / `snapshot().subscriptions` undefined)

- [ ] **Step 3: Implement** in `system.ts`: one `Map<string, { sub: Subscription; entry: Sub }>` holds every subscription (internal delivery record plus its data). `handle.subscribe` (via `Core.subscribe`) records `{ source: from ?? '*', op, listener: self }` and sends `subscription-opened`; its returned function unsubscribes. `subscribe(...)` validates with `routeProblem` (ops resolved by name from the manifests; `source: '*'` checks only the listener side), records `target`, and calls the target op as `connect` does today (`via`, correlation). `unregister` collects every subscription whose `listener` or `source` is the instance into one `subscription-closed` before `removed`. `snapshot()` includes `subscriptions`. The composite (`components.ts`) uses `inner.subscribe({ source: f.child, op: f.op.name, listener: t.child, target: t.op.name })`.

- [ ] **Step 4: Run the SDK suite**

Run: `cd packages/sdk && bun test`
Expected: PASS (all files; fix `components.test.ts` / `system-component.test.ts` call sites only where they used `connect`/`links`)

- [ ] **Step 5: Commit**

```bash
git add packages/sdk && git commit -m "feat(sdk): subscriptions as System data with opened/closed deltas"
```

---

### Task 2: Rich results from the runtime, and `Systems.restrict`

**Files:**
- Modify: `packages/sdk/src/system.ts` (`register`, `unregister`, `bind`, `unbind` return `Result`s; add `restrict`)
- Modify: `packages/sdk/src/types.ts` (add `unwrap`)
- Modify: `packages/sdk/src/index.ts` (`Systems.restrict`, export `unwrap`)
- Modify callers: `packages/sdk/src/components.ts`, `packages/sdk/src/system-component.ts`, `packages/ui/src/index.ts`, `packages/widgets/src/main.ts`, `packages/connections/src/index.ts`, `packages/connection-designer/src/designer.ts`, and every test using `register(...)` as a handle
- Test: `packages/sdk/test/system.test.ts`

**Interfaces:**
- Produces:
  - `SystemRuntime.register(id, component, opts?): Result<SystemInstance>` (`fail('validation', 'already has an instance …')` on a duplicate)
  - `SystemRuntime.unregister(id): Result<void>` (`fail('unknown-target')` if absent)
  - `SystemRuntime.bind(from, dependency, to, op: string): Result<Binding>` (op by name now) and `SystemRuntime.unbind(from, dependency): Result<void>`
  - `unwrap<T>(r: Result<T>): T` in `types.ts`: returns data or throws `Error(message)`, for hosts and tests where failure is a bug.
  - `Systems.restrict(system: SystemRuntime, as: InstanceId): SystemRuntime`

- [ ] **Step 1: Write the failing tests**

```ts
test('the runtime answers with results, not exceptions', () => {
  const { s } = setup()
  expect(s.register('page', x()).type).toBe('error')                       // duplicate
  expect(s.unregister('nope').type).toBe('error')
  expect(s.bind('page', 'nope', 'page', 'x').type).toBe('error')
  expect(s.unbind('page', 'nope').type).toBe('error')
})

test('Systems.restrict: a holder may only act for itself', () => {
  const { s } = setup()
  s.register('a', x()); s.register('b', x()); s.register('c', x())
  const asB = Systems.restrict(s, 'b')
  expect(asB.subscribe({ source: 'a', op: fired.name, listener: 'b', target: log.name }).type).toBe('success')
  expect(asB.subscribe({ source: 'a', op: fired.name, listener: 'c', target: log.name })).toEqual({ type: 'not-allowed', reason: 'b may only act for itself' })
  const theirs = unwrap(s.subscribe({ source: 'a', op: fired.name, listener: 'c', target: log.name }))
  expect(asB.unsubscribe(theirs.id).type).toBe('not-allowed')
  expect(asB.register('d', x()).type).toBe('not-allowed')
  expect(asB.component('a')).toBeUndefined()
  expect(asB.snapshot().instances.length).toBe(s.snapshot().instances.length)   // reading is allowed
})
```

The test file's `setup()` becomes `page: unwrap(s.register('page', Components.party()))`; apply `unwrap` the same way at every `register` call site that used the handle.

- [ ] **Step 2: Run to see them fail**

Run: `cd packages/sdk && bun test test/system.test.ts`
Expected: FAIL (results are not returned; `Systems.restrict` undefined)

- [ ] **Step 3: Implement** the result returns and `restrict` (a wrapper object over `system` that checks `listener === as` for `subscribe`, the stored subscription's `listener === as` for `unsubscribe`, `from === as` for `bind`/`unbind`, `id === as` for `register`/`unregister`, returns `undefined` from `component(id)` for `id !== as`, and passes reads through). `not-allowed` reason: `` `${as} may only act for itself` ``. Update every caller listed under Files.

- [ ] **Step 4: Run every package**

Run: `for p in sdk ui widgets connections connection-designer ui-workspace; do (cd packages/$p && bun test) || break; done && npx tsc -p .`
Expected: all PASS, tsc silent

- [ ] **Step 5: Commit**

```bash
git add packages && git commit -m "feat(sdk): runtime results instead of throws; Systems.restrict"
```

---

### Task 3: The System component speaks subscriptions

**Files:**
- Modify: `packages/sdk/src/system-component.ts`
- Test: `packages/sdk/test/system-component.test.ts`

**Interfaces:**
- Consumes: `SystemRuntime.subscribe/unsubscribe/bind/unbind` (Tasks 1 and 2).
- Produces: `SystemOps` gains `subscribe` (action: `{ source, op, listener, target }` → `Subscription`), `unsubscribe` (sink: `{ id }`), `subscriptions` (action: `null` → `Subscription[]`), `subscriptionsChanged` (source `'subscriptions-changed'`: `Subscription[]`); `connect`, `disconnect`, `links`, `linksChanged` are removed. `bind`'s input becomes `{ from, dependency, to, op }` with `op` a name (unchanged shape).

- [ ] **Step 1: Write the failing test** (replace the connect/links test):

```ts
test('subscribe, unsubscribe and subscriptions by op, announced on every change (whoever made it)', async () => {
  const { rt, page } = world()
  const n = numbers.create(); rt.register('numbers', n); rt.register('keeper', keeper().create() as never)
  const seen: number[] = []
  page.subscribe(sys.subscriptionsChanged, l => { seen.push(l.filter(x => x.target).length) }, { from: 'system' })
  const made = unwrap(await page.call('system', sys.subscribe, { source: 'numbers', op: emitted.name, listener: 'keeper', target: keep.name }))
  rt.register('k2', keeper().create() as never)
  unwrap(rt.subscribe({ source: 'numbers', op: emitted.name, listener: 'k2', target: keep.name }))   // on the runtime directly
  await page.call('system', sys.unsubscribe, { id: made.id })
  expect(seen).toEqual([1, 2, 1])   // made through the op, made on the runtime, then removed: all announced
})
```

- [ ] **Step 2: Run it to fail**

Run: `cd packages/sdk && bun test test/system-component.test.ts`
Expected: FAIL (`sys.subscribe` undefined)

- [ ] **Step 3: Implement**: the component announces `subscriptions-changed` from `runtime.updates` on `subscription-opened` / `subscription-closed` deltas (and `changed` on `added`/`removed`); drop the `onAction` wrapper that announced links.

- [ ] **Step 4: Run the SDK suite**

Run: `cd packages/sdk && bun test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/sdk && git commit -m "feat(sdk): System component ops for subscriptions"
```

---

### Task 4: `pipe` in `compose`

> **Dropped (user, 2026-11-08):** implemented then reverted (87f35fd, 96a91aa → fd6e247, c3996d9). Pipe belongs in its own package, built on the SDK; see the spec's Follow-ons.

**Files:**
- Modify: `packages/sdk/src/components.ts` (`Builder.pipe`)
- Test: `packages/sdk/test/components.test.ts`

**Interfaces:**
- Produces: `Builder.pipe(name: string, description: string, steps: Bound[]): Op` — declares an op `` `${meta.id.author}/${meta.id.id}/${name}` `` on the composite with `input` = first step's op input and `output` = last step's op output (absent if the last is a sink).

- [ ] **Step 1: Write the failing tests**

```ts
test('pipe exposes a chain as one action: A → B → C, failing fast, same correlation', async () => {
  const s = Systems.create(), page = unwrap(s.register('page', Components.party()))
  const D = Components.declare({ author: 't', id: 'double' })
  const dbl = D.op('double', 'n * 2', { input: Type.Number(), output: Type.Number() })
  const double = D.define({ state: () => null, handlers: [[dbl, n => n > 100 ? fail('handler', 'too big') : ok(n * 2)]] })
  const P = Components.declare({ author: 't', id: 'print' })
  const show = P.op('show', 'n → text', { input: Type.Number(), output: Type.String() })
  const print = P.define({ state: () => null, handlers: [[show, n => ok(`= ${n}`)]] })
  let quad!: Op
  const box = Components.compose(meta('box'), c => {
    const a = c.use('a', double), b = c.use('b', double), p = c.use('p', print)
    quad = c.pipe('quad', 'n * 4, as text', [a(dbl), b(dbl), p(show)])
    return {}
  })
  expect(box.manifest.ops.find(o => o.name === 't/box/quad')).toMatchObject({ input: Type.Number(), output: Type.String() })
  await add(s, 'box', box)
  expect(await page.call('box', quad as Op<TSchema>, 5)).toEqual(ok('= 20'))
  const r = await page.call('box', quad as Op<TSchema>, 60)          // second step fails: 120 > 100
  expect(r.type === 'error' && r.error.code).toBe('handler')
})

test('pipe is checked at build time', () => {
  expect(() => Components.compose(meta('c'), c => { const s = c.use('s', speaker); const l = c.use('l', listener()); c.pipe('p', 'p', [l(hear), s(say)]); return {} }))
    .toThrow('pipe p: step 0 (l t/listener/hear) gives no output')
  expect(() => Components.compose(meta('c'), c => { const l = c.use('l', listener()); c.pipe('p', 'p', [l(add2), l(hear)]); return {} }))
    .toThrow('pipe p: step 0 output does not fit step 1 input')
})
```

- [ ] **Step 2: Run to fail**

Run: `cd packages/sdk && bun test test/components.test.ts`
Expected: FAIL (`c.pipe is not a function`)

- [ ] **Step 3: Implement**: build-time checks use `typeHash` equality (or a `{}`-schema input); the op is added to the composite manifest; `onAction` for a pipe op calls each step through the composite's `..` handle `within(inv.correlation)`, feeding `r.data` forward, returning the first non-success.

- [ ] **Step 4: Run the SDK suite**

Run: `cd packages/sdk && bun test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/sdk && git commit -m "feat(sdk): compose pipe - a chain exposed as one action"
```

---

### Task 5: Editor types and looks (pure)

**Files:**
- Create: `packages/puzzle-editor/package.json` (name `@composable/puzzle-editor`; exports `.` → `./src/index.ts`, `./model` → `./src/model/index.ts`; peers as in `connection-designer`; devDependency `@happy-dom/global-registrator` `^21.0.4`; `bunfig.toml` + `test/dom.ts` as in `packages/ui`)
- Create: `packages/puzzle-editor/src/model/types.ts`, `packages/puzzle-editor/src/model/looks.ts`
- Test: `packages/puzzle-editor/test/types.test.ts`, `packages/puzzle-editor/test/looks.test.ts`

**Interfaces:**
- Produces (`model/types.ts`):
  - `type TypeRef = { type: string; array: boolean }`
  - `type EditorType` (the spec's union: `primitive` | `record` | `brand` | `live`)
  - `builtins(): EditorType[]` — ids `'string' | 'number' | 'boolean'`
  - `schemaOf(id: string, types: EditorType[]): Result<TSchema>` — record: `Type.Object(fields, { $id: name })`; brand: target schema with `$id: name`; array field: `Type.Array(...)`; `fail('validation', 'unknown type <id>')` for a dangling reference; `fail('validation', 'brands refer to each other in a loop')` for a cycle
  - `saidOf(id, types): Result<string>` = `typeHash(schemaOf(...))`
  - edits, each `(types: EditorType[], …) => Result<EditorType[]>`: `addRecord(types, id, name)`, `addField(types, recordId, name, ref)`, `removeField(types, recordId, name)`, `addBrand(types, id, name, of)`, `rename(types, id, name)`, `remove(types, id)` (`fail('validation', '<name> is used by <names>')` while referenced), `setLook(types, id, look)`
  - `liveTypes(instances: Instance[]): EditorType[]` — every distinct named op schema (by SAID), `{ kind: 'live', id: said, schema }`
- Produces (`model/looks.ts`):
  - `type Look` (spec), `type Shape = Look['shape']`
  - `PRESETS: Record<'jigsaw'|'slim'|'dome'|'triangle'|'square'|'house'|'double'|'arrow', Shape>` and `presetShape(id)` — port from the prototype script (`PRESETS`, `presetShape`, `PRESET_ORDER`, `PRESET_LABELS`)
  - `SWATCHES: string[]` (the prototype's 12)
  - `lookOf(said: string): Look` — port `shaShape`, `shaColour`, `shaPattern` over the SAID's 32 digest bytes (base64url-decode the 43 chars after `'E'`, drop the pad byte)
  - `effectiveLook(type: EditorType, said: string): Look` — the type's `look` if set, else `lookOf(said)`
  - `movePoint`, `splitSegment` (add point), `removeAnchor` (remove point) — ported from the prototype, on `Shape`

- [ ] **Step 1: Write the failing tests**

```ts
test('a record is a named object; a brand is a named copy; arrays of either', () => {
  let t = builtins()
  t = unwrap(addRecord(t, 'addr', 'Address'))
  t = unwrap(addField(t, 'addr', 'city', { type: 'string', array: false }))
  t = unwrap(addBrand(t, 'email', 'Email', 'string'))
  t = unwrap(addField(t, 'addr', 'contacts', { type: 'email', array: true }))
  expect(unwrap(schemaOf('addr', t))).toEqual(Type.Object({ city: Type.String(), contacts: Type.Array(Type.String({ $id: 'Email' })) }, { $id: 'Address' }))
})

test('edits and renames follow by id; dependent SAIDs change; a custom look survives an edit', () => {
  let t = unwrap(addRecord(builtins(), 'addr', 'Address'))
  t = unwrap(addField(t, 'addr', 'city', { type: 'string', array: false }))
  t = unwrap(addRecord(t, 'cust', 'Customer'))
  t = unwrap(addField(t, 'cust', 'home', { type: 'addr', array: false }))
  t = unwrap(setLook(t, 'addr', { ...lookOf(unwrap(saidOf('addr', t))), colour: '#5ED6B4' }))
  const before = unwrap(saidOf('cust', t))
  t = unwrap(rename(t, 'addr', 'PostalAddress'))
  expect(unwrap(saidOf('cust', t))).not.toBe(before)                         // Customer refers to the renamed type
  expect((unwrap(schemaOf('cust', t)) as any).properties.home.$id).toBe('PostalAddress')
  expect(t.find(x => x.id === 'addr')).toMatchObject({ look: { colour: '#5ED6B4' } })
})

test('removing a used type, dangling refs and brand loops are errors, not throws', () => {
  let t = unwrap(addRecord(builtins(), 'a', 'A'))
  t = unwrap(addField(t, 'a', 'x', { type: 'string', array: false }))
  expect(remove(t, 'string')).toEqual(fail('validation', 'string is used by A'))
  expect(schemaOf('nope', t).type).toBe('error')
})

test('looks: deterministic from the SAID, distinct per type, presets and point edits keep the ends on the edge', () => {
  const said = typeHash(Type.String())
  expect(lookOf(said)).toEqual(lookOf(said))
  expect(lookOf(said)).not.toEqual(lookOf(typeHash(Type.Number())))
  expect(SWATCHES).toHaveLength(12)
  const s = splitSegment(presetShape('jigsaw'), 0)
  expect(s.segs.length).toBe(presetShape('jigsaw').segs.length + 1)
  expect(removeAnchor(s, 1).segs.length).toBe(presetShape('jigsaw').segs.length)
})
```

- [ ] **Step 2: Run to fail**

Run: `cd packages/puzzle-editor && bun install && bun test`
Expected: FAIL (modules missing)

- [ ] **Step 3: Implement** the two modules (pure; no Lit).

- [ ] **Step 4: Run**

Run: `cd packages/puzzle-editor && bun test && cd ../.. && npx tsc -p .`
Expected: PASS, tsc silent

- [ ] **Step 5: Commit**

```bash
git add packages/puzzle-editor bun.lock && git commit -m "feat(puzzle-editor): types with stable ids, derived schemas and SAIDs, looks"
```

---

### Task 6: Draft components, the board model and the document (pure)

**Files:**
- Create: `packages/puzzle-editor/src/model/components.ts`, `packages/puzzle-editor/src/model/board.ts` (moved from `packages/connection-designer/src/model.ts` with its tests), `packages/puzzle-editor/src/model/doc.ts`, `packages/puzzle-editor/src/model/index.ts`
- Test: `packages/puzzle-editor/test/components.test.ts`, `packages/puzzle-editor/test/board.test.ts` (moved from `connection-designer/test/model.test.ts`), `packages/puzzle-editor/test/doc.test.ts`

**Interfaces:**
- Consumes: Task 5 (`EditorType`, `TypeRef`, `schemaOf`).
- Produces:
  - `type DraftComponent` (spec)
  - `draftManifest(d: DraftComponent, types: EditorType[]): Result<Manifest>` (op names `` `${author}/${id}/${op}` ``; input/output from `schemaOf`, wrapped in `Type.Array` when `array`)
  - edits returning `Result<DraftComponent[]>`: `addDraft(drafts, id)`, `addOp(drafts, componentId, name)`, `removeOp(drafts, componentId, name)`, `setOpTypes(drafts, componentId, name, { input?: TypeRef; output?: TypeRef })`, `removeDraft(drafts, componentId)`
  - `componentsOf(drafts, types, instances): { manifest: Manifest; draft: boolean; implemented: boolean }[]` — live manifests from `instances` (one per component id); a draft with the same id is `implemented: true` and its live manifest is used
  - `board.ts`: everything `connection-designer/src/model.ts` exports today, unchanged names (`palette`, `partners`, `place`, `take`, `move`, `pin`, `toggle`, `addConnection`, `remove`, `board`, `workflows`, `connections`, `stepFor`, `typeInfo`, `typeName`, `joins`, `emptyDoc`, `cellsOf`), with its `Doc` renamed `Connections` and `emptyDoc` renamed `emptyConnections`
  - `doc.ts`: `type EditorDoc` (spec), `emptyEditorDoc(): EditorDoc` (built-ins only), `checkDoc(d: unknown): Result<EditorDoc>` — shape check plus every `TypeRef`/`of` resolving, naming the first problem

- [ ] **Step 1: Write the failing tests** (`board.test.ts` is the moved file with imports updated; new ones):

```ts
test('a draft component becomes a manifest from its type refs', () => {
  const t = unwrap(addField(unwrap(addRecord(builtins(), 'p', 'Person')), 'p', 'name', { type: 'string', array: false }))
  let d = unwrap(addDraft([], { author: 'me', id: 'people' }))
  d = unwrap(addOp(d, { author: 'me', id: 'people' }, 'create'))
  d = unwrap(setOpTypes(d, { author: 'me', id: 'people' }, 'create', { input: { type: 'p', array: false }, output: { type: 'p', array: false } }))
  expect(unwrap(draftManifest(d[0], t)).ops[0]).toMatchObject({ name: 'me/people/create', input: { $id: 'Person' }, output: { $id: 'Person' } })
})

test('a live component with a draft\'s id wins, and the draft is marked implemented', () => {
  const live = { id: 'p1', manifest: { id: { author: 'me', id: 'people' }, ops: [] } }
  const out = componentsOf(unwrap(addDraft([], { author: 'me', id: 'people' })), builtins(), [live])
  expect(out).toEqual([{ manifest: live.manifest, draft: true, implemented: true }])
})

test('checkDoc names the first problem and accepts a round-tripped doc', () => {
  expect(checkDoc({ types: [], components: [] }).type).toBe('error')
  const bad = { ...emptyEditorDoc(), types: [...builtins(), { id: 'r', kind: 'record', name: 'R', fields: [{ name: 'x', ref: { type: 'ghost', array: false } }] }] }
  expect(checkDoc(bad)).toEqual(fail('validation', 'R.x refers to unknown type ghost'))
  expect(checkDoc(JSON.parse(JSON.stringify(emptyEditorDoc())))).toEqual(ok(emptyEditorDoc()))
})
```

- [ ] **Step 2: Run to fail**

Run: `cd packages/puzzle-editor && bun test`
Expected: FAIL (modules missing)

- [ ] **Step 3: Implement**; `git mv` the board model and its test from `connection-designer`.

- [ ] **Step 4: Run**

Run: `cd packages/puzzle-editor && bun test && cd ../.. && npx tsc -p .`
Expected: PASS (connection-designer may temporarily import from `@composable/puzzle-editor/model` to stay green)

- [ ] **Step 5: Commit**

```bash
git add packages && git commit -m "feat(puzzle-editor): draft components, board model, EditorDoc"
```

---

### Task 7: Types as TypeScript (print and parse)

**Files:**
- Create: `packages/puzzle-editor/src/model/typescript.ts`
- Test: `packages/puzzle-editor/test/typescript.test.ts`

**Interfaces:**
- Consumes: Task 5 (`EditorType`).
- Produces:
  - `printTypes(types: EditorType[]): string` — port of the prototype's `modelToTs` (records as `type X = { field: T; list: T[] }`, brands as `type X = Y; // brand`, built-ins and live types omitted)
  - `parseTypes(source: string, current: EditorType[], newId: () => string): { ok: true; types: EditorType[] } | { ok: false; errors: string[] }` — port of `parseTs` + `planTs`: keeps ids for names that already exist, new ids for new names, errors as `Line N: …` exactly as the prototype words them

- [ ] **Step 1: Write the failing tests**

```ts
test('print and parse round-trip records, arrays and brands, keeping ids', () => {
  let t = unwrap(addRecord(builtins(), 'a', 'Address'))
  t = unwrap(addField(t, 'a', 'city', { type: 'string', array: false }))
  t = unwrap(addBrand(t, 'e', 'Email', 'string'))
  t = unwrap(addField(t, 'a', 'mail', { type: 'e', array: true }))
  const src = printTypes(t)
  expect(src).toContain('type Address = {')
  expect(src).toContain('  mail: Email[];')
  expect(src).toContain('type Email = string; // brand')
  const back = parseTypes(src, t, () => 'new')
  expect(back).toEqual({ ok: true, types: t })
})

test('a typo gives line-numbered errors and no change', () => {
  const r = parseTypes('type A = {\n  x: Strin;\n}', builtins(), () => 'n')
  expect(r).toEqual({ ok: false, errors: ['Line 2: unknown type Strin'] })
})
```

- [ ] **Step 2: Run to fail**

Run: `cd packages/puzzle-editor && bun test test/typescript.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement** by porting the three prototype functions onto `EditorType`.

- [ ] **Step 4: Run**

Run: `cd packages/puzzle-editor && bun test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/puzzle-editor && git commit -m "feat(puzzle-editor): types as TypeScript, print and parse"
```

---

### Task 8: The orchestrator takes `set-intents`

**Files:**
- Modify: `packages/connections/src/index.ts`
- Test: `packages/connections/test/connections.test.ts`

**Interfaces:**
- Consumes: `SystemRuntime.subscribe/unsubscribe` (Task 1).
- Produces: `OrchestratorOps.setIntents` — op `'composable/orchestrator/set-intents'`, input `Type.Array(Type.Unknown())`, a sink. `Orchestrators.create(system, intents, id)` registers a component with this op; calling it is the same as `set(intents)`. Links are made with `system.subscribe` and removed with `system.unsubscribe(id)`.

- [ ] **Step 1: Write the failing test**

```ts
test('the orchestrator can be driven by a link: set-intents', async () => {
  const intentsOut = { name: 't/page/intents', output: Type.Array(Type.Unknown()) }
  const scope = Systems.create(), page = unwrap(scope.register('page', Components.party({ author: 't', id: 'page' }, [intentsOut])))
  for (const [n, f] of [['crm', crm], ['map', mapper], ['tax', tax()]] as const) unwrap(scope.register(n, f.create()))
  Orchestrators.create(scope, [])
  unwrap(scope.subscribe({ source: 'page', op: intentsOut.name, listener: 'orchestrator', target: OrchestratorOps.setIntents.name }))
  await page.notify(intentsOut, [workflow]); await flush()
  expect(scope.snapshot().subscriptions.filter(s => s.listener !== 'orchestrator').map(s => `${s.source}→${s.listener}`)).toEqual(['crm→map', 'map→tax'])
  await page.notify(intentsOut, []); await flush()
  expect(scope.snapshot().subscriptions.filter(s => s.listener !== 'orchestrator')).toEqual([])
})
```

- [ ] **Step 2: Run to fail**

Run: `cd packages/connections && bun test`
Expected: FAIL (`OrchestratorOps` undefined)

- [ ] **Step 3: Implement** (and move the binder to `bind`/`Result`s if Task 2 left it on `try`).

- [ ] **Step 4: Run**

Run: `cd packages/connections && bun test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/connections && git commit -m "feat(connections): orchestrator set-intents op"
```

---

### Task 9: The editor's components and the composite

**Files:**
- Create: `packages/puzzle-editor/src/components/type-editor.ts`, `component-list.ts`, `connection-editor.ts`, `document.ts`, `puzzle-editor.ts`, `index.ts`
- Test: `packages/puzzle-editor/test/editor.test.ts`

**Interfaces:**
- Consumes: Tasks 4–8.
- Produces (all `author: 'composable'`; each child is `Components.declare({ author: 'composable', id: '<child>' })`):
  - `type-editor` ops: `set-types (EditorType[])`, `set-live-types (TSchema[])`, edit actions `add-record {id,name}`, `add-field {record,name,ref}`, `remove-field {record,name}`, `add-brand {id,name,of}`, `rename {id,name}`, `remove {id}`, `set-look {id,look}`, `set-code {source}` (uses `parseTypes`); source `types-updated ({ types: EditorType[]; derived: { id, said, schema, look }[] })`. Edit actions return the edit's `Result` (errors pass through).
  - `component-list` ops: `set-instances (Instance[])`, `set-drafts (DraftComponent[])`, `set-types` (the `types-updated` payload), edit actions `add-draft {id}`, `add-op {component,name}`, `remove-op {component,name}`, `set-op-types {component,name,input?,output?}`, `remove-draft {component}`; sources `components-updated ({ manifest, draft, implemented }[])`, `instances-updated (Instance[])`, `live-types (TSchema[])`
  - `connection-editor` ops: `set-connections (Connections)`, `set-components`, `set-instances`, `set-looks` (the `types-updated` payload), `set-live (boolean)`, edit actions `place {component, op, cell}`, `take {workflow,index}`, `move {workflow,index,cell}`, `pin {workflow,index,select}`, `toggle {id,enabled}`, `add-rule {connection}`, `remove {id}`; sources `connections-updated (Connections)`, `intents-updated (Intent[])` (only while Live; `[]` on switching off). Its model state also carries `status: Record<string, Status>` from `plan(intents, instances)`, recomputed on every change.
  - `document` ops: `load (EditorDoc)` → `Result<EditorDoc>` (runs `checkDoc`, then calls `type-editor/set-types`, `component-list/set-drafts`, `connection-editor/set-connections` through its handle; state unchanged on a failed check), sinks `types-in`, `drafts-in`, `connections-in` (fed by internal links); source `model-updated (EditorDoc)`
  - Exported op sets, keys camelCased from the op names: `TypeEditorOps` (`setTypes`, `setLiveTypes`, `addRecord`, `addField`, `removeField`, `addBrand`, `rename`, `remove`, `setLook`, `setCode`, `typesUpdated`), `ComponentListOps` (`setInstances`, `setDrafts`, `setTypes`, `addDraft`, `addOp`, `removeOp`, `setOpTypes`, `removeDraft`, `componentsUpdated`, `instancesUpdated`, `liveTypes`), `ConnectionEditorOps` (`setConnections`, `setComponents`, `setInstances`, `setLooks`, `setLive`, `place`, `take`, `move`, `pin`, `toggle`, `addRule`, `remove`, `connectionsUpdated`, `intentsUpdated`), `DocumentOps` (`load`, `modelUpdated`)
  - Model state fields the views and tests read: `type-editor` `state.types: EditorType[]`; `component-list` `state.types`, `state.drafts: DraftComponent[]`, `state.instances: Instance[]`; `connection-editor` `state.connections: Connections`, `state.components`, `state.instances`, `state.live: boolean`, `state.status: Record<string, Status>`
  - `puzzleEditor`: `Components.compose({ id: { author: 'composable', id: 'puzzle-editor' } }, …)` wiring the spec's internal links with `c.route`, exposing `document/load`, `document/model-updated`, `component-list/set-instances`, `connection-editor/intents-updated`, `connection-editor/set-live`; returns handles `{ types, list, board, document }`

- [ ] **Step 1: Write the failing tests** (a child is reached through `ed.children.<child>.systems[0]`, its handle inside the editor's System; `TypeEditorOps`, `ComponentListOps`, `ConnectionEditorOps`, `DocumentOps` are the exported op sets)

```ts
const editorIn = async () => {
  const s = Systems.create(), page = unwrap(s.register('page', Components.party()))
  const ed = await puzzleEditor.create(); unwrap(s.register('editor', ed))
  const inner = (c: keyof typeof ed.children) => ed.children[c].systems[0]
  return { s, page, ed, inner }
}

test('the editor is a System: load in, edits flow between children, model-updated out, insides hidden', async () => {
  const { page, ed, inner } = await editorIn()
  const docs: EditorDoc[] = []
  page.subscribe(DocumentOps.modelUpdated, d => { docs.push(d) }, { from: 'editor' })
  expect(page.system.instances.map(i => i.id)).toEqual(['page', 'editor'])
  expect((await page.call('editor', DocumentOps.load, emptyEditorDoc())).type).toBe('success')
  await inner('types').call('types', TypeEditorOps.addRecord, { id: 'a', name: 'Address' })
  expect(ed.children.list.state.types.map((t: EditorType) => t.id)).toContain('a')   // routed types-updated → set-types
  expect(docs.at(-1)!.types.map(t => t.id)).toContain('a')
})

test('load rejects a malformed doc and keeps state', async () => {
  const { page, ed } = await editorIn()
  await page.call('editor', DocumentOps.load, emptyEditorDoc())
  const before = JSON.stringify(ed.children.types.state.types)
  expect(await page.call('editor', DocumentOps.load, { types: [] } as never)).toMatchObject({ type: 'error', error: { code: 'validation' } })
  expect(JSON.stringify(ed.children.types.state.types)).toBe(before)
})

test('set-instances is linked once and reaches both children; status is planned locally', async () => {
  const { s, ed } = await editorIn()
  unwrap(s.register('system', Systems.component(s).create() as never))
  unwrap(s.subscribe({ source: 'system', op: Systems.ops.changed.name, listener: 'editor', target: ComponentListOps.setInstances.name }))
  for (const [n, f] of [['crm', crm], ['map', mapper], ['tax', tax]] as const) unwrap(s.register(n, f.create()))
  await flush()
  expect(ed.children.board.state.instances.map((i: Instance) => i.id)).toContain('map')
  await ed.children.board.systems[0].call('board', ConnectionEditorOps.place, { component: { author: 't', id: 'crm' }, op: updated.name, cell: { c: 0, r: 0 } })
  await ed.children.board.systems[0].call('board', ConnectionEditorOps.place, { component: { author: 't', id: 'map' }, op: toJ.name, cell: { c: 1, r: 0 } })
  await ed.children.board.systems[0].call('board', ConnectionEditorOps.place, { component: { author: 't', id: 'tax' }, op: rate.name, cell: { c: 2, r: 0 } })
  expect(Object.values(ed.children.board.state.status as Record<string, Status>)[0]).toMatchObject({ viable: true, routes: 2 })
})

test('Live gates intents-updated; switching off sends []', async () => {
  const { page, ed } = await editorIn()
  const sent: unknown[][] = []
  page.subscribe(ConnectionEditorOps.intentsUpdated, i => { sent.push(i) }, { from: 'editor' })
  const board = ed.children.board.systems[0]
  await board.call('board', ConnectionEditorOps.place, { component: { author: 't', id: 'crm' }, op: updated.name, cell: { c: 0, r: 0 } })
  expect(sent).toEqual([])
  await page.call('editor', ConnectionEditorOps.setLive, true)
  await board.call('board', ConnectionEditorOps.place, { component: { author: 't', id: 'tax' }, op: rate.name, cell: { c: 2, r: 0 } })
  expect(sent.length).toBe(2)                                      // on switching on, and after the edit
  await page.call('editor', ConnectionEditorOps.setLive, false)
  expect(sent.at(-1)).toEqual([])
})
```

The fixtures `crm`, `mapper`, `tax`, `updated`, `toJ`, `rate` are the Address → Jurisdiction components from `packages/connections/test/connections.test.ts`, copied into `test/fixtures.ts`. Switching Live on notifies the current intents once.

- [ ] **Step 2: Run to fail**

Run: `cd packages/puzzle-editor && bun test test/editor.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement** the five modules with `define` / `compose`.

- [ ] **Step 4: Run**

Run: `cd packages/puzzle-editor && bun test && cd ../.. && npx tsc -p .`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/puzzle-editor && git commit -m "feat(puzzle-editor): type-editor, component-list, connection-editor, document, composite"
```

---

### Task 10: Views — connection editor and component list

**Files:**
- Create: `packages/puzzle-editor/src/views/connection-editor.ts` (port of `packages/connection-designer/src/designer.ts`: board, palette, intents and status list, rule form, Live switch; reads its component's state, acts by calling its own ops), `packages/puzzle-editor/src/views/component-list.ts` (the prototype's Elements tab: add element, its ops, input/output type pickers; drafts marked, implemented drafts marked)
- Create: `packages/puzzle-editor/src/views/tiles.ts` (port of the prototype's `shapeSegments`, `tilePath`, `iconFor`, `presetIcon`, using `effectiveLook`)
- Test: `packages/puzzle-editor/test/views.test.ts`

**Interfaces:**
- Produces: `ConnectionEditorView`, `ComponentListView` (each `View` with `static factory` = the child's factory), `tilePath(sides, shapes): string`, `iconFor(shape): string`.

- [ ] **Step 1: Write the failing tests** (happy-dom; port the three tests of `packages/connection-designer/test/designer.test.ts` onto `<connection-editor>` placed in a provided System with the fixtures, then add):

```ts
test('switching Live off removes the links a linked orchestrator made', async () => {
  const { s, el } = await hosted('connection-editor')                // helper: System + provider + fixtures + element
  Orchestrators.create(s, [])
  const id = el.getAttribute('name')!
  unwrap(s.subscribe({ source: id, op: ConnectionEditorOps.intentsUpdated.name, listener: 'orchestrator', target: OrchestratorOps.setIntents.name }))
  await dragRow(el, ['t/crm', 't/map', 't/tax'])                      // helper: dragstart palette piece i, drop on cell (i, 0)
  clickLive(el, true); await flush()
  expect(s.snapshot().subscriptions.filter(x => x.listener !== 'orchestrator' && x.target)).toHaveLength(2)
  clickLive(el, false); await flush()
  expect(s.snapshot().subscriptions.filter(x => x.listener !== 'orchestrator' && x.target)).toHaveLength(0)
})

test('the component list adds a draft with an op and its types, marked draft', async () => {
  const { el, model } = await hosted('component-list')
  click(el, '.add-element'); type(el, '.new-element input', 'people'); click(el, '.new-element button')
  click(el, '[data-component="me/people"] .add-op'); type(el, '.new-op input', 'create'); click(el, '.new-op button')
  select(el, '[data-op="create"] .input', 'string')
  expect(model.state.drafts[0]).toMatchObject({ ops: [{ name: 'create', input: { type: 'string', array: false } }] })
  expect(el.shadowRoot!.querySelector('[data-component="me/people"]')!.classList.contains('draft')).toBe(true)
})
```

The helpers (`hosted`, `dragRow`, `clickLive`, `click`, `type`, `select`) live in `test/dom-helpers.ts`; the class names and `data-*` attributes above are the views' contract.

- [ ] **Step 2: Run to fail** — `cd packages/puzzle-editor && bun test test/views.test.ts` → FAIL
- [ ] **Step 3: Implement** the views.
- [ ] **Step 4: Run** — `cd packages/puzzle-editor && bun test` → PASS
- [ ] **Step 5: Commit** — `git add packages/puzzle-editor && git commit -m "feat(puzzle-editor): connection editor and component list views"`

---

### Task 11: Views — type editor (list, code, shape editor) and the bundled editor

**Files:**
- Create: `packages/puzzle-editor/src/views/type-editor.ts` (Types tab: List/Code toggle, "+ New record type", built-ins and live sections, record and brand rows, "Copy as brand"; the shape editor dialog: preset grid with labels, swatches, pattern buttons, draggable square points and round handles, Add point / Remove point, Mirror handles, "Used by …", Done)
- Create: `packages/puzzle-editor/src/views/puzzle-editor.ts` (`<puzzle-editor>`: the prototype's layout — left panel with Elements/Types tabs hosting `ComponentListView` / `TypeEditorView`, the board hosting `ConnectionEditorView`, status line `N placed · N connections · N problems`, Show model (the `EditorDoc` JSON), Clear all), `packages/puzzle-editor/src/views/index.ts` (`defineEditor(prefix = '')` registering `type-editor`, `component-list`, `connection-editor`, `puzzle-editor`)
- Test: `packages/puzzle-editor/test/views.test.ts`

**Interfaces:**
- Produces: `TypeEditorView`, `PuzzleEditorView`, `defineEditor(prefix?: string): void`.

- [ ] **Step 1: Write the failing tests**

```ts
test('the type editor: add a record, code view errors, shape editor presets', async () => {
  const { el, model } = await hosted('type-editor')
  click(el, '.new-record'); type(el, '.new-record-form input', 'Address'); click(el, '.new-record-form button')
  expect([...el.shadowRoot!.querySelectorAll('.type-row .name')].map(n => n.textContent)).toContain('Address')
  click(el, '.tab-code'); type(el, 'textarea.code', 'type A = {\n  x: Strin;\n}'); click(el, '.apply')
  expect(el.shadowRoot!.querySelector('.problem')!.textContent).toBe('Line 2: unknown type Strin')
  expect(model.state.types.some((t: EditorType) => t.kind === 'record' && t.name === 'A')).toBe(false)
  click(el, '.tab-list'); click(el, '[data-type="string"] .edit-shape'); click(el, '.preset[data-preset="dome"]')
  expect(model.state.types.find((t: EditorType) => t.id === 'string')).toMatchObject({ look: { shape: presetShape('dome') } })
  click(el, '.done'); expect(el.shadowRoot!.querySelector('.shape-editor')).toBeNull()
})

test('<puzzle-editor>: both tabs and the board in one System; Show model shows the document', async () => {
  const { el } = await hosted('puzzle-editor')
  expect(el.shadowRoot!.querySelector('component-list, [data-part="component-list"]')).not.toBeNull()
  click(el, '.tab-types'); expect(el.shadowRoot!.querySelector('type-editor, [data-part="type-editor"]')).not.toBeNull()
  expect(el.shadowRoot!.querySelector('.status-line')!.textContent).toBe('0 placed · 0 connections · 0 problems')
  click(el, '.show-model'); expect(JSON.parse(el.shadowRoot!.querySelector('.model pre')!.textContent!)).toMatchObject({ types: expect.any(Array) })
})
```

- [ ] **Step 2: Run to fail** — FAIL
- [ ] **Step 3: Implement**, replicating the prototype's inline style values through the theme tokens.
- [ ] **Step 4: Run** — `cd packages/puzzle-editor && bun test` → PASS
- [ ] **Step 5: Commit** — `git add packages/puzzle-editor && git commit -m "feat(puzzle-editor): type editor with shape editor; bundled puzzle-editor"`

---

### Task 12: Host it, wire it, remove the old designer

**Files:**
- Modify: `packages/ui-workspace/public/index.html` (Connections page: `<puzzle-editor name="editor">` in place of `<connection-designer>`; dock entries for `type-editor`, `component-list`, `connection-editor`, `puzzle-editor`)
- Modify: `packages/ui-workspace/src/composable.ts` (`defineEditor()`; register `Systems.component(scope)` as `system` and `Orchestrators.create(scope, [])`; `scope.subscribe` `system/changed → editor/component-list/set-instances` and `editor/connection-editor/intents-updated → orchestrator/set-intents` once the editor instance exists, via an `updates` listener)
- Modify: `packages/ui-workspace/package.json` (depend on `@composable/puzzle-editor`; drop `@composable/connection-designer`)
- Delete: `packages/connection-designer/`
- Test: a happy-dom smoke of the host page in `packages/puzzle-editor/test/host.test.ts`: load the page markup, run `composable.ts`, place slider → doubler → chart on the editor's board, switch Live on, notify the slider with 21 → chart points `[42]`

- [ ] **Step 1: Write the failing host test** (as described above; reuse the smoke approach used before: `GlobalRegistrator`, page markup from `public/index.html`, import `src/composable.ts`)
- [ ] **Step 2: Run to fail** — FAIL
- [ ] **Step 3: Implement** the wiring and delete `connection-designer`.
- [ ] **Step 4: Run everything**

Run: `for p in sdk ui widgets connections puzzle-editor ui-workspace; do (cd packages/$p && bun test) || break; done && npx tsc -p . && (cd packages/ui-workspace && bun run build)`
Expected: all PASS, tsc silent, build prints `main.js`

- [ ] **Step 5: Commit**

```bash
git add -A packages && git commit -m "feat: host the puzzle editor, linked to the page System; remove connection-designer"
```
