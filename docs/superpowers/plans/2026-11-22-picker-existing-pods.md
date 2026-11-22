# The picker places existing pods: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** an implementation's tile in the picker lists that implementation's pods in the chosen runtime (● running, ○ not), so one can be placed on the page without deploying a new one.
**Architecture:** `picker-grid.ts` renders the pods it is given through its entries; `workspace-dock.ts`'s `choose` gives an existing pod its `pod` slot (`pods.add`) instead of `host.deploy`. Placing and starting are what exists (Open view's slot, `outline.open`'s get-or-create).
**Tech Stack:** TypeScript, light DOM, bun test with happy-dom.
**Spec:** docs/superpowers/specs/2026-11-22-picker-existing-pods-design.md

## Global Constraints
- No new export, public method or option (CLAUDE.md); `Entries` in picker-grid.ts is internal and may gain a field.
- No source file over 150 lines; `workspace-dock.ts` at most 226 (it is at 226 now: what it gains, it moves out, e.g. into a `dock/` helper, named in design.md like every new export).
- design.md's picker paragraph (the `pickerGrid` line in the ui-workspace section) says what the tiles now list.
- Tests: `cd packages/ui-workspace && bun test --isolate`; `bunx tsc --noEmit` at the root; `cd packages/nano && bun test --isolate test/structure.test.ts`.

## Review Focus
1. Switching the runtime pill re-lists the pods, and keyboard focus stays on the pill (arrows between pills keep working).
2. A pick of an existing pod deploys nothing (`h.data().pods` unchanged) and its slot names that pod in that runtime.
3. A pod already shown on this page: its panel is focused, no second panel or slot.
4. The Hidden section's named tiles (parked panels) still restore as before: an existing pod's pick is told apart by coming from a provider section (it carries `runtime`).
5. The filter matches a pod's name; a group whose tiles are all filtered out hides.

### Task 1: the grid lists an implementation's pods
**Files:** packages/ui-workspace/src/components/picker-grid.ts; public/app.css (the `np-` rules); test/picker.test.ts.
**Interfaces — produces:** `Entries` gains `pods?(implementation: string, runtime: string): { name: string; running: boolean }[]` (read on each build, like `templates`). A pod tile is a button with `data-widget` = its implementation's widget, `data-name` = the pod, text `<name> ●` or `<name> ○`, `aria-label` `<name>, running` / `<name>, not started`; picked, the grid resolves `{ state: { widget, name }, runtime }` (the existing provider-section path).
- [ ] Test `an implementation with pods in the runtime shows them under its tile, and "+ new"`: entries with one `data-implementation="nano.ui/input"` template (widget `nano-ui-input`, title `input`) and `pods: (i, r) => i === 'nano.ui/input' && r === 'main' ? [{ name: 'a', running: true }, { name: 'b', running: false }] : []`, runtimes `['main', 'edge']`. Expect a group `[data-pods-of="nano-ui-input"]` holding the label `input`, tiles `a ●`, `b ○` and a tile `+ new` (no `data-name`); clicking `a` resolves `{ state: { widget: 'nano-ui-input', name: 'a' }, runtime: 'main' }`.
- [ ] Test `the runtime pill re-lists the pods; the filter matches pod names`: click the `edge` pill → no `[data-name]` tiles, the plain `input` tile is back; focus is on the `edge` pill after an ArrowRight from `main`. Back on main, filter `b` → only `b ○` visible, and the `range` provider group (another template) hidden.
- [ ] Implement: a template with `data-implementation` and pods from `entries.pods` renders as `div.np-impl[data-pods-of]` (label span, pod tiles, `+ new`); otherwise as today. A pill choice rebuilds the list without recreating the pills (rebuild the pills only when `entries.runtimes` changed). Style `.np-impl` so the label sits above its tiles and the group spans the row.
- [ ] Commit `feat(ui-workspace): the picker lists an implementation's pods in the runtime, running or not`.

### Task 2: the dock places a picked existing pod
**Files:** packages/ui-workspace/src/components/workspace-dock.ts (`choose`; its entries), a `dock/` helper if lines require; test/dock-pods.test.ts (stubbed picker: `pick.choice`, `pick.runtime`); design.md.
**Interfaces — consumes:** Task 1's `Entries.pods` and its resolve shape. Status: `this.host.app.runtime(r).status(pod)` (`ok` and `'running'` → running); pods of an implementation in runtime `r`: `h.data().runtimes[r].pods` whose `h.data().pods[p].implementation` is it.
- [ ] Test `a pick of an existing pod gives it its slot and deploys nothing`: `place(h, 'main', ['a'])` (lazy `nano.ui/input`), mount, `pick.choice = { widget: input, name: 'a' }; pick.runtime = 'main'`, click `.dock-empty` → `written('workspace').slots` equals `{ a: { kind: 'pod', pod: 'nano.ui/input@main/a' } }`, `Object.keys(h.data().pods)` unchanged, and after open `running(h, 'a')` is true (get-or-create).
- [ ] Test `picking a pod already on the page focuses its panel`: pick it twice → one panel, one slot, the panel focused.
- [ ] Test: the dock's entries list `a` with `running` false before it starts and true after (call the entries' `pods` through a captured `show`, or assert via the real grid in a template-mode dock).
- [ ] Implement in `choose`: a provider pick with `name` and `runtime` is an existing pod: if a panel already shows it, focus it (as `openPod` does) and resolve null; else `pods.add(data, runtime, name)` and return `{ widget, name, slot }`. Hidden picks (no `runtime`) unchanged.
- [ ] design.md: the picker paragraph says an implementation's tile lists its pods in the chosen runtime (● running) beside "+ new", and a pod picked is placed (its `pod` slot), not deployed.
- [ ] Commit `feat(ui-workspace): a picked existing pod is placed on the page, got or created when it opens`.
