# Nano

A micro-frontend platform. 

View it [here](https://aaronp.github.io/nano/)

Packages include `@composable/sdk`, `@composable/connections` (connections as data, and an orchestrator) and
`@composable/puzzle-editor` (a puzzle-style editor for types, components and connections, hosted by `ui-workspace`).

## Published packages

`@pritzlaff/nano-core` (ops, components, registries, runtimes), `@pritzlaff/nano-runes` (components written as
state and functions) and `@pritzlaff/nano-elements` (Lit elements over components) are published to npm, so a
component can be built in its own repo. Everything else here is private.

- `make packages` builds each into `packages/<name>/dist`, a ready-to-publish folder; `make smoke` installs those
  into a scratch folder as a stranger would, type-checks and runs a consumer.
- `make publish` publishes them from your machine (after `npm login`), skipping versions already on npm.
- `templates/nano-template` is a stand-alone starter for component packages, mirrored to
  [aaronp/nano-template](https://github.com/aaronp/nano-template) (`make template-export`, or on push to master).
  `make template-check` tests it against the libraries in this commit.
- To release from CI: `bun scripts/version.ts 0.2.0`, commit, `git tag v0.2.0`, push the tag. `.github/workflows/publish.yml`
  tests, builds, smoke-tests and publishes (npm trusted publishing; see the workflow's header).
