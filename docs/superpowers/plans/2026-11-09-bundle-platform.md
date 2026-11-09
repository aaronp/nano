# Bundle, Platform and the workspace on core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Basic components (`@composable/bundle`), a systems component with a tree view (`@composable/platform`), a shared element base (`@composable/elements`), and `ui-workspace` running on `@composable/core`.

**Architecture:**
- **Bundle:** rune components, each with a self-placing Lit element.
- **Platform:** a plain core component, built with `Components.create`, not runes. It needs live objects (registries and runtimes) and must not run at definition time. It publishes snapshots whenever any of its registries changes.
- **Workspace:** `composable.ts` creates the host runtime, provides it, adds the platform, and builds the worked example through the platform's actions.

**Tech Stack:** Bun, TypeScript, TypeBox, Lit 3, happy-dom.

**Spec:** `docs/superpowers/specs/2026-11-09-bundle-platform-design.md`

## Global Constraints

- **New packages:** `packages/elements`, `packages/bundle` and `packages/platform`, all `workspace:*` internally.
  - **Dependencies:** `typebox` `^1.4.0` and `lit` `^3.0.0` as needed.
  - **Dev:** `@happy-dom/global-registrator` `^21.0.4`, with a `bunfig.toml` that preloads `test/dom.ts` where the DOM is tested.
- No change to `packages/core`. The only change to `runes` would be a bug fix with a test, recorded as a ruling.
- Every file is at most about 200 lines, and every export has a 1–2 line purpose comment.
- The editor's prototype palette applies to all new elements; the editor's `styles.ts` base moves into `@composable/elements`.
- Never commit `puzzles/` or `kerits/`. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Moving a placed element in the DOM keeps its instance.** The dock re-parents panels, so removal waits a microtask and is skipped if the element is back on the page (Task 1).
2. **Connecting refuses actions that don't fit, and actions in different systems** (Task 4).
3. **`state-changed` fires for changes in every system,** not only `host` (Task 4).
4. **Debounce's max-wait flushes even while input keeps arriving** (Task 2).
5. **Map or Filter code that throws or doesn't compile** gives the action an `{ error }`, and nothing is published (Task 2).

---

### Task 1: `@composable/elements`

- **Move** `packages/editor/src/elements/view.ts` and `styles.ts` here, as `src/model-element.ts` and `src/styles.ts`.
  - `src/index.ts` exports `ModelElement`, `base` and the new API below.
  - The editor imports them from here, and its `test/view.test.ts` moves here too.
- **New API:**
  - `provide(doc: Document, registry: Registry)`, and `providedRegistry(doc)`.
  - **`abstract class PlacedElement extends ModelElement`**, with a `static component: Component`.
    - **On connect,** if no `registry` is set, it uses the provided one. Its name is the `name` attribute, or else a generated `${localName}-${n}`. If that instance exists it attaches; otherwise it creates the instance and owns it.
    - **On disconnect,** in a microtask: if it's still off the page and owns the instance, it removes it.

**Tests:**
- Placing creates the instance, and removing the element removes it.
- An existing name is attached to and left in place.
- Two elements share one name.
- Moving the element to another parent keeps the instance (Review Focus 1).
- With no name, the element gets a generated one.

- [ ] Write the tests and watch them fail. Implement. Run the editor and elements tests and tsc. Commit `feat(elements): shared element base and self-placement`.

### Task 2: Bundle components

`packages/bundle/src/components/*.ts`, one rune component each, ids `composable.bundle/<name>`.

- **Input:**
  - **Getters:** `kind` and `value`.
  - **Actions:** `setKind`, which takes `Type.Union` of the four literals; `setValue`; and `submit`.
  - **Event:** `submitted`.
- **Range:**
  - **Getters:** `value`, `min`, `max`, `step`.
  - **Actions:** `set(n)`, which clamps; and `setBounds({ min, max, step })`.
  - Its `value` schema is `Type.Number()`.
- **Log:**
  - **Getter:** `entries`.
  - **Sinks:** `debug`, `info` and `warn`, each adding `{ time, level, value }`.
  - **Action:** `clear`.
- **Debounce:**
  - **Getters:** `quiet` (default 300), `maxWait` (default 1000) and `pending`, a count.
  - **Actions:** `setQuiet`, `setMaxWait`, and the sink `enqueue`.
  - **Event:** `flushed(values[])`.
- **Map and Filter:**
  - **Getter:** `code`. Map defaults to `return x`, Filter to `return true`.
  - **Actions:** `setCode`, then `map(x)` or `filter(x)`.
  - **Events:** `mapped(y)`, or `passed(x)` when the code returns truthy.
- **`catalog`:** `{ input, range, log, debounce, map, filter }`, from kind to Component.

**Tests:**
- Each action and event.
- Debounce: values that arrive within `quiet` come out as one batch; with steady input, `maxWait` still flushes (Review Focus 4).
- Map and Filter: code that throws and code that doesn't compile both return `{ error }` and publish nothing (Review Focus 5).

- [ ] Write the tests and watch them fail. Implement. Commit `feat(bundle): input, range, log, debounce, map and filter`.

### Task 3: Bundle elements

`<c-input>`, `<c-range>`, `<c-log>`, `<c-debounce>`, `<c-map>` and `<c-filter>`, each a `PlacedElement`, plus `defineBundle()`.

**Tests:**
- In `<c-input>`, Enter submits.
- `<c-range>`'s slider input sets the value.
- `<c-log>` shows rows, and Clear empties them.
- `<c-map>`'s code box sets the code.

- [ ] Write the tests and watch them fail. Implement. Commit `feat(bundle): elements`.

### Task 4: Platform component

`packages/platform/src/platform.ts`:
- `platform(host: Runtime, catalog: Record<string, Component>): Component`, built with core's `Components.create`.
- `PlatformOps`:
  - **Sources:** `systems`, a `Snapshot[]` that is readable and published on every change, with `host` first; `selected`; `catalog`, a `string[]`.
  - **Events:** `selection-changed` and `state-changed` (`{ system, delta }`).
  - **Actions:**
    - `create-system(name)`, refused if the name exists;
    - `create-component({ kind, name, system })`;
    - `add-to-system({ instance, from, to })`;
    - `remove-from-system({ instance, system })`, refused for `registry` and for the platform itself in `host`;
    - `connect({ system, source, op, listener, target })`, refused unless both instances are in that system and `joins(source op, target op)` holds;
    - `disconnect({ system, id })`;
    - `select({ system, instance, op? } | null)`.
- **Changes become events:** it listens to each registry's deltas. For each one it publishes `state-changed` and `systems`.

**Tests:**
- Create a system and a component in it.
- `add-to-system` puts the same instance in both, and a call through either reaches the same value.
- Connecting a compatible pair delivers values; an incompatible pair, or one across systems, is refused (Review Focus 2).
- `state-changed` fires for a change in a created system (Review Focus 3).
- Disconnecting works.

- [ ] Write the tests and watch them fail. Implement. Commit `feat(platform): systems as a component`.

### Task 5: `<c-platform>`

The view element, a `ModelElement` on the platform instance. It falls back to the provided registry and the model `platform`.

- **Filter input** at the top.
- **Mode toggle:** By system or By component.
- **Tree with expand state:**
  - **Hidden:** `registry` and `~view` instances.
  - **By system:** system → component → action → in and out types.
  - **By component:** component → systems, with an `add` icon and a target-system select.
- **Selecting:** clicking an action selects it (`aria-pressed`).
- **Connect icon:** a `.connect` button on actions in the same system that `joins` the selected one, shown on row hover.
- **Connections** are listed per system, with ✕.
- **Add:** kind select, name, system select, then Create.

**Tests:**
- The filter hides what doesn't match.
- Selecting an action, then clicking a compatible one's connect button, makes a subscription.
- Incompatible actions have no connect button.
- By-component mode adds an instance to another system.
- Add creates a component.

- [ ] Write the tests and watch them fail. Implement. Commit `feat(platform): tree view`.

### Task 6: `ui-workspace` on core

- **Rewrite `src/composable.ts`** (at most ~80 lines):
  - the host runtime, provided to the page, with the platform as `platform`;
  - `defineBundle`, `defineElements` from editor and platform;
  - **the worked example,** made through platform actions: `ex-range` → `ex-debounce` (enqueue), `ex-debounce` (flushed) → `ex-log` (info), `ex-input` (submitted) → `ex-map` (map), `ex-map` (mapped) → `ex-log` (info).
- **`<editor-page>` with no `ids`** adds an editor to the provided registry, if it isn't already there, and uses it. This is a small change in the editor's page.
- **`index.html`:**
  - Overview: `<c-range>` replaces `flow-slider`.
  - The Systems route (renamed from Connections) holds `<c-platform>` beside the named example elements.
  - The dock templates are the bundle elements, `<c-platform>` and `<editor-page>`; the old ones go.
- **Dependencies:** the old composable dependencies are swapped for the new ones. `git rm packages/puzzle-editor/test/host.test.ts`.
- **Test** in `packages/ui-workspace/test/host.test.ts`: the page's markup and `composable.ts` load; the platform lists `host` with the example; setting `ex-range` flows through debounce into `ex-log`.

- [ ] Write the test and watch it fail. Implement. Run `bun run build` in ui-workspace, all tests, and tsc. Commit `feat(ui-workspace): run on core with bundle, platform and editor`.

### Task 7: READMEs and CI

- [ ] READMEs for elements, bundle and platform, each at most 50 lines; bundle's says that map and filter run code with `new Function` and are not for untrusted input. Add `elements bundle platform` to the CI loop. Run everything. Commit `docs: elements, bundle, platform READMEs; CI`.
