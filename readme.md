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
- To release: `bun scripts/version.ts 0.2.0`, commit, `git tag v0.2.0`, push the tag. `.github/workflows/publish.yml`
  tests, builds, smoke-tests and publishes (npm trusted publishing; see the workflow's header).
