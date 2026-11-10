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
- `make publish` publishes them from your machine (see [Publishing](#publishing)).
- `templates/nano-template` is a stand-alone starter for component packages, mirrored to
  [aaronp/nano-template](https://github.com/aaronp/nano-template) (`make template-export`, or on push to master).
  `make template-check` tests it against the libraries in this commit.
- To release from CI: `bun scripts/version.ts 0.2.0`, commit, `git tag v0.2.0`, push the tag. `.github/workflows/publish.yml`
  tests, builds, smoke-tests and publishes (npm trusted publishing; see the workflow's header).

## Publishing

The three packages are released together, at one version. From your machine:

1. **Set the version** (if it isn't already): `bun scripts/version.ts 0.2.0` bumps core, runes and elements; commit it.
2. **Log in to npm** once per machine: `npm login` (as `pritzlaff`); `npm whoami` checks.
3. **Publish:** `make publish OTP=123456`. It builds the packages, smoke-tests them as a stranger would, then
   publishes each version not already on npm (so a re-run after a failure is safe).
   - **The OTP** is the 6-digit code from the authenticator app you set up for npm's two-factor login (npmjs.com →
     your avatar → Account → Two-Factor Authentication). Codes last about 30 seconds, so run the command with a
     fresh one; if it expires partway, run it again with a new code and it carries on where it stopped.
   - If your 2FA is a security key or passkey, leave `OTP=` off: npm prints a link to approve the publish in the
     browser. An npm recovery code also works as the OTP.
4. **Check:** `npm view @pritzlaff/nano-elements version` shows the new version (esm.sh can take a minute to see it).
5. **Move the template on:** in `templates/nano-template`, set `@pritzlaff/*` to `^<version>` in `package.json` (if
   not already), run `bun install` to refresh `bun.lock` (its CI installs with the lockfile frozen), run `bun test`,
   and commit both. `make template-export` (or a push to master) mirrors it to aaronp/nano-template.

Without a code to hand, CI can publish instead: push a `v<version>` tag (above).
