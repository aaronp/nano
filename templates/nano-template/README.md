# nano-template

A package of components for nano hosts, built on the published
[`@pritzlaff/nano-core`](https://www.npmjs.com/package/@pritzlaff/nano-core), `nano-runes` and `nano-elements`.
Its build is a module plus a `manifest.json`; a host imports the package by the manifest's URL.

It ships one example to start from: a **Timer** (`src/timer.ts`), which counts while running and publishes each
count as `tick`, and its element `<nano-timer>` (`src/timer-el.ts`).

## Make it yours

Use this repository as a template (GitHub's "Use this template"), then rename:

1. `package.json`: `name`, `description`, `version`.
2. Component ids: `nano.template/timer` → `your.name/thing`. The namespace must be yours: a host refuses a
   package whose ids clash with ones it already has.
3. Element tags: `nano-timer` → `your-thing` (custom element names need a dash), in `src/index.ts`'s catalog.
4. Catalog kinds and titles in `src/index.ts`.

## Develop

```sh
bun install
bun test           # the components, the element, the manifest and the build
bun run build      # dist/: index.js, manifest.json, index.html
bun run preview    # build, then serve dist/ at http://localhost:4000
```

A component is a rune component (state, getters, actions and `event()`s) from `@pritzlaff/nano-runes`; its element
is a `PlacedElement` from `@pritzlaff/nano-elements`, which places the component in the page's registry by its
`name` attribute and re-renders when it publishes.

## What a host gets

- **`dist/manifest.json`**: the package name and version, the shared packages and versions it was built against,
  and each component's kind, id, title, element tag and ops. `module` is the module's path, relative to the
  manifest.
- **`dist/index.js`**: the module. It exports `catalog` (each kind: its component, title and element tag) and
  `define()` (defines the elements). `@pritzlaff/nano-*`, `lit` and `typebox` are left as bare imports: the host
  provides them, so everything shares one copy.
- **`dist/index.html`**: a preview that runs the components on their own, with an import map to those shared
  packages on esm.sh.

## What a package may import

A host gives the packages it imports its own copies of the shared libraries, so the module must leave them as bare
imports (the build does) and use only these:

`@pritzlaff/nano-core`, `@pritzlaff/nano-runes`, `@pritzlaff/nano-elements`, `lit`, `lit/decorators.js`,
`lit/directive.js`, `lit/directives/class-map.js`, `lit/directives/style-map.js`, `lit/directives/repeat.js`,
`lit/directives/if-defined.js`, `typebox`, `typebox/value`.

Anything else (other `lit` or `typebox` subpaths too) is bundled into the module by the build.

## Import it

In a host, open a workspace's Components drawer, click **Import**, and paste the manifest's URL. Locally:
`bun run preview` serves `dist/` at `http://localhost:4000/manifest.json`, and lets other origins fetch it.

## Publish

Pushes to `main` build and deploy `dist/` to GitHub Pages (`.github/workflows/pages.yml`; set Settings → Pages →
Source to "GitHub Actions" once). The URL to import is then:

```
https://<owner>.github.io/<repo>/manifest.json
```

Every push and pull request is tested and built (`.github/workflows/ci.yml`).
