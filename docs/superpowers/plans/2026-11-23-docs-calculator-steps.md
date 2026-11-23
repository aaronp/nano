# Nano docs step by step (the calculator): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the template becomes a calculator with history, and the docs teach nano in 18 one-concept "Learn" pages, each embedding a small tested step file.
**Architecture:** step files in `examples/tutorial/` (the examples workspace: CI tests them against this commit's nano), one page each in `docs-site/learn/`, the last three on the template's own files. The old `concepts/` pages go.
**Tech Stack:** TypeScript, TypeBox, `@pritzlaff/nano-core` 0.4, VitePress 1.6.3, bun test, Playwright.
**Spec:** docs/superpowers/specs/2026-11-23-docs-calculator-steps-design.md (revises docs/superpowers/specs/2026-11-23-docs-site-design.md)

## Global Constraints
- No new nano exports, methods or options (CLAUDE.md). A missing piece: a board card in `docs/board/board.md` under `## To-Do`, `- parent: t-09`, the existing card format (next id after the highest present).
- Step file contract: `examples/tutorial/NN-<name>.ts` (NN two digits), self-contained (imports nano packages and typebox only, never another step), ≤150 lines, exporting `main(log: (line: string) => void): Promise<void>` that runs the step's example and logs what a reader would see; its test `examples/tutorial/NN-<name>.test.ts` calls `main` and asserts the logged lines.
- Page contract: `docs-site/learn/NN-<name>.md`, one concept, at most a screen: a sentence on why, the step's code (`<<< @/../examples/tutorial/NN-<name>.ts#<region>`, regions `// #region <name>` … `// #endregion <name>`), "What it prints" (the asserted lines), sugar first and the raw form in a `::: details Raw` block where the step has both. No links to specs, ADRs or design.md. Every claim about nano checked in source.
- Terms: Registry (what can be made), Runtime (pods placed together, with call edges and pipes), Application (the live thing that delivers messages and applies deployments). The app gateway is one pod placed in two runtimes.
- `impl` takes the implementation coordinate: `Calculator.impl(ns.implementationId('calculator'))`.
- Every commit leaves all suites and the docs build green: `cd examples && bun test --isolate`; `cd packages/ui-workspace && bun test --isolate`; `bun scripts/template-check.ts`; `cd docs-site && bun test scripts && bun run build` (after the ui-workspace build); `cd packages/nano && bun test --isolate test/structure.test.ts`; `bunx tsc --noEmit`; e2e with the sandbox disabled.
- Never push; commit on `dev`, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus
1. A step file imports another step: the playground could not load it alone.
2. The calculator template in the host: picked from the picker, its view computes 2 + 3 = 5 and lists it in history; Sandboxed and Trusted imports both still work (cross-origin e2e).
3. Step 9's pipe: `calculated` and `history.save` share one `Schema.define` value, or the pipe is refused.
4. A page restates or contradicts another (terms Registry/Runtime/Application used the same way on every page).
5. Division by zero is a failure value on every page that shows it, never a thrown error reaching the reader.

---

### Task 1: the template becomes the calculator
**Files:** `templates/nano-template/` (src: `interfaces.ts`, `calculator.ts`, `history.ts`, `calculator-view.ts`, `view.ts`, `index.ts`; `nano.json`; test/; README.md; AGENTS.md); remove timer/picker/store sources, views and tests; knock-ons found by `grep -rn "timer\|picker\|nano-store\|acme.template" e2e scripts examples packages/ui-workspace/test docs-site .github` (at least `e2e/cross-origin.e2e.ts`, `e2e/slice.e2e.ts`, `e2e/examples.e2e.ts`, `examples/dist.test.ts`, `examples/scripts/build.ts`, `scripts/template-check.ts`, `docs-site/index.md`, `docs-site/concepts/*`, `docs-site/recipes/timer.md`, `docs-site/.vitepress/config.ts`).
**Interfaces — produces** (namespace `acme.template`): `Calculator` { `calculate`: action `Sum` → `Calculated`; `calculated`: event `Calculated` }, `Sum` = `{ a: number, op: '+'|'-'|'*'|'/', b: number }`, `Calculated` = `Sum & { result: number }` (one `Schema.define` value); `History` { `save`: action `Calculated` → null; `load`: action null → `Calculated[]` }. Implementations `acme.template/calculator` (builder form; config `{ precision?: integer }`; division by zero → failure `invalid-input`) and `acme.template/history` (localStorage, memory where there is none). `nano.json`: pods `calculator`, `history` in `main`, a pipe `Calculator/calculated` → `History/save`. View `<nano-calculator>`: two number inputs, an operator select, `=`, the result, and the history list (from `load`, refreshed on `calculated`).
- [ ] Tests first in the template's `test/`: pods (`2 + 3` → 5 and saved via the pipe; `1 / 0` → failure, nothing saved; precision rounds), views (type, choose, click `=`, result and history shown).
- [ ] Implement; template `bun test` and build pass.
- [ ] Rewrite each knock-on on the calculator, asserting the same feature (cross-origin: a picked calculator shows 2 + 3 = 5 and history lists it, under Sandboxed and Trusted).
- [ ] Docs: delete `docs-site/concepts/` and `recipes/timer.md`; `index.md` becomes a short home page (hero, "Start learning" → `/learn/01-plain`, recipes link); sidebar: "Learn" (empty group until Task 2) and the remaining recipes; recipes lose their "model's definition" lines.
- [ ] README and AGENTS.md describe the calculator (AGENTS.md keeps its rules; its "worked examples" line names the new files).
- [ ] Run every suite in the Global Constraints → green. Commit `feat(template): the template is a calculator with history; tests and docs follow`.

### Task 2: Learn 1–5 (plain, contract, builder, registry, runtime)
**Files:** Create `examples/tutorial/01-plain.ts` … `05-runtime.ts` with tests; `docs-site/learn/01-plain.md` … `05-runtime.md`; sidebar "Learn" entries.
- [ ] 01: `calculate(a, op, b)` in plain TS, division by zero an error; prints `2 + 3 = 5`, `1 / 0: cannot divide by zero`.
- [ ] 02: the `Calculator` interface (TypeBox schemas), `Static` types from it; prints an op's input type check (`Value.Check`) passing and failing.
- [ ] 03: the implementation with the builder; raw `Implementation.define` + `provide` + `success` in the Raw block.
- [ ] 04: a provider (`ns.provider([...])`) in a `Registry`; prints what it can make.
- [ ] 05: assemble a one-runtime deployment, `Application.create`, `app.runtime('main').get(Calculator).calculate(…)`; Raw: `app.call('main', 'calculator').calculate(…)` with its result value.
- [ ] Each step test asserts its `main`'s lines; pages per the page contract. Suites and docs build green. Commit `docs(learn): steps 1–5 — plain, contract, builder, registry, runtime`.

### Task 3: Learn 6–9 (results, events, history by message, a pipe)
**Files:** `examples/tutorial/06-results.ts` … `09-pipe.ts` with tests; `docs-site/learn/06-…` … `09-…`.
- [ ] 06: success and failure values; a throw in a handler arrives as a failure (`threw`).
- [ ] 07: `ctx.publish(Calculator.ops.calculated, …)`; listening from outside (`app.listen` or the runtime's listening API — check source) prints each event.
- [ ] 08: `.needs({ history: History })` and `deps.history.save(…)`; two History implementations (memory, and one that also logs), swapped by changing the call edge only.
- [ ] 09: the calculator without `needs`; a pipe `calculated` → `history.save` (same schema value); `load` shows the saved list.
- [ ] Suites and docs build green. Commit `docs(learn): steps 6–9 — results, events, history by message, a pipe`.

### Task 4: Learn 10–15 (NanoContext, pods, isolation, policies, the Application, the gateway)
**Files:** `examples/tutorial/10-context.ts` … `15-gateway.ts` with tests; `docs-site/learn/10-…` … `15-…`.
- [ ] 10: what `make` receives (`NanoContext`: call, publish, `one`, `on`, `addOnCloseListener`), and the builder's `deps` as sugar over `ctx.one`.
- [ ] 11: `Pod.eager` / `Pod.lazy` (built when, shown by logging in `make`), config `{ precision }` checked against its schema (a bad config refused at assemble).
- [ ] 12: `isolation: 'sandbox'` headless through `Application.create(…, { isolate })` (as `packages/nano/test/isolation.test.ts` does); without `isolate` the pod fails; prose on the real frame and `<OpenInNano src="examples/originkey/nano.json"/>`.
- [ ] 13: `Application.create(…, { policies: { main: PolicyRules([...]) } })` refusing a call to `History/save`, the refusal's reason printed.
- [ ] 14: `app.apply(next)` adding a pod; `deploymentPolicy` refusing one apply and allowing another.
- [ ] 15: two runtimes (`front`, `back`) sharing one `history` pod (listed in both runtimes' `pods`): the gateway; pods in each reach it, nothing else crosses.
- [ ] Suites and docs build green. Commit `docs(learn): steps 10–15 — context, pods, isolation, policies, the application, a gateway`.

### Task 5: Learn 16–18 and the events recipe
**Files:** `docs-site/learn/16-view.md`, `17-host.md`, `18-packaging.md` (embedding the template's files, regions added there), `docs-site/recipes/listening-view.md`; sidebar.
- [ ] 16: `<nano-calculator>` (template `src/calculator-view.ts`), its target, nano-elements styles.
- [ ] 17: serve, import by URL, place from the picker; `<OpenInNano src="examples/template/nano.json"/>`.
- [ ] 18: `bun run build`, `dist/`, the template as its own repo, loading it by its URL.
- [ ] Recipe "a view that listens to its pod's events": the calculator view refreshing history on `calculated`.
- [ ] Docs e2e (`e2e/docs.e2e.ts`) passes for every Open in nano. All suites green. Commit `docs(learn): steps 16–18 and the listening-view recipe`.
