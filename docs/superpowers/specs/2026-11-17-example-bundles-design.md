# Example bundles: views for todo and chat, an auth case study, served like the template — design (2026-11-17)

## Intent

Make the examples things you can *play with*: each one is a nano package (a provider module with its views, and a
`nano.json`), tested headlessly, built and served the nano-template way, and opened in the ui-workspace to try by hand
and wire in Connections. Adds an `auth` case study that proves the host/sandbox boundary with a real passkey.

**Goals.** (1) Strong headless tests per example, over the same `nano.json` the bundle ships. (2) Open
`/examples/<name>/nano.json` in the workspace and use it. **Non-goals.** Home-origin frames (spec 2026-11-17 host-shell,
section 4); a runtime coordinate system; views inside sandbox frames. **Anti-goals.** Concept drift — no change to
`packages/nano`; example-only names are fine, nano/nano-ui exports are not.

## Builds on

The nano-template package contract: `src/index.ts` default-exports the provider, names `views` (implementation coord →
tag) and defines the tags on import; `scripts/build.ts` bundles to `dist/index.js` with nano, lit and typebox external,
and copies `nano.json`; `make serve`. The workspace build (`packages/ui-workspace/scripts/build.ts`) already copies the
template to `public/examples/template/`, so same-origin import works. The views-and-layout convention (one view per
pod, `layout.slots`), `ViewTarget`, nano-ui `HostUI.approve`.

## Per example

Each of `examples/todo`, `examples/chat`, `examples/auth`:
- `index.ts` — default export the provider(s) the example's `nano.json` names in `modules`, export `views`, define tags.
  Where `modules` names several providers (todo: `example.kv`, `example.todo`), each module entry is its own built file.
- `nano.json` — checked in; headless tests load it (`Application.load`); `modules` point at the built files.
- **Runtimes are namespaced** by the example's namespace (`example.todo.frontend`, `example.todo.backend`,
  `example.chat.room`, `example.chat.backend`, …) so examples can be imported side by side. Runtime ids already allow
  dots; this is a convention, not a nano change. *(User's direction; a richer runtime coordinate is later work.)*
  Existing tests and `chatDeployment`/`build` code follow the rename; the checked-in-equals-generated tests still hold.
- `layout.slots` naming the pods to show.
- A test that loads the **built** `nano.json` + modules from the build output, as the workspace would.

**Views (example-only tags):**
- todo — `<todo-list>`: add, tick done, remove; listens to `items`.
- chat — `<chat-room>` per participant pod (alice, bob): transcript, live `lines`, a box to `say`.
- auth — `<auth-passkey>`: a Passkey button and a status line with the last `authenticated`.

## Build and serve

- One build script for the examples (`examples/scripts/build.ts`, template-style) writing `examples/dist/<name>/`.
- The workspace build calls it and copies each to `public/examples/<name>/` (as for the template).
- `make serve-examples` (root Makefile, like `serve-template`) builds and serves `examples/dist/`.

## Auth case study

`example.auth/passkey`, providing **(example)** `example.auth.Auth`:
- `authenticate(purpose: string)` → `{ ok, purpose, credentialId?, at, reason? }`. A passkey prompt needs a user
  click, so the action shows a modal "*caller* wants to *purpose* — Authenticate with passkey?" with the button; the
  click runs `navigator.credentials.get` (or `create` the first time). Cancel → `ok: false`.
- event `authenticated` — the same non-sensitive result. Never a PRF output or key material.
- Its view's Passkey button does the same without a caller.
- **Host mode** (the pod's `isolation: host`): works with a real passkey.
- **Sandbox mode** (`sandbox`/`isolated-sandbox`, opaque origin): WebAuthn is unavailable; `authenticate` returns
  `ok: false, reason: 'passkeys are not available in a sandbox'` — a tested, honest refusal. Real isolated passkeys
  come with home-origin frames.
- `nano.json`: the auth pod, a log, a KV store; a pipe `authenticated` → log (and → the store's `set` in a second
  variant or as the user wires it in Connections).
- Headless tests inject the credentials API (a fake `navigator.credentials`), and cover ok, cancel and sandbox
  refusal; the e2e uses Playwright's virtual authenticator.

## Settled after the builder check *(my calls)*

- **Module paths.** The checked-in `nano.json` keeps source paths (headless tests load it as today). The build writes
  `dist/<name>/nano.json` with `modules` rewritten to the bundle's own files (`./kv.js`, `./todo.js`, …) and copies the
  shared `kv` module into each example's dist. A test loads that built file.
- **One entry per module.** Each `modules` entry is its own built file whose default export is that provider; a module
  with views also exports `views` and defines its tags. The workspace already probes every module a file names.
- **Sandbox detection** is feature detection: an opaque origin (`location.origin === 'null'`) or a missing/throwing
  `navigator.credentials` → the refusal. No nano change. In sandbox mode no modal is shown.
- **The modal** is the auth pod's own `<dialog>` (host mode reaches the page), styled like the host's `approve`.
- **Rename scope:** the todo, chat and auth `nano.json` files, `side-by-side.json`, and the code and tests that
  generate or name them. Other examples are untouched.
- **e2e:** root `e2e/` (Playwright, `bunx playwright test`), as the workspace tests are; one test per example opening
  its `nano.json`, auth with Playwright's virtual authenticator.
- **No second auth file.** Wiring `authenticated` into a KV store is done by hand in Connections, through a nano.ui
  `map` pod shaping it into `set`'s `{ key, value }`.

## Left to the builder

Exact view markup and styles (nano-elements' look); the modal implementation (a `<dialog>` like the host's `approve`);
how the auth pod learns its caller's name for the modal (the call's `from` if available, else "An app"); file layout
inside each example.
