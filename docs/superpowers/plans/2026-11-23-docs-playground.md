# The Learn playground: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Learn pages 01–15 show their step's code in an editor beside the text; Run executes it in a sandboxed frame and shows what it prints.
**Architecture:** pure pieces in `docs-site/scripts/playground/` (marker stripping, Sucrase transpile, the frame document, the message check), unit-tested with `bun test scripts`; a Vue `Playground` component and a split layout in the VitePress theme; a dev middleware serving the host's built `shared/`; a browser test on the built site.
**Tech Stack:** VitePress 1.6.3, Vue 3 (via VitePress), CodeMirror 6, Sucrase, bun test, Playwright.
**Spec:** docs/superpowers/specs/2026-11-23-docs-playground-design.md

## Global Constraints
- New dependencies only in `docs-site/package.json`, exact versions: `codemirror` `6.0.1`, `@codemirror/lang-javascript` `6.2.2`, `@codemirror/theme-one-dark` `6.1.2`, `sucrase` `3.35.0`. Nothing added to packages/ or examples/; step files unchanged.
- The frame: `<iframe sandbox="allow-scripts">` (nothing else), `srcdoc`, an import map with exactly `@pritzlaff/nano-core` → `<origin><root>shared/nano-core.js`, `typebox` → `…shared/typebox.js`, `typebox/value` → `…shared/typebox-value.js`, where `<root>` is the docs `base` without its trailing `docs/` (as `appUrl` computes) and `<origin>` is `location.origin`.
- Messages from the frame: `{ run: string, kind: 'line' | 'error' | 'done', text?: string }`; the page accepts one only if `event.source` is the current frame's `contentWindow` and `run` is the current run's id.
- A run longer than 5000 ms: the frame removed, output `Stopped: still running after 5 seconds.`
- Shared modules missing (the import fails): output says `Build the host first: make ui (or cd packages/ui-workspace && bun run build).`
- Editor text: the step file minus lines matching `^\s*// #(end)?region\b`. Edits kept per step in `localStorage` under `nano-docs.playground.<step>`, every access in try/catch.
- Accessible: the editor labelled `<step> code`, Run (also Ctrl/Cmd+Enter) and Reset real buttons, output `role="log"` `aria-live="polite"`.
- Pages 01–15 only; 16–18 and recipes keep the default layout.
- Never push; commit on `dev`, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Green before each commit: `cd docs-site && bun test scripts && bun run build` (after `cd packages/ui-workspace && bun run build`), `bunx tsc --noEmit`, e2e as stated per task (sandbox disabled).

## Review Focus
1. The frame reaching the page: any sandbox token beyond `allow-scripts`, or a message accepted from another source or a stale run.
2. Pages subpath: the import map URLs under `DOCS_BASE=/nano/docs/` point at `/nano/shared/…`.
3. A step whose `main` rejects, or throws synchronously at import, shows an error line, never a silent blank.
4. Dark mode: the editor follows the site's theme switch while the page is open.
5. Narrow screens: below ~960px the text and the playground stack, nothing scrolls sideways.

---

### Task 1: the playground's pure pieces
**Files:** Create `docs-site/scripts/playground/{strip.ts,transpile.ts,frame.ts,messages.ts}` and `docs-site/scripts/playground/playground.test.ts`; Modify `docs-site/package.json` (deps above).
**Interfaces — produces:** `stripMarkers(src: string): string`; `transpile(ts: string): { ok: true; js: string } | { ok: false; error: string }` (Sucrase `transforms: ['typescript']`, ESM kept); `sharedBase(origin: string, base: string): string` (→ `<origin><root>shared/`); `frameDoc(js: string, shared: string, run: string): string` (the srcdoc HTML: the import map, then a module script that imports the transpiled code from a `data:`/blob URL or inline, calls `main(line => parent.postMessage({ run, kind: 'line', text: line }, '*'))`, posts `done`, and posts `error` with the message on a throw, a rejection or a failed import); `accept(e: { source: unknown; data: unknown }, frame: unknown, run: string): { kind: 'line' | 'error' | 'done'; text?: string } | undefined`.
- [ ] Tests: `stripMarkers` removes `// #region x` and `  // #endregion x` lines and keeps code; `transpile` of `const a: number = 1; export const b = a` has no `: number` and keeps the export, and a syntax error gives `ok: false`; `sharedBase('https://x.io', '/nano/docs/')` → `'https://x.io/nano/shared/'` and `('http://localhost:5173', '/docs/')` → `'http://localhost:5173/shared/'`; `frameDoc` contains the three import-map entries and the run id; `accept` rejects another source, another run, and malformed data, and passes a good line.
- [ ] Run → fail; implement; run → pass. Commit `feat(docs): the playground's pieces — strip, transpile, frame, messages`.

### Task 2: the Playground component, the split layout, dev serving
**Files:** Create `docs-site/.vitepress/theme/Playground.vue`; Modify `docs-site/.vitepress/theme/index.ts` (layout), `docs-site/.vitepress/theme/custom.css`, `docs-site/.vitepress/config.ts` (dev middleware: `/shared/*` from `../packages/ui-workspace/public/shared` with `Access-Control-Allow-Origin: *`), `docs-site/learn/01-*.md` … `15-*.md` (front matter `playground: <NN-name>`).
**Interfaces — consumes:** Task 1's functions. The step texts via one `import.meta.glob('../../../examples/tutorial/[0-9][0-9]-*.ts', { query: '?raw', import: 'default', eager: true })` (test files excluded).
- [ ] The layout: when front matter has `playground`, the doc content on the left and `<Playground :step>` on the right (sticky, full height), stacked below ~960px; otherwise the default layout unchanged.
- [ ] The component: CodeMirror (JavaScript/TypeScript highlighting; one-dark when the site is dark, switching live), Run, Reset, the output log; Run builds a fresh frame per the Global Constraints, a 5000 ms timer, accepts messages via `accept`, shows lines and errors, `done` ends the run; client-only (VitePress `ClientOnly` or `onMounted`).
- [ ] Verify by hand-free checks: `cd docs-site && bun run build` passes (SSR must not touch `window`); `bun test scripts` passes. Commit `feat(docs): Learn pages run their step in a playground`.

### Task 3: the browser test
**Files:** Create `e2e/playground.e2e.ts`.
- [ ] On the built site (`make ui` server, as `e2e/docs.e2e.ts`; build the docs into `public/docs` first if the config's web server doesn't — follow how docs.e2e gets them): open `/docs/learn/01-plain`, click Run, expect the output to equal the lines `examples/tutorial/01-plain.test.ts` asserts (read them from the test file or keep them in sync by import); same for one step using nano (`05-runtime`); edit the code (change a number), Run, see the changed line; Reset restores the original text; replace the code with `export async function main() { throw new Error('boom') }` → an error line `boom`; `export async function main() { for (;;) {} }` → `Stopped: still running after 5 seconds.`; and `export async function main(log) { log(String(!!window.parent.document)) }` → an error line (the frame cannot read the page).
- [ ] Run `bunx playwright test e2e/playground.e2e.ts e2e/docs.e2e.ts` (sandbox disabled) → pass. Commit `test(e2e): the Learn playground runs steps, edits, errors and stops`.
