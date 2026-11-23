# The Learn playground

Builds on `2026-11-23-docs-calculator-steps-design.md` (the 18 Learn steps, each a self-contained tested file in
`examples/tutorial/` exporting `main(log)`). Reference: https://elysiajs.com/tutorial/. Board: t-09, t-10.

## Intent
Each Learn page lets the reader run its step: the explanation on the left, the step's code in an editor on the right,
Run, and what it prints. They change the code and run it again. Reading a concept becomes doing it.

**Goals:** every Learn step runnable in the browser, on Pages and locally, with no account or install; the editor
starts from exactly the tested step file; built so a per-step assignment (task, check, Show answer) can be added later.
**Non-goals (this step):** assignments themselves; type-checking or autocompletion; running anything but the steps
(no free-form sandbox page); recipes or pages 16–18 running in the editor (they embed the template).
**Anti-goals:** the reader's code reaching the docs page, the app's storage or the user's cookies; code shown in the
editor that differs from the tested file; a second copy of the explanations.

## Approaches
- **Assignments** (user chose c): (a) runnable steps only; (b) runnable steps with an assignment each; (c) (a) now,
  built so (b) can be added step by step.
- **Where and how** (user chose A): (A) inside the docs site: a split layout per Learn page, CodeMirror 6, Sucrase,
  a sandboxed frame; (B) a separate playground app: the explanations in two places; (C) an embedded external service
  (StackBlitz…): heavy, third-party, no Bun, nano from npm not this commit. Monaco (types as you type) was set aside:
  several MB and hard to feed nano's types; revisit later.

## Design
- **Layout:** Learn pages 01–15 use a page layout with the Markdown on the left and the playground on the right;
  below ~960px they stack (text, then playground). Pages 16–18 and the recipes keep the normal layout.
- **The code:** the step file's text, imported at build time (`?raw`), so the editor shows exactly what the tests run.
- **Editor:** CodeMirror 6 with TypeScript highlighting, light and dark following the site's theme; Run (also
  Ctrl/Cmd+Enter) and Reset (back to the step file). The reader's edits are kept per step in `localStorage` as a
  convenience (lost if storage is unavailable; never required).
- **Running:** Sucrase strips the types (no type-check); the result runs as a module in an iframe with
  `sandbox="allow-scripts"` only (an opaque origin: no access to the page, its storage or cookies), loaded by
  `srcdoc` with an import map naming the browser builds the site already publishes (`shared/nano-core.js`,
  `shared/typebox.js`, `shared/typebox-value.js`, at the app root the Open in nano link uses). The frame imports the
  module, calls `main(line => …)`, and posts each line, a thrown error, or completion to the page.
- **Output:** the printed lines in order; a transpile error, an uncaught error or a rejected `main` shown as an error
  line; a run longer than 5 seconds stopped (the frame removed) and said so. Each Run is a fresh frame.
- **For assignments later:** the step tests already hold each step's expected lines; a later step moves them where
  both the test and the page can read them, and the left column gains a task and Show answer. Nothing here prevents it.

## Settled after the builder check (my calls)
- **The shared modules' URL:** absolute, `location.origin` + the app root (the docs `base` without its trailing
  `docs/`, as Open in nano computes it) + `shared/…`; a `srcdoc` frame has no usable base URL. The three builds have
  no further bare imports (they share typebox through relative chunks), so the import map has exactly three entries.
- **Under `make docs` (VitePress dev):** a dev-server middleware in the VitePress config serves the built
  `packages/ui-workspace/public/shared/` at `/shared/` with `Access-Control-Allow-Origin: *` (the opaque-origin frame
  needs it; `scripts/serve.ts` and GitHub Pages already send it). If that folder is missing, the playground's output
  says to build the host first (`make ui` or `cd packages/ui-workspace && bun run build`); `make docs` does not build
  it.
- **The editor's text:** the step file exactly, minus its `// #region` / `// #endregion` marker lines (comments that
  only serve the page's embeds; the code runs the same). Each Learn page names its step file; the files are imported
  `?raw` through one glob in the playground component.
- **A stuck run:** after 5 seconds the frame is removed, which stops it; no Worker.
- **Tests:** unit tests for the pieces that need no browser (marker stripping, the import map and frame document,
  the message handling); a browser test on the built site (`e2e/`, as the docs e2e runs) for the real path: a step's
  Run prints exactly its tested lines, an edit changes the output, Reset restores the file, a thrown error and a
  stuck loop show as errors, and the frame cannot read the page (`window.parent.document` access fails).

## Constraints
- New dependencies only in `docs-site/`, pinned exactly (CodeMirror 6 packages, Sucrase); nothing added to the
  packages or examples.
- Works on Pages (the docs at `<base>docs/`, the shared modules at `<base>shared/`) and locally (`make docs`, and
  the built site under `make ui`).
- No new nano exports. Every page stays as it is apart from the layout; the step files do not change.
- Accessible: the editor, Run, Reset and output are keyboard-usable and labelled; output is announced (`role="log"`).

## Left to the builder
How `make docs` (VitePress dev) serves the shared modules (e.g. a dev middleware serving the built ui-workspace
`public/shared`), the layout's exact breakpoints and styling, the frame's message format, and how a step page names
its step file (front matter or a component prop).
