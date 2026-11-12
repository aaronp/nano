# Dependencies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Components declare typed needs, and a separate, swappable resolver binds each need to an instance. Bindings
are first-class registry data, they are saved in `nano.json` as pins, and they can be chosen or replaced in
`ui-workspace`.

**Architecture:**
- **Core:** interfaces (`iface`), providers (`define`), typed clients, and first-class bindings in the registry.
  - A binding is a coordinate, and the runtime only ever calls a binding through `Runtime.call`.
  - A runtime reaches another layer's runtime through a `peers` lookup.
- **nano-app:**
  - a pure `resolve(selector, context)`;
  - Application ops to list, set, bind and unbind needs;
  - automatic binding of new instances (to existing instances only);
  - `nano.json` `needs`, saved as pins.
- **The example and the host:**
  - A new `@composable/people` package holds the "save a person" example.
  - `ui-workspace` gets a chooser, a disabled state and a Dependencies dialog.

**Tech Stack:** Bun, TypeScript, TypeBox 1.x, Lit, and golden-layout 2.6.0 (in the host only).

**Spec:** `docs/superpowers/specs/2026-11-12-dependencies-design.md`. The spike it generalises is
`spikes/layers/nano.ts` and `spikes/layers/example.ts`, which you should read: the target API reads like
`example.ts`.

## Global Constraints

- Tests: `cd packages/<pkg> && bun test --isolate`. Types: `bunx tsc --noEmit` at the repo root. Host build:
  `cd packages/ui-workspace && bun run build`.
- Commit to `dev`, one commit per task. Each message ends with
  `Co-Authored-By: <the model that wrote it> <noreply@anthropic.com>`.
- **Program to interfaces.**
  - A client calls only `Runtime.call` (through the instance's handle), never an instance's object.
  - A binding is a `Coord`.
  - Where the target runs (host or iframe) must not matter.
- **Needs are additive.** Existing components, documents, subscriptions and tests keep working, and `needs` stays
  optional everywhere.
- **No implicit wiring.**
  - Every binding is registry data, visible in `snapshot().bindings` and announced by deltas.
  - Resolution never happens inside instantiation.
- **Loading never makes instances,** and the resolver never binds an instance to itself.
- **This round is for trusted, host-mode consumers only.** A sandboxed or guarded consumer with needs is out of
  scope, but nothing here may rule it out.
- Error text is fixed, and tests assert it:
  - `<instance> needs <need>: not bound`
  - `no runtime <registry>`
  - `<instance> has no need <need>`

## Review Focus

1. **A pinned `at` that no longer implements the interface** (it was replaced by another kind). Expect `choose`, with
   a reason, never a silent bind. *(Task 4 test.)*
2. **A wrapper's `inner` need, when the wrapper itself is the only match.** Expect `choose`, never a binding to
   itself. *(Task 4 test.)*
3. **A selector `layer` naming a system that doesn't exist.** Expect `choose` with the reason `no system <id>`, and
   no throw. *(Task 4 test.)*
4. **A binding whose target is later removed.** The next call fails with `no instance <id> in <registry>`, and the
   binding stays in the snapshot. *(Task 1 test.)*
5. **A document whose `needs` names an unknown need or instance.** Expect a note, no throw, and loading continues.
   *(Task 6 test.)*

---

### Task 1: Bindings in the core registry

**Files:**
- Modify: `packages/core/src/data.ts`, `packages/core/src/component.ts`, `packages/core/src/registry.ts`,
  `packages/core/src/runtime.ts`
- Test: `packages/core/test/registry.test.ts`

**Interfaces:**
- **Produces, in `data.ts`:**
  - `type Interface = { id: string; ops: Record<string, Op> }`
  - `CoordSchema`
  - `BindingSchema = Type.Object({ instance, need, to: CoordSchema })`, with its `type Binding`
  - `DeltaSchemas['binding-set']` and `DeltaSchemas['binding-cleared']`, each `{ type, binding: BindingSchema }`
- **Produces, in `component.ts`:**
  - `Component` gains `needs?: Record<string, Interface>` and `implements?: Interface[]`.
  - `Components.create(id, make, opts)` gains `opts.needs` and `opts.implements`.
- **Produces, on `Registry`:**
  - `bind(instance: string, need: string, to: Coord): Result<void>`
  - `unbind(instance: string, need: string): Result<void>`
  - `binding(instance: string, need: string): Coord | undefined`
- **Produces, in the snapshot:**
  - `SnapshotSchema.instances[]` gains `needs?: Record<string, string>` (need name → interface id) and
    `implements?: string[]`.
  - `SnapshotSchema` gains `bindings: Binding[]`.
- **Produces, in `runtime.ts`:** `RegistryOps.bind` (in `{instance, need, to}`) and `RegistryOps.unbind` (in
  `{instance, need}`), wired in `registryComponent`.

- [ ] **Step 1: Write failing tests** in `registry.test.ts`, under `describe('bindings')`:
  - `bind` on an unknown instance → `{error: 'no instance x in r'}`.
  - `bind` on an undeclared need → `{error: 'a has no need db'}`.
  - A valid bind emits `binding-set`, and the snapshot shows `bindings: [{instance:'a', need:'db', to:{registry:'s', instance:'d'}}]`.
  - Binding again replaces the binding: one entry, and one `binding-set` with the new `to`.
  - `unbind` emits `binding-cleared`; `unbind` with no binding → `{error: 'a has no binding db'}`.
  - `remove('a')` emits `binding-cleared` for each of `a`'s bindings.
  - `remove('d')` (the target) leaves `a`'s binding in place **(Review Focus 4)**.
  - `replace('a', …)` keeps `a`'s bindings.
  - A snapshot instance shows `needs: {db: 'example/db'}` and `implements: ['example/db']` when declared, and has
    neither key when nothing is declared.
- [ ] **Step 2: Run** `cd packages/core && bun test --isolate test/registry.test.ts`. Expect the new tests to FAIL.
- [ ] **Step 3: Implement.** Store bindings in a `Map` keyed `` `${instance} ${need}` ``. The declared needs come
  from `instance.component.needs`. Update any existing tests that compare whole snapshots so they expect
  `bindings: []`.
- [ ] **Step 4: Run** `bun test --isolate` (all of core) and `bunx tsc --noEmit` at the root. Expect PASS and clean.
- [ ] **Step 5: Commit** `feat(core): bindings — a need bound to a coord, in the registry, its snapshot and deltas`

### Task 2: Interfaces, providers and clients that call through bindings

**Files:**
- Create: `packages/core/src/needs.ts`, exported from `packages/core/src/index.ts`
- Modify: `packages/core/src/env.ts`, `packages/core/src/runtime.ts`
- Test: `packages/core/test/needs.test.ts`

**Interfaces:**
- Consumes: Task 1's `Interface`, `Component.needs`/`implements`, `Registry.binding`.
- **Produces, in `runtime.ts`:**
  - `Runtimes.create(registry, policy?, opts?: { peers?: (registry: string) => Runtime | undefined })`
  - `Handle` gains `use(need: string, op: Op, arg: unknown): Promise<Result>`. It reads
    `registry.binding(self, need)` *at call time* and calls `outer.call` for its own registry, or
    `peers(to.registry).call` for another, as `from = its coord`.
  - Error texts: `<instance> needs <need>: not bound` and `no runtime <registry>`.
- **Produces, in `env.ts`:** `Environment.use(need, op, arg)` uses the first handle. With no handle it returns
  `{error: 'not in a registry'}`.
- **Produces, in `needs.ts`:** the same names and typing as the spike:
  - `type OpSpec = { in: TSchema; out: TSchema; description?: string }`
  - `type Iface<S> = Interface & { spec: S }`
  - `iface<S>(id: string, spec: S): Iface<S>`, whose ops are `Ops.action(id, k, in, out)`
  - `type Client<I>` and `type Clients<D>`
  - `clients<D>(env: Environment, needs: D): Clients<D>`: each op calls `env.use(name, op, arg)` and returns the
    value. On an error it throws `new Error(result.error)`.
  - `define<I, D>(id: string /* ns/name */, implements_: I, needs: D, make: (deps: Clients<D>) => Impl<I>, opts?: { description?: string }): Component`
    - Its actions are the interface's ops.
    - `component.needs = needs` and `component.implements = [implements_]`.

- [ ] **Step 1: Write failing tests** in `needs.test.ts`. Port the spike's `example.test.ts` to real registries and
  runtimes:
  - Build four `Runtimes.create(..., { peers })` sharing one `Map` lookup.
  - Add each provider with `registry.add(id, Components.instantiate(def))`, then `registry.bind(...)` each need by
    hand.
  - **Tests:**
    - "a valid person goes down every layer": the same trace order as the spike.
    - "an invalid person stops in the app layer".
    - "swapping storage with `registry.replace` takes effect on the next call, with no rebinding".
    - "rebinding a need takes effect on the next call".
    - "an unbound need fails with `form needs bff: not bound`".
    - "a binding to an unknown registry fails with `no runtime nowhere`".
    - "a call to a removed target fails with `no instance db in storage`" **(Review Focus 4)**.
- [ ] **Step 2: Run** `bun test --isolate test/needs.test.ts`. Expect FAIL (module missing).
- [ ] **Step 3: Implement** `needs.ts`, `Handle.use` and `Environment.use`. `define` builds on `Components.create`
  with `opts.needs`/`implements`; `make` receives `clients(env, needs)`.
- [ ] **Step 4: Run** all of core, plus root tsc. Then check that the type checker catches the spike's three negative
  cases: wrong return type, unknown op on a dependency, wrong interface bound in a `define` dependency. Use a scratch
  file and delete it afterwards. Expect PASS.
- [ ] **Step 5: Commit** `feat(core): iface, define and typed clients that call through bindings, across runtimes`

### Task 3: Runes components with needs, and as providers

**Files:**
- Modify: `packages/runes/src/index.ts`
- Test: `packages/runes/test/runes.test.ts`

**Interfaces:**
- Consumes: Task 2's `Interface`, `Clients` and `clients`.
- **Produces:**
  - `component(id, make: (deps: Clients<N>) => A, schemas, opts?: { description?: string; needs?: N; implements?: Interface })`
  - A `make` that takes no argument still type-checks.
  - **When reading the shape:** `make` runs once to read its shape, and at that point it receives clients that throw
    `needs are not available while reading the shape`.
  - **With `implements`:** each key whose name is an op of the interface uses that interface `Op` as-is (key
    `<iface id>/<k>`). Other keys keep the `<component id>/<k>` namespace.
  - **On the component:** `component.needs = opts.needs` and `component.implements = [opts.implements]`.

- [ ] **Step 1: Write failing tests:**
  - "a runes component with needs calls its dependency through the binding": two registries, a bind, an action that
    awaits `deps.db.load(k)`.
  - "implements puts the interface's ops under its id": the snapshot op keys include `example/db/save`, plus
    `<id>/entries` for an extra getter.
  - "make without deps is unchanged": an existing test still passes untouched.
- [ ] **Step 2: Run** `cd packages/runes && bun test --isolate`. Expect the new tests to FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** runes, core and bundle tests, plus root tsc. Expect PASS.
- [ ] **Step 5: Commit** `feat(runes): needs and implements on component()`

### Task 4: The resolver (pure, in nano-app)

**Files:**
- Create: `packages/app/src/resolve.ts`, exported from `packages/app/src/index.ts`
- Test: `packages/app/test/resolve.test.ts`

**Interfaces:**
- **Produces:**
  - `type Selector = { implements: string; tags?: string[]; layer?: string; at?: string }`
  - `type Candidate = { coord: Coord; ops: string[]; tags: string[] }` (`ops` are op keys)
  - `type Provider = { kind: string; implements: string[] }`
  - `type ResolveContext = { requester: Coord; interfaceOps: string[]; systems: string[]; candidates: Candidate[]; providers: Provider[] }`
  - `type Resolution = { bound: Coord } | { make: string } | { choose: { candidates: Coord[]; kinds: string[] }; reason: string }`
  - `resolve(selector: Selector, ctx: ResolveContext): Resolution`
- **The policy, in order:**
  1. The target system is `selector.layer ?? ctx.requester.registry`. If it isn't in `ctx.systems`, return `choose`
     with the reason `no system <id>`.
  2. Fitting candidates are those in the target system, other than the requester itself, that have every op in
     `interfaceOps` and every one of `selector.tags`.
  3. If `at` is set, bind that candidate if it fits. Otherwise return `choose` with the reason
     `<layer>/<at> doesn't fit`.
  4. Exactly one fit → `bound`.
  5. No fit, and exactly one provider implementing `selector.implements` → `make`.
  6. Otherwise, `choose` with the fits and the matching kinds, and the reason `<n> match` or `nothing matches`.

- [ ] **Step 1: Write failing tests**, one per rule:
  - The pin wins.
  - A pin that doesn't fit gives `choose`, with the reason `storage/db doesn't fit` **(Review Focus 1)**.
  - A tag filter.
  - A single existing fit.
  - The requester is excluded: a wrapper whose only fit is itself gives `choose` with `nothing matches`
    **(Review Focus 2)**.
  - A single provider gives `make`.
  - Two fits give `choose` with `2 match`.
  - An unknown layer gives `choose` with `no system nowhere` and doesn't throw **(Review Focus 3)**.
- [ ] **Step 2: Run** `cd packages/app && bun test --isolate test/resolve.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expect PASS.
- [ ] **Step 5: Commit** `feat(app): resolve — a selector to an instance, a kind to make, or a choice`

### Task 5: The Application knows about needs

**Files:**
- Modify: `packages/app/src/application.ts`, `packages/app/src/create.ts`, `packages/app/src/infrastructure.ts`
- Test: `packages/app/test/needs.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4.
- **Peers:**
  - `createSystem` makes `Runtimes.create(Registries.create(name), undefined, { peers: id => s.systems.get(id) })`.
  - `createApplication` gives the host runtime `peers`, through a late-bound lookup over
    `runtimeOf(host.registry, id)`.
- **`Kind` gains** `implements?: string[]` and `needs?: Record<string, string>`, taken from the catalog component.
- **New `ApplicationOps`** (ns `nano.app`; `ref` is an `instance:<system>/<id>` ref):
  - `needsOf` (`needs-of`): `ref` → `Array<{ need: string; implements: string; selector: Selector; binding?: string /* instance ref */ }>`
  - `setSelector` (`set-selector`): `{ref, need, selector}` → `Resolution`. It stores the selector, resolves it and
    binds on `bound`. It never makes an instance.
  - `bindNeed` (`bind-need`): `{ref, need, to: ref}`. It binds, and stores the selector
    `{implements, layer, at, tags: the target's tags}`.
  - `unbindNeed` (`unbind-need`): `{ref, need}`.
- **State:** selectors per ref and need. The default is `{ implements: <need's interface id> }`. A removed instance
  loses them.
- **Auto-binding:** on `instance-added` in any system, for an instance whose component has needs, each need is
  resolved with its stored or default selector. It binds only on `bound`.
- **Errors:** an unknown need gives `<instance> has no need <need>`.
- **Produces, in `infrastructure.ts`:** `unboundOf(s: Snapshot): Array<{ instance: string; need: string }>`. A
  disabled instance is one with a declared need and no binding.

- [ ] **Step 1: Write failing tests:**
  - A created consumer auto-binds to the one existing provider, in another system via `layer`.
  - With two providers it stays unbound, and `unboundOf` lists it.
  - `setSelector` with `at` rebinds.
  - `bindNeed` stores a pinned selector carrying the target's tags.
  - `unbindNeed` makes the instance disabled.
  - Cross-system calls work after `createSystem`.
  - The `systems` source republishes on a binding delta.
- [ ] **Step 2: Run.** Expect FAIL.
- [ ] **Step 3: Implement.** The `ResolveContext` is built from the systems' snapshots:
  - `ops` from each snapshot op's key;
  - `tags` from `s.tags`;
  - `providers` from `kinds()`;
  - `interfaceOps` from the requester's `component.needs[need].ops`.
- [ ] **Step 4: Run** all of app, plus root tsc. Expect PASS.
- [ ] **Step 5: Commit** `feat(app): needs — list, select, bind and auto-bind, with peers between systems`

### Task 6: Saved and loaded as data

**Files:**
- Modify: `packages/app/src/document.ts`, `packages/app/src/snapshot.ts`, `packages/app/src/apply.ts`,
  `packages/app/README.md`
- Test: `packages/app/test/apply.test.ts`, `packages/app/test/snapshot.test.ts`

**Interfaces:**
- **`NanoAppSchema` instances gain** `needs?: Record<string, SelectorSchema>`, with at most 20 needs.
  - Need names match `^[a-z][a-zA-Z0-9-]*$`.
  - `SelectorSchema`: `implements` (≤200 characters), `tags?` (≤20 tags of ≤64 characters), `layer?` and `at?`
    (≤64 characters each, using the ID pattern).
- **`snapshotApp`** writes `needs` for every instance that declares any:
  - a bound need is written as `{implements, tags?, layer: to.registry, at: to.instance}`;
  - an unbound need is written as its stored selector.
- **`applyApp`:**
  - After **all** systems' instances and subscriptions are created, it calls `setSelector` for each need, in
    document order.
  - A result other than `bound` adds the note `<system>/<id> needs <need>: <reason>`.
  - It never makes instances.

- [ ] **Step 1: Write failing tests:**
  - Round trip: `snapshotApp` then `applyApp('replace')` on a fresh host gives the same `bindings`.
  - A pin survives a wrap: adding a second `example/db` instance, then reloading, keeps the original binding.
  - A need pointing at an instance later in the document, in another system, still binds.
  - An unresolvable need gives the note `app/form needs bff: nothing matches`, and the instance stays disabled.
  - A document whose `needs` names an unknown need or instance gives a note, doesn't throw, and the rest loads
    **(Review Focus 5)**.
  - A document without `needs` still validates.
- [ ] **Step 2: Run.** Expect FAIL.
- [ ] **Step 3: Implement.** Document the new `needs` field in the README.
- [ ] **Step 4: Run** all of app, plus root tsc. Expect PASS.
- [ ] **Step 5: Commit** `feat(app): needs in nano.json — saved as pins, resolved after everything loads`

### Task 7: The "save a person" example package

**Files:**
- Create: `packages/people/` (`@composable/people`), with `package.json` modelled on `packages/bundle`, and:
  - `src/interfaces.ts`: `Db`, `Validation`, `PersonApi` and `Bff`, as in the spike;
  - `src/providers.ts`: `PersonRules`, `PersonService` and `WebBff`, made with `define`;
  - `src/memory-db.ts`: a runes widget, `implements: Db`, with an `entries` getter;
  - `src/person-form.ts`: a runes widget, `needs: { bff: Bff, rules: Validation }`, with `submit`, `lookup` and a
    `people` getter;
  - `src/elements.ts`: `c-people-db` (a table of entries) and `c-person-form` (the spike's form and list), following
    `packages/bundle/src/elements`;
  - `src/index.ts`, exporting `catalog`;
  - `people.nano.json`.
- Test: `packages/people/test/people.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 3 and 5.
- **Produces `catalog`** with these kinds:
  - `people-db` (title `People DB`, tag `c-people-db`);
  - `person-rules`, `person-service` and `people-bff` (no tag);
  - `person-form` (tag `c-person-form`).
- **`people.nano.json`:**
  - Systems `app`, `bff`, `api` and `storage`, plus all their pinned `needs`.
  - Workspaces: `/people` (system `app`, the form) and `/people-data` (system `storage`, the DB view).
  - **Ruling:** the spec puts the DB view *beside* the form. Pages are single-system today, and multi-system pages are
    their own work item, so here the DB view gets its own page.

- [ ] **Step 1: Write failing tests**, headless, through `createApplication` with the people catalog:
  - Build the four layers via ops, and check that submit goes down the stack.
  - Wrap validation: a `StricterRules` `define` with `{inner: Validation}`, bound in front of `PersonRules`, rejects
    a name under 2 characters.
  - Swap storage: replacing `people-db` with a read-only `Db` gives `couldn't save: read only`.
  - `people.nano.json` passes `checkApp`, and `applyApp` gives no notes.
- [ ] **Step 2: Run** `cd packages/people && bun test --isolate`. Expect FAIL.
- [ ] **Step 3: Implement.** You'll need `bun install` for the new workspace package, which may need the sandbox
  disabled.
- [ ] **Step 4: Run.** Expect PASS, and root tsc clean.
- [ ] **Step 5: Commit** `feat(people): the save-a-person example — four layers, swappable storage, wrappable rules`

### Task 8: Host — the chooser, the disabled state and the Dependencies dialog

**Files:**
- Create: `packages/ui-workspace/src/components/needs-dialog.ts`, `packages/ui-workspace/src/boot-needs.ts`
- Modify:
  - `packages/ui-workspace/src/composable.ts` (people catalog, `bootNeeds`);
  - `packages/ui-workspace/src/app/boot.ts` and `src/boot-file.ts` (a `busy` flag while `applyApp` runs);
  - `packages/ui-workspace/src/lib/dock-layout.ts` (a panel header button);
  - CSS next to the dock's.
- Test: `packages/ui-workspace/src/lib/lib.test.ts` (the pure helpers)

**Interfaces:**
- Consumes: the Task 5 ops and `unboundOf`; Task 7's catalog.
- **Produces, in `needs-dialog.ts`:**
  - `chooseBinding(doc, need: { ref: string; need: string; implements: string }, options: { candidates: string[]; kinds: string[] }): Promise<{ bind: string } | { make: string } | { import: true } | null>`.
    It's built on `ask()` from `name-dialog.ts`, and `null` means cancelled.
  - `showDependencies(doc, ref, needs: ReturnType<needsOf>, replace: (need: string) => Promise<void>): Promise<void>`
- **Produces, in `boot-needs.ts`:** `bootNeeds(doc: Document, host: Runtime, opts: { busy(): boolean; importPackage(): Promise<void> })`
  - **On a new instance:** on `state-changed` `instance-added`, after the Application's auto-bind (one microtask),
    it lists the instance's unbound needs. Unless `busy()`, it opens `chooseBinding` for each, one at a time from a
    queue.
  - **Choosing:** `bind` calls `bindNeed`. `make` calls `createComponent` with the name `<kind>-<n>` (the first free
    `n`) in the selector's layer, then `bindNeed`; the new instance's own needs join the queue. `import` runs
    `importPackage`, then reopens the chooser.
  - **Marking disabled panels:** after each `systems` publish, it sets `data-unbound="<need,…>"` on every
    `PlacedElement` whose model is listed by `unboundOf`, and removes it when none remain.
  - **Disabled look:** CSS dims the element. An overlay button reads `Needs <need> — Choose…` and opens the chooser.
  - **The Dependencies button:** on panels whose instance declares needs, the dock's header gets a `Dependencies`
    button. It opens `showDependencies`, and `Replace…` opens `chooseBinding`, then calls `bindNeed`.
- **Pure helpers, exported for tests:**
  - `nextName(kind: string, taken: Set<string>): string`
  - `unboundLabel(needs: string[]): string`, which gives `Needs db — Choose…` and `Needs bff, rules — Choose…`.

- [ ] **Step 1: Write failing tests** for `nextName` and `unboundLabel`.
- [ ] **Step 2: Run** `cd packages/ui-workspace && bun test --isolate`. Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests, root tsc and `bun run build`. Expect PASS. Then check by hand with `make dev`:
  - Open `packages/people/people.nano.json`: no chooser opens, and the form saves.
  - Add a second `people-db`: nothing changes, because the form is pinned.
  - Dependencies → Replace → the new DB: the next save lands in the new DB's view.
  - Add a fresh `person-form` on a page: the chooser opens for `bff`. Cancel it: the form is dimmed, with
    `Needs bff, rules — Choose…`.
  - Save and reopen the file: the bindings are unchanged.
- [ ] **Step 5: Commit** `feat(ui-workspace): choose, see and replace a component's dependencies`

## Rulings made while planning (ledger)

- **Ruling:** in the example, the DB view is on its own page. Pages are single-system, and multi-system pages are
  their own work item. Cost if wrong: one more layout task once multi-system pages exist.
- **Ruling:** an instance that is in several registries uses the binding in its *first* handle's registry. Shared
  consumers with needs aren't a case yet. Cost if wrong: a per-registry rule later.
- **Ruling:** a guarded (`allow`/`deny`) consumer with needs is out of scope. Its inner runtime has no peers or
  bindings, so its calls fail as "not bound". Cost if wrong: it ties into the sandboxed-consumer round.
- **Ruling:** the resolver lives in nano-app, not core, because its context uses Application tags and catalog kinds.
  Core only knows bindings.
