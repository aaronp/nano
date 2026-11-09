# The component template — design

## Intent

A stand-alone starter for building components outside this repo, against the published `@pritzlaff/nano-*`
packages. Copy it, rename it, and you have a package of components whose built output a host can import from a
URL (the next step: the host's import dialog). It starts as a folder here, so it changes with the libraries, and
is cross-published to its own repo, `aaronp/nano-template`, which GitHub marks as a template repository.

It ships one example, a **Timer**, to iterate on.

## Goals

1. **The folder:** `templates/nano-template`. It is **not** a workspace of this repo: it depends on
   `@pritzlaff/nano-core`, `nano-runes` and `nano-elements` (and `typebox`, `lit`) from npm, at `^0.1.0`, with its
   own `package.json` and `bun.lock`. That is what proves it works against the published packages.
   - The root `package.json`'s workspaces become `["packages/*"]` (today `templates/*` and `apps/*` are listed but
     empty).
2. **The Timer** (`src/timer.ts`): a rune component, id `nano.template/timer`.
   - **State, readable and published when it changes:** `count` (number, starts 0), `running` (boolean),
     `interval` (ms, default 1000).
   - **Actions:** `start`, `stop`, `reset` (count to 0; keeps running or not), `setInterval(ms)` (at least 10;
     restarts the clock if running).
   - **Event:** `tick`, carrying the new count, published on each tick while running.
3. **Its element** (`src/timer-el.ts`): `<nano-timer>`, a `PlacedElement`: the count, a Start/Stop button, Reset,
   and an interval field. Plain, minimal styles (theming comes later).
4. **The package's entry** (`src/index.ts`) is the module contract a host relies on:
   - `catalog`: `{ timer: { component: Timer, title: 'Timer', tag: 'nano-timer' } }` (the elements package's
     `Catalog` type, the same shape as the bundle's);
   - `define()`: defines every element, once (skips tags already defined).
5. **Tests** (`bun test`, happy-dom): the Timer ticks and publishes `tick`, stops, resets, refuses an interval
   under 10; the element's button starts and stops it; the manifest lists the catalog.
6. **The build** (`bun run build`) writes `dist/`:
   - `index.js`: one ES module (`Bun.build` with the shared packages external); `@pritzlaff/nano-*`, `lit` and
     `typebox` (and their subpaths, such as `typebox/value`) stay bare imports, so the host supplies its copies.
   - `manifest.json`, version 1, generated from the catalog:
     ```json
     { "manifest": 1, "name": "nano-template", "version": "0.1.0", "module": "./index.js",
       "shared": { "@pritzlaff/nano-core": "^0.1.0", "@pritzlaff/nano-runes": "^0.1.0",
                   "@pritzlaff/nano-elements": "^0.1.0", "lit": "^3.0.0", "typebox": "^1.4.0" },
       "components": [ { "kind": "timer", "id": "nano.template/timer", "title": "Timer", "tag": "nano-timer",
                         "ops": [ { "name": "start", "input": false, "output": false }, … ] } ] }
     ```
     `module` is relative to the manifest's URL. `shared` is the package's dependency ranges, for the host to
     check against what it provides. `ops` lists each op's name and whether it takes and gives a value (enough
     for the dialog to show; schemas stay in the module).
   - `index.html`: a preview page that runs the components on their own. An import map points the shared bare
     imports at esm.sh with every dependency left external (`https://esm.sh/*<pkg>@<version>`), so each shared
     library loads exactly once, through the map. The page makes a registry and runtime, provides it, calls
     `define()` and places a `<nano-timer>`.
7. **The template's own workflows** (in the folder's `.github/workflows/`, so they run in `aaronp/nano-template`):
   - `ci.yml`: install, test and build on every push and pull request;
   - `pages.yml`: on pushes to `main`, build and deploy `dist/` to GitHub Pages. The manifest's URL is then
     `https://<owner>.github.io/<repo>/manifest.json`.
8. **Cross-publishing** from this repo:
   - `.github/workflows/template-export.yml`, on pushes to `master` that touch `templates/nano-template/**`
     (and by hand): clones `aaronp/nano-template`, replaces its files with the folder's (not `node_modules` or
     `dist`), and pushes one commit, "Export from aaronp/nano@<sha>", to its `main`. Nothing to commit: no push.
     It authenticates with a `TEMPLATE_TOKEN` secret, a fine-grained token with contents write on that repo.
   - `make template-export` does the same from your machine, with your own git credentials.
   - This repo's CI also checks the template **against the libraries in the commit**: `make template-check` builds
     the packages, packs them, installs the template with those tarballs in place of the npm versions (in a scratch
     copy, so the folder's lockfile is untouched), and runs its tests and build. So a library change that would
     break the template is caught here, before it is published. `pages.yml` runs it.
9. **A README** in the folder: what it is, how to rename it (package name, component ids, tags), develop, test,
   build, preview, and where the manifest URL ends up.

## Non-goals

- The host importing from a URL (the next step), and iframe sandboxing.
- Publishing the template's package to npm.
- Theming and styling (separate, later).

## Anti-goals

- The template depending on this repo's sources, or on anything not published.
- A file over ~200 lines.

## Settled by Claude (check these)

- **The id namespace is `nano.template`**, and the tag prefix `nano-`. Renaming both is in the README's checklist,
  and the next step's import checks for clashes.
- **The manifest describes; the module is the authority.** The host still loads the module to get the components.
- **The preview uses esm.sh with dependencies external** (the `*` prefix), not jsdelivr's `+esm`, which rewrites a
  package's own imports to CDN URLs and could load a second copy of core. Locally `bun run preview` serves
  `dist/` the same way. Ponytail: a CDN dependency for the preview only; a host provides its own copies.
- **The manifest's ops come from the components themselves:** each component's `ops` carry their input and
  output schemas, and the build reads them from the catalog (importing the entry defines no elements; `define()`
  does).
- **The template's `bun.lock` is committed** and its CI installs with `--frozen-lockfile`; a new library version
  is picked up by updating the lockfile, not silently.
- **Export mirrors the folder,** dotfiles and `.github/` included: files deleted here are deleted there. It never
  force-pushes; the first export creates `main` in the empty repo.
- **The root workspaces drop `templates/*` and `apps/*`,** and the root lockfile is regenerated.
- **The exported repo's default branch is `main`.** You create `aaronp/nano-template` (empty), tick "Template
  repository" in its settings, enable Pages with source "GitHub Actions", and add `TEMPLATE_TOKEN` here.
