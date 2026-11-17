# Releasing nano 0.4

## Ready

- Versions: `@pritzlaff/nano-core`, `@pritzlaff/nano-elements` and `@pritzlaff/nano-ui` are all 0.4.0; they release together (`scripts/version.ts` sets all three by default). nano-ui's first npm release.
  Siblings are `workspace:*`; the
  package build makes them peer ranges `^0.4.0`.
- The template depends on `^0.4.0` of nano-core, nano-elements and nano-ui.
- Built bundles carry `export const built = { '@pritzlaff/nano-core': '<version>' }`; the workspace warns when a module
  was built with a newer nano-core (major or minor) than its own, and imports it anyway.
- `PUBLIC_URL` (set by both Pages workflows from the Pages URL) makes a built nano.json's `modules` absolute:
  template `${PUBLIC_URL}index.js`; examples `${PUBLIC_URL}examples/<name>/<key>.js` (shared kv: `examples/kv/`).

## Fixed: the emitted types

`make smoke` and `make template-check` failed: nano-core's emitted `.d.ts` typed `Coord.namespace(...)`'s
coordinates with `ns: Readonly<any>` (a self-referencing type, elided), so nano-ui's `ns.implementationId('x')` was not
an `ImplCoord`. `packages/nano/src/provider.ts` now types `interfaceId`/`implementationId` as layer 1's coordinates
(no new export). Both pass (2026-11-17; smoke needs network, so run it outside a sandbox).

## Publish

1. `make smoke && make template-check` pass.
2. Either push the tag: `git tag v0.4.0 && git push origin v0.4.0` (publish.yml, with provenance), or from this
   machine: `make publish OTP=123456` (after `npm login`). A version already on npm is skipped.

## After

- `npm view @pritzlaff/nano-core version` (and -elements, -ui) show the new versions.
- In the template repo (`make template-export`, or its own CI): `bun install` against the published packages, then its
  Pages workflow passes (tests, build with `PUBLIC_URL`), and `https://<owner>.github.io/<repo>/nano.json` imports into
  the hosted workspace, by URL and as a downloaded file.
