# Example Bundles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** todo, chat and a new auth example each ship as a nano package (provider modules with views + `nano.json`), tested headlessly, served like the template, and openable in the ui-workspace.

**Architecture:** Each example keeps its headless source (`nano.json` → headless `.ts` modules, as today) and adds an `index.ts` entry per module that has views (re-exports the provider, exports `views`, defines tags). One build script bundles those entries into `examples/dist/<name>/` and writes a built `nano.json` whose `modules` point at the bundles; the workspace build copies `examples/dist/*` to `public/examples/`. No change to `packages/nano` or nano-ui exports.

**Tech Stack:** Bun, TypeScript, TypeBox, Lit, nano-elements, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-17-example-bundles-design.md`

## Global Constraints

- No change to `packages/nano`; no new nano-ui/nano-elements exports. Example-only names are fine.
- Runtimes namespaced by the example's namespace: todo `example.todo.frontend`, `example.todo.backend`; chat `example.chat.room`, `example.chat.backend`; auth `example.auth.main`.
- Never a PRF output or key material in any op result, event or log.
- Headless source modules must not import lit or DOM code (headless tests load `nano.json` in Bun without a DOM). Views live only in the `index.ts` entries.
- Tests: `cd examples && bun test --isolate`; `cd packages/ui-workspace && bun test --isolate && bun run build`; root `bunx tsc --noEmit`; root `bunx playwright test` (`dangerouslyDisableSandbox: true`). Never bare root `bun test`; never `git add -A` at root. Trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Don't push.

## Review Focus

- A built `nano.json` whose module path doesn't exist in its dist folder → the dist test fails loudly (Task 2 test asserts every `modules` file exists).
- Importing todo and chat into the same workspace → no runtime clash (Task 6 e2e imports both).
- `authenticate` called while a previous modal is open → the second call waits or fails `busy`, never two dialogs (Task 5 test).
- Passkey cancelled by the user → `ok: false`, no `authenticated` event (Task 5 test).
- Auth pod running sandboxed → refusal without a modal and without touching `navigator.credentials` (Task 5 test).

---

### Task 1: Namespace the runtimes

**Files:** Modify `examples/todo/{nano.json,side-by-side.json,*.test.ts}`, `examples/chat/{deployment.ts,nano.json,chat.test.ts,bench.ts}`, comments in `examples/chat/**/contract.ts`, `examples/todo/todo/contract.ts` that name runtimes.

- [ ] **Step 1:** Rename `frontend`→`example.todo.frontend`, `backend`→`example.todo.backend` (todo, side-by-side), `chat`→`example.chat.room`, `backend`→`example.chat.backend` (chat), in data, code and tests. Regenerate `chat/nano.json` from `chatDeployment` (its equality test is the check).
- [ ] **Step 2:** `cd examples && bun test --isolate` → all pass (54); root `bunx tsc --noEmit` clean.
- [ ] **Step 3:** Commit `refactor(examples): namespace todo and chat runtimes by their example`.

### Task 2: The examples build, dist test, workspace copy, `make serve-examples`

**Files:**
- Create: `examples/scripts/build.ts`, `examples/scripts/serve.ts` (copy of the template's, serving `examples/dist`), `examples/dist.test.ts`
- Modify: `packages/ui-workspace/scripts/build.ts` (run the examples build, copy `examples/dist/<name>` to `public/examples/<name>` for todo, chat, auth; watch `examples/{todo,chat,auth,kv}`), root `Makefile` (`serve-examples`, `EXAMPLES_PORT ?= 5175`), root `.gitignore` (`examples/dist/`)

**Interfaces:**
- Produces: `const EXAMPLES: Record<string, Record<string, string>>` in `build.ts` — example name → (module key → entry file, relative to `examples/`). Initially `todo: { 'example.kv': 'kv/memory.ts', 'example.todo': 'todo/kv.ts' }`, `chat: { 'example.kv': 'kv/memory.ts', 'example.messaging': 'chat/messaging/kv.ts', 'example.chat': 'chat/room/messaging.ts' }`. Tasks 3–5 switch entries with views to their `index.ts` and add `auth`.
- Build per example: bundle each entry to `dist/<name>/<key>.js` (externals as the template: nano packages, lit, typebox); write `dist/<name>/nano.json` = source `nano.json` with `modules[key] = './<key>.js'`.

- [ ] **Step 1: Failing test** `examples/dist.test.ts` (runs the build in `beforeAll` via `Bun.spawnSync(['bun', 'scripts/build.ts'])`):
  - `'each built nano.json names only module files in its own folder, and they exist'` — for each name in todo, chat: every `modules` value matches `^\./[^/]+\.js$` and the file exists.
  - `'the built todo nano.json loads and runs'` — `Application.load(dist/todo/nano.json)`; `add('milk')` then `list()` titles `['milk']` in `example.todo.frontend`.
  - `'the built chat nano.json loads and runs'` — alice `say('hi')`, bob `transcript()` texts `['hi']`.
- [ ] **Step 2:** Run → FAIL (no build script).
- [ ] **Step 3:** Implement build, serve, workspace copy, Makefile target, gitignore.
- [ ] **Step 4:** `cd examples && bun test --isolate` → pass; `cd packages/ui-workspace && bun run build` → `public/examples/todo/nano.json` exists.
- [ ] **Step 5:** Commit `feat(examples): build each example like the template; served at /examples/<name>/`.

### Task 3: `<todo-list>`

**Files:** Create `examples/todo/todo/view.ts`, `examples/todo/index.ts`; modify `EXAMPLES.todo['example.todo']` → `'todo/index.ts'`; add `layout.slots` (`[{ id: 'todos', runtime: 'example.todo.frontend', pod: 'todos' }]`) to `todo/nano.json` (and to `build.test.ts`'s expected output if it compares).

**Interfaces:**
- Consumes: nano-ui `ViewTarget` (`{ app, registry, runtime, pod }`); a view reaches its pod via `target.app.runtime(runtime).get(TodoListDef.api, { pod })`.
- Produces: `index.ts` — `export default` the todo provider, `export const views = { 'example.todo/kv': 'todo-list' }`, defines `todo-list` if not defined.

- [ ] **Step 1:** `view.ts`: a Lit element (nano-elements `base` styles, like nano-ui's views) with a text box + Add, a list with a done checkbox and a remove button per todo; it loads `list()` on connect and re-lists on each `items` event (iterate `get(...).items()`; stop on disconnect).
- [ ] **Step 2:** `examples` tests still pass (headless source unchanged); `bun run build` in ui-workspace succeeds.
- [ ] **Step 3:** Commit `feat(examples): <todo-list>, the todo example's view`.

### Task 4: `<chat-room>`

**Files:** Create `examples/chat/room/view.ts`, `examples/chat/index.ts`; `EXAMPLES.chat['example.chat']` → `'chat/index.ts'`; `layout.slots` for alice and bob in `chatDeployment` (so `nano.json` stays generated = checked in).

**Interfaces:** `index.ts` — default the chat provider, `views = { 'example.chat/participant': 'chat-room' }`.

- [ ] **Step 1:** `view.ts`: header = the pod name; transcript on connect, then appends each `lines()` value; a box + Send calling `say`.
- [ ] **Step 2:** examples tests pass (chat equality test regenerated with slots); ui-workspace build succeeds.
- [ ] **Step 3:** Commit `feat(examples): <chat-room>, one per participant`.

### Task 5: The auth case study

**Files:** Create `examples/auth/{contract.ts,passkey.ts,view.ts,index.ts,nano.json,auth.test.ts}`; add `auth` to `EXAMPLES` as `{ 'example.auth': 'auth/index.ts' }` (the log is `nano.ui`, which every host already loads; headless tests register nano-ui's provider themselves).

**Interfaces:**
- `AuthDef` (namespace `example.auth`), interface `Auth`: `authenticate: Op.action(Type.String() /* purpose */, Result)`, `authenticated: Op.event(Result)`; `Result = { ok: boolean; purpose: string; at: string /* ISO */; credentialId?: string; reason?: string }`.
- `passkey.ts` — implementation `example.auth/passkey`, config `{ rpName?: string }`. Exported (example-only) `type Env = { credentials?: CredentialsContainer; sandboxed: boolean; confirm(purpose: string, caller: string): Promise<boolean> }` and `setEnv(env: Env)` for tests; default env: `sandboxed = globalThis.location?.origin === 'null' || !globalThis.navigator?.credentials`, `confirm` opens a `<dialog>` "*caller* wants to *purpose* — Authenticate with passkey?" (Approve / Cancel), `credentials = navigator.credentials`.
- Behaviour: sandboxed → `{ ok: false, reason: 'passkeys are not available in a sandbox' }`, no confirm, credentials untouched. Else confirm → cancel = `{ ok: false, reason: 'cancelled' }`; approve → `credentials.get({ publicKey: { challenge: random 32 bytes, userVerification: 'preferred' } })`, falling back to `create` when `get` rejects with `NotAllowedError` and no credential exists is not detectable — so: `get` first; on rejection `{ ok: false, reason: <error name> }`. A Register button in the view calls `create`. Success → `{ ok: true, credentialId: <base64url of rawId>, … }` and emits `authenticated` (a source fed by a queue). A call while another is pending → `{ ok: false, reason: 'busy' }`.
- `nano.json`: runtime `example.auth.main` with pods `auth` (`example.auth/passkey`), `log` (`nano.ui/log`), pipe `auth` `example.auth.Auth/authenticated` → `log` `nano.ui.Log/log`; `layout.slots` for both; `modules: { 'example.auth': './index.js' }` (source tests load via a headless path — see Step 3).

- [ ] **Step 1: Failing tests** `auth.test.ts` (inject `setEnv` with a fake `credentials` and `confirm`):
  - `'approved and a passkey given: ok, with the credential id, and authenticated reaches the log'`
  - `'cancelled at the modal: ok false, reason cancelled, no event, credentials untouched'`
  - `'the authenticator refuses: ok false with its error name'`
  - `'sandboxed: refused without a modal and without touching credentials'`
  - `'a second call while one is pending: busy'`
  - `'no result carries more than ok, purpose, at, credentialId, reason'` — `Object.keys` ⊆ that set.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Headless split: `passkey.ts` has no lit import (its default `confirm` builds a `<dialog>` with plain DOM only when called); `index.ts` adds the view. The source `nano.json` points `example.auth` at `./passkey.js`; the build maps it to `auth/index.ts`.
- [ ] **Step 4:** Run → PASS; `examples` all pass; extend `dist.test.ts`'s file-existence test to `auth`.
- [ ] **Step 5:** `view.ts` `<auth-passkey>`: Passkey and Register buttons, a status line of the last result.
- [ ] **Step 6:** Commit `feat(examples): auth, a passkey case study: works in the page, refuses in a sandbox`.

### Task 6: e2e — open each example in the workspace

**Files:** Create `e2e/examples.e2e.ts`.

- [ ] **Step 1: Tests** (import via the import dialog's URL field, as `slice.e2e.ts` does):
  - `'todo: add milk in <todo-list>, tick it'` — `/examples/todo/nano.json`; the panel shows `milk`, checked after the click.
  - `'chat: alice says hi, bob's window shows it'`.
  - `'todo and chat import side by side: no runtime clash'`.
  - `'auth: with a virtual authenticator, Register then Passkey; the log shows ok'` — CDP `WebAuthn.enable` + `addVirtualAuthenticator` (ctap2, internal, residentKey, userVerification); click Register, then Passkey, approve the modal; `nano-log` contains `"ok":true`.
- [ ] **Step 2:** `bunx playwright test` → all pass (existing 4 + these 4).
- [ ] **Step 3:** Commit `test(e2e): the examples, opened in the workspace`.
