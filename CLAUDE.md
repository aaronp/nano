# Working in this repo

- **No concept drift.** A new domain concept, exported name, public method or option is a question for the user, not
  a ruling. Never redefine what an existing concept is while implementing. Reviewers report any new export as a
  finding.
- **Keep it small.** `packages/nano/test/structure.test.ts` fails the build when a source file passes 150 lines, an
  exported interface or object type passes 10 members, or an export is missing from `design.md`. Its baseline
  (`packages/nano/structure-baseline.json`) may only shrink; regenerate it only with the user's agreement.
- **The model** is in `docs/superpowers/specs/2026-11-14-values-and-application-design.md` (the spec) and `design.md` (the map).
  Pods and deployments are values; the `Application` is the one live thing.
- Tests: `cd packages/nano && bun test --isolate`; `cd examples && bun test --isolate`; types: `bunx tsc --noEmit` at
  the root. Don't run a bare `bun test` at the root (it picks up unrelated untracked folders).
