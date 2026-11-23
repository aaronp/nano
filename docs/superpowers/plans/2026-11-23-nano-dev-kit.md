# The nano dev kit: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a project runs `bun run test-nano` to open its `nano.json` in a local nano app that saves back to the file and reloads on a rebuild; the hosted app opens any project by `?src=`; an `AGENTS.md` in the package walks an agent through it.
**Architecture:** the nano app (ui-workspace) learns two things: a cross-origin `?src=` opens the Import dialog on that URL, and a page served by the CLI (a `<meta name="nano-app-file">` in its HTML) boots in memory from that file, saves back to it with a PUT and listens for rebuilds. A new package `packages/nano-app` holds the CLI (Bun) and, when built, a copy of the app; it releases with the three libraries.
**Tech Stack:** Bun (server, watch, tests), TypeScript, Lit (the app), Playwright.
**Spec:** docs/superpowers/specs/2026-11-23-nano-dev-kit-design.md

## Global Constraints
- Names (user's): package `@pritzlaff/nano-app`, bin `nano-app`, a project's script `"test-nano": "nano-app nano.json"`. No new nano-core exports or concepts; any other new public name is a question for the user.
- The CLI serves on `127.0.0.1` only; a request whose `Host` is not `127.0.0.1:<port>`, `localhost:<port>` or `[::1]:<port>` gets 403; it serves only the app and the project folder (then the build folder, default `dist/`); the only write it accepts is a `PUT` of the opened `nano.json` (an existing file, written to a temp file then renamed); it never answers CORS preflights. `PORT` picks the port (default 0: any free one), `NO_OPEN=1` skips opening a browser.
- The CLI page: the app's `index.html` with `<meta name="nano-app-file" content="/<nano.json path>">` inserted in `<head>`; rebuild notices on `GET /__nano-app/events` (server-sent events, `data: rebuilt` after a successful build, `data: build-failed <first line>` after a failed one).
- Under the meta: the app starts with no stored document (in memory), imports the file as a same-origin `?src=` does today, File › Save PUTs the whole host document (as File › Save downloads it today, Desk included) with the file's original `modules` entries put back verbatim; a `rebuilt` event reloads the page unless the File menu is dirty, when it shows "Rebuilt — Reload (unsaved changes are lost)" with Reload and Later buttons.
- A cross-origin `?src=` on the hosted app opens the Import dialog with that URL fetched (Sandboxed preselected, as the dialog defaults); Cancel imports nothing; the `?src=` is removed from the address either way. Same-origin `?src=` unchanged.
- Files ≤150 lines (`packages/nano/test/structure.test.ts` covers `packages/*/src`); `packages/ui-workspace/src/main.ts` is at 140: new logic goes in new files.
- Never push; commit on `dev`, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never a bare `bun test` at the root. Green before each commit: the touched package's `bun test --isolate`, `bunx tsc --noEmit`, and the e2e named by the task (Chrome with the command sandbox disabled).

## Review Focus
1. Save corrupting the project's file: modules rewritten to resolved URLs, a half-written file, or a write to any path but the opened one.
2. The CLI reachable from another site or machine: a non-loopback bind, a missing Host check, a CORS header on the PUT.
3. A rebuild reload throwing away unsaved work without asking.
4. A crafted cross-origin `?src=` running code before the user clicks Import.
5. The published package missing its app files or bin (an install that serves nothing).

---

### Task 1: a cross-origin `?src=` opens the Import dialog
**Files:** Modify `packages/ui-workspace/src/main.ts` (the `?src=` block at the end); Modify `packages/ui-workspace/src/components/import-dialog.ts` (an optional URL to open on); Modify `templates/nano-template/README.md` (step 4 of "Make it yours": a fork's own Pages URL works in the link, with the approval prompt); Test `packages/ui-workspace/test/` (the dialog opened on a URL fetches it and shows the preview) and `e2e/cross-origin.e2e.ts` (on the app at :3210, `/?src=http://localhost:5174/nano.json` opens the dialog with the preview; Import with Sandboxed imports the calculator; a second visit with Cancel imports nothing; the address loses `?src=` both times).
- [ ] Interface: `openImportDialog(doc, deps = pageDeps, url?: string)`: with `url`, the URL field is filled and fetched as if Fetch were pressed.
- [ ] Tests first; implement; `cd packages/ui-workspace && bun test --isolate`; `bunx playwright test e2e/cross-origin.e2e.ts`. Commit `feat(ui-workspace): a ?src= on another origin opens the Import dialog on it`.

### Task 2: the app opened by the CLI — boot from the file, save to it, reload on a rebuild
**Files:** Create `packages/ui-workspace/src/dev-file.ts`; Modify `packages/ui-workspace/src/boot-host.ts` (no stored document under the meta), `packages/ui-workspace/src/main.ts` (Save and the import of the file via dev-file.ts); Test `packages/ui-workspace/test/dev-file.test.ts`.
**Interfaces — produces:** `devFile(doc: Document): string | undefined` (the meta's content); `restoreModules(saved: object, original: object): object` (the saved document with each `modules` key the original file had, at its top level or under `app`, given the original's value; keys only in `saved` kept); `saveTo(path: string, body: object, fetchFn = fetch): Promise<NanoResult<void>>` (PUT JSON, 2-space indent, trailing newline; a non-2xx is a failure with the status text); `onRebuild(doc: Document, dirty: () => boolean, reload = () => location.reload(), source = new EventSource('/__nano-app/events'))` (reloads on `rebuilt` when not dirty, else shows the notice from the Global Constraints in a `role="status"` element; a `build-failed` event shows its text as a bad toast).
- [ ] Tests first: `restoreModules` keeps `./index.js` for a key the original had at the top level and for one under `app`, keeps a new key's resolved URL, and leaves everything else as saved; `saveTo` sends PUT with the exact body and maps a 403 to a failure; `onRebuild` with a stub source calls `reload` when clean and shows the notice (Reload calls it, Later removes the notice) when dirty.
- [ ] Implement; under the meta, `boot-host.ts` starts with `start()` (in memory) and never touches storage or `WIPE`; `main.ts` imports the file's URL as the same-origin `?src=` path does, keeps the fetched original for `restoreModules`, and File › Save / Download write through `saveTo` (Download still downloads). Without the meta nothing changes.
- [ ] `cd packages/ui-workspace && bun test --isolate`, `bunx tsc --noEmit`. Commit `feat(ui-workspace): opened by nano-app, the app boots from the file, saves back to it and reloads on a rebuild`.

### Task 3: the template's build reads a saved whole document
**Files:** Modify `templates/nano-template/scripts/build.ts`; Test `templates/nano-template/test/` (a build test or the existing build check).
- [ ] With `PUBLIC_URL` set, a `nano.json` that is a whole host document (`{ app: { modules }, outline, host }`) gets its `app.modules` rewritten as a bare deployment's top-level `modules` are today; the rest of the file is copied unchanged.
- [ ] Template `bun test`, `bun run build`; `bun scripts/template-check.ts` (outside the sandbox: it installs). Commit `feat(template): the build reads modules from a saved host document too`.

### Task 4: the `nano-app` CLI
**Files:** Create `packages/nano-app/package.json` (`@pritzlaff/nano-app`, `bin: { "nano-app": "bin/nano-app.ts" }`, version = nano-core's), `packages/nano-app/bin/nano-app.ts` (args, port, open), `packages/nano-app/src/serve.ts`, `packages/nano-app/src/watch.ts`, `packages/nano-app/README.md`; Test `packages/nano-app/test/serve.test.ts`.
**Interfaces — produces:** `handler(opts: { app: string; project: string; out: string; file: string; port: () => number; events: { subscribe(res): void } }): (req: Request) => Promise<Response>`; `watch(project: string, build: string[], tell: (event: string) => void): () => void` (watches the project's `src/` recursively, debounced 200 ms, runs the build, tells `rebuilt` or `build-failed <first line of stderr>`). The bin finds the app at `../app` beside it (the published layout), falling back to `packages/ui-workspace/public` in this repo.
- [ ] Tests first, on `handler` with real temp folders: `/` is the app's index.html with the meta for the file; `/main.js` from the app; `/nano.json` from the project; `/index.js` from `out` when the project has none; a foreign Host → 403; a path escaping the project (`/../x`, `/%2e%2e/x`) → 404; PUT of the opened file → 204 and the file replaced; PUT of any other path, or of a missing file → 403; OPTIONS → 405 with no `Access-Control-*` header; `/__nano-app/events` is `text/event-stream`.
- [ ] Implement; the bin: `nano-app <nano.json> [--out dist] [--build "bun run build"]`, binds `127.0.0.1`, prints the URL, opens it unless `NO_OPEN=1`.
- [ ] `cd packages/nano-app && bun test --isolate`, `bunx tsc --noEmit`. Commit `feat(nano-app): the test-nano CLI — serve the app and a project on loopback, save one file, rebuild on change`.

### Task 5: release it with the libraries
**Files:** Modify `scripts/build-packages-list.ts` (a sibling `APPS = ['nano-app']`), `scripts/build-packages.ts` (for each app: `packages/<dir>/dist/` gets `bin/`, `src/`, README, LICENSE, `app/` = `packages/ui-workspace/public` without `docs/`, and a package.json with the version and `bin`, no `exports`), `scripts/version.ts` (default list includes nano-app), `.github/workflows/publish.yml` (builds ui-workspace before the packages; publishes `packages/nano-app/dist`), `Makefile` (`publish` loops over nano-app too), `scripts/smoke-packages.ts` (the packed nano-app has `bin/nano-app.ts` and `app/index.html`), `scripts/template-check.ts` (packs nano-app with the libraries).
- [ ] `make smoke` passes with the new checks; `bun scripts/version.ts 0.4.0` leaves nano-app at nano-core's version; `npm pack --dry-run packages/nano-app/dist` lists `bin/nano-app.ts` and `app/index.html` and no `app/docs/`. Commit `build: nano-app releases with the libraries`.

### Task 6: the guide and the template's script
**Files:** Create `packages/nano-app/AGENTS.md` (shipped: in `files`); Modify `templates/nano-template/package.json` (devDependency `@pritzlaff/nano-app` at the libraries' range, script `"test-nano": "nano-app nano.json"`), `templates/nano-template/AGENTS.md` and `README.md` (a short "Try it in nano" section: `bun run test-nano`), `docs-site/learn/17-host.md` (one paragraph: `test-nano` in your own project).
- [ ] AGENTS.md covers, in order: install and the script; the loop (a pod and its headless test → `bun test` → `bun run test-nano` → place, wire, call → Save → commit); what Save writes and that the file is the truth; publishing (the template's Pages workflow) and the link `https://aaronp.github.io/nano/?src=<published nano.json>` with its approval prompt; the fallback without the package (serve `dist/`, open the hosted app with `?src=`); "done means". It links to the template's `AGENTS.md` for writing pods and views and restates none of it. ≤150 lines.
- [ ] `bun scripts/template-check.ts` passes (it packs nano-app from this commit). Commit `docs: an AGENTS.md shipped with nano-app; the template's test-nano script`.

### Task 7: the browser test of the loop
**Files:** Create `e2e/nano-app.e2e.ts` (its own server: the test starts the bin itself on a fixed port with `NO_OPEN=1`, on a temp copy of the template built from this commit's libraries, and stops it after).
- [ ] Open the CLI's URL: the calculator's pods are in Main; calculate 2 + 3 → 5; File › Save → the temp `nano.json` on disk now holds the whole document and its `modules` still read `./index.js`; reload the page → the saved state is what shows (from the file, nothing from storage); edit a source file → the page reloads by itself when clean; change something, edit a source again → the "Rebuilt — Reload" notice shows, Later keeps the page.
- [ ] `bunx playwright test e2e/nano-app.e2e.ts e2e/cross-origin.e2e.ts` → pass. Commit `test(e2e): test-nano opens, saves and reloads a project`.

## Release note (not a task)
The template's devDependency on `@pritzlaff/nano-app` resolves only once it is on npm: tag and publish the release (`make bump-minor`, push the tag) before or with the merge to `master`, which exports the template.
