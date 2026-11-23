# Nano docs, step by step: the calculator

Revises `2026-11-23-docs-site-design.md` (the VitePress site, the region check, Open in nano, the Pages step and the
recipes stand). Board: t-09, t-10. Reference: https://elysiajs.com/at-glance.html and, later, https://elysiajs.com/tutorial/.

## Intent
A newcomer meets nano from something familiar: a calculator in plain TypeScript. Each page then adds one concept and
one example, in tiny steps, until the calculator is a packaged nano component: the nano-template. The steps are real,
tested files, so a later playground (project B, not this one) can run each step in the browser.

What the docs teach nano is (user's framing):
1. **Contract-first**: an interface with TypeBox schemas comes first; everything is strongly typed.
2. **Event-driven**: a calculator that keeps a history is not handed a store; it sends `save` and `load` messages.
3. **Registry, Runtime, Application**, kept distinct (user agreed): the Registry is what can be made (providers,
   implementations); a Runtime is pods placed together with the call edges and pipes between them; the Application is
   the one live thing that delivers messages and applies new deployments.
4. **Pods**: an implementation isolated, built eager or lazy, configured, and run on the host or in a sandbox.
5. **NanoContext**: what `make` is given to call, publish to and query other components.
6. **Raw and sugar**: the builder and the typed client first, the raw values (`Implementation.define`, `provide`,
   `success`, `app.call`) shown beside them.
7. **Policies**: the runtime's yes/no on each message, the Application's yes/no on each deployment.
8. **The app gateway**: one pod placed in two runtimes, their only bridge.

**Goals:** one concept and one example per page; every sample a tested file; the template becomes the calculator,
so the docs end exactly at it and `bun create nano` (t-11) later hands people what they learned.
**Non-goals:** the playground (project B); the landing page and `/app`; new nano API (a gap is a board card).
**Anti-goals:** a page that introduces two concepts; samples that differ from what runs; inventing terms nano lacks;
pointing readers at internal files (specs, ADRs, design.md).

## Approaches
- **Running example** (user): a calculator replaces the template's timer, picker and store; (rejected) the calculator
  in the docs only, the template unchanged: two examples to keep alive.
- **Step code** (user chose 1): (1) a small tested file per step, the last steps being the template; (2) inline code
  blocks extracted and tested by a script: less to keep, but the playground could not reuse them cleanly.
  This replaces the earlier "reveal the finished template only" choice: baby steps from plain TypeScript cannot be
  regions of the final code.

## The steps (one page each, under "Learn")
1. A calculator in plain TypeScript (`calculate(a, op, b)`, division by zero an error).
2. Its contract: `ns.interface('Calculator', …)` with TypeBox schemas; the types it gives.
3. An implementation with the builder (`Calculator.impl(…).make(() => ({ … }))`); the raw form beside it.
4. The Registry: a provider and what it can make.
5. A Runtime: place a pod, call it with the typed client (`runtime.get(Calculator).calculate(…)`), and raw (`app.call`).
6. Results: success and failure (division by zero) as values; a throw becomes a failure.
7. Events: it publishes `calculated`; listening to it.
8. History without a store: it needs a `History` (`save`, `load`) and sends messages to it (`.needs({ history })`,
   `deps.history.save`); swapping the store behind the call edge.
9. A pipe instead: `calculated` piped to `history.save` (same schema), the calculator knowing nothing of history.
10. NanoContext: what `make` receives (call, publish, `one`, `on`, `addOnCloseListener`), the builder's `deps` being sugar over it.
11. Pods: eager or lazy, and config (e.g. `{ precision }`).
12. Isolation: host or sandbox, and what changes.
13. Policies: a message Policy (`PolicyRules`) refusing a call.
14. The Application: `apply` a new deployment, and its DeploymentPolicy.
15. Several runtimes and an app gateway: one pod placed in two runtimes.
16. A view: a web component on the calculator (with nano-elements' styles).
17. In the host: import it, place it, Open in nano.
18. Packaging: the template (now the calculator) built, published, loaded by URL.

Recipes stay (pipeline, host pods, deploying pods); the timer recipe becomes "a view that listens to its pod's
events" on the calculator's view, since the template's timer goes.

## Decided by me (correct me)
- **Where the steps live:** `examples/tutorial/NN-<name>.ts`, each with a test in `examples/tutorial/tutorial.test.ts`
  (or one test file per step), inside the `examples` workspace, so CI's `cd examples && bun test --isolate` runs them
  against this commit's nano and the structure test (≤150 lines) covers them. Each step file stands alone (no import
  from an earlier step), so a playground can load one file.
- **Pages:** `docs-site/learn/NN-<name>.md`, replacing `concepts/`; each embeds its step file (whole, or regions with
  `// #region` / `// #endregion <name>`), sugar first, raw in a `::: details Raw` block. No "model's definition" lines.
- **The template:** `templates/nano-template` becomes the calculator: `Calculator` and `History` interfaces, the
  calculator (builder form), an in-memory/localStorage history, a pipe `calculated` → `history.save`, a view
  `<nano-calculator>` with a history list; its tests, README and AGENTS.md updated; timer, picker and store removed.
  Steps 16–18 embed the template's files.
- **Knock-ons:** the host build already copies the template to `/examples/template/`; e2e tests that use the
  template's timer (`e2e/cross-origin.e2e.ts`, others found by search) move to the calculator; `scripts/template-check.ts`
  must pass.
- **Order of work:** the template becomes the calculator first (it is what the later steps embed); then steps 1–9;
  then 10–15; then 16–18 and the recipes' timer page; then removing `concepts/` and the internal-file lines.

## Settled after the builder check (my calls unless marked)
- **The app gateway** (user's term, from the app-bar design): no new mechanism. It is one pod placed in two
  runtimes (a pod may be listed in several runtimes' `pods`, as Raft's messaging and clock pods are); pods in either
  runtime reach it by call edges or pipes, and it is the only thing they share. Step 15 uses only placement and
  subscriptions.
- **Isolation in a test** (step 12): headless, isolation is the host's stand-in passed to `Application.create(…,
  { isolate })`, as nano's own isolation tests do; the step tests that and describes the real sandboxed frame in prose,
  with Open in nano for the real thing (the docs e2e already imports an isolated example).
- **What replaces the timer in the existing tests:** each e2e and script that uses the template's timer, picker or
  store is rewritten on the calculator, asserting the same feature (cross-origin import, Trusted and Sandboxed
  consent, the picker's provider group, a picked pod working): "a picked timer counts" becomes "a picked calculator
  shows 2 + 3 = 5 and the history lists it". The old pods are not kept as fixtures.
- **Green after every commit:** the template task includes every knock-on (e2e, template-check and export, the
  examples build and its test, ui-workspace tests naming `acme.template`, the timer recipe and concept pages that embed
  timer regions), so no commit leaves a test or the docs build broken.
- **`impl` takes the implementation's coordinate:** `Calculator.impl(ns.implementationId('calculator'))`.

## Constraints
- No new nano exports, methods or options (CLAUDE.md); what the steps need must exist (the builder, `runtime.get`,
  `PolicyRules`, `DeploymentPolicies`, multi-runtime placement). A missing piece is a board card under t-09.
- Every claim about nano's behaviour checked in source; each page reviewed for accuracy.
- Pages short: a screen at most.

## Left to the builder
The calculator's exact schemas and op names (kept small: one action, one event; History `save`/`load`), wording,
region names, which step a recipe links to.
