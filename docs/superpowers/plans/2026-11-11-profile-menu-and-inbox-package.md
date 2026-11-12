# Profile Menu and Inbox Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A data-driven profile menu (`@composable/shell`'s `<nano-profile>`) holding Systems and Themes, and Inbox moved out of the host into an importable `templates/inbox` package of three wired components.

**Architecture:** `packages/shell` is a workspace package like `packages/bundle` (a rune component + PlacedElement + `catalog` + `defineShell()`); the host merges its catalog, creates a `profile` instance and fills it, and places the element in the app bar. `templates/inbox` mirrors `templates/nano-template` (own build, manifest, preview, tests, Makefile), linked to this repo's packages by a new `scripts/link-local.ts`. The host then drops its Inbox page, mail widgets and sample data.

**Tech Stack:** TypeScript, Bun, TypeBox, lit, runes, happy-dom, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-11-profile-menu-and-inbox-package-design.md`

## Global Constraints

- Branch `sandbox`; one commit per task; messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Every op typed and described (TypeBox `description`, `examples` where a value means something); action inputs bounded.
- Elements: `--nano-*` tokens with fallbacks, `base`/`kit` first, labelled inputs, real `<button>`s, keyboard works, no `<form>`.
- Ids/tags/ports exactly: `nano.shell/profile`, `<nano-profile>`, catalog kind `profile`; `nano-inbox`, `nano.inbox/folders|list|reader`, `<inbox-folders|inbox-list|inbox-reader>`, port 5175 (`make serve-inbox`, `INBOX_PORT`).
- Profile placeholder user `{ name: 'You' }`; entries `[{ label: 'Systems', href: '#/systems' }, { label: 'Themes', href: '#/themes' }]`.
- Inbox payloads: folder = id string (≤ 40); message = `{ id, folder, from, subject, date, body }` strings (id/folder ≤ 40, from/subject/date ≤ 400, body ≤ 20 000).
- Checks: `make test` (every package), `node_modules/.bin/tsc -p .`, `cd templates/<t> && bun test && bun run build`, ui-workspace `bun run build`; e2e via `make test-ui` (user runs it).

## Review Focus

1. An avatar URL that isn't `http(s):` or `data:image/` (e.g. `javascript:`) shows initials and never reaches `src` (Task 1 test).
2. The menu: Escape closes it and returns focus to the button; clicking outside closes it; an entry is a real link (Task 1 test).
3. A restored dock layout that names the removed "Messages" widget doesn't break the workspace (Task 5 test).
4. Inbox messages with HTML in `subject`/`body` render as text, not markup (Task 4 test).
5. `scripts/link-local.ts` run twice is idempotent and never touches anything but `node_modules/@pritzlaff/nano-*` (Task 3 test).

---

### Task 1: `packages/shell` — the profile component and `<nano-profile>`

**Files:** Create `packages/shell/{package.json,bunfig.toml,src/index.ts,src/profile.ts,src/profile-el.ts,test/dom.ts,test/profile.test.ts,test/profile-el.test.ts}` (copy `packages/bundle`'s package.json/bunfig/test/dom.ts shape). Modify `$TMPDIR/all.sh` is not in the repo — no change; `make test` picks up the new package automatically.

**Interfaces — Produces:** `Profile` (rune component `nano.shell/profile`: getters `user` `{ name: string; avatar?: string }`, `entries` `{ label; href }[]`; actions `setUser(user)`, `setEntries(entries)`; description); `ProfileEl` (`PlacedElement`, `static component = Profile`); `catalog = { profile: { component: Profile, title: 'Profile', tag: 'nano-profile' } }`; `defineShell()`; `initials(name: string): string`; `safeAvatar(url?: string): string | undefined`.

- [ ] **Step 1: Failing tests** — component: `starts with no name and no entries`; `setUser and setEntries replace them`; `inputs are checked (name ≤ 80, label ≤ 40, href ≤ 400, at most 20 entries)`. Helpers: `initials('Ada Lovelace') === 'AL'`, `initials('You') === 'Y'`, `initials('') === '?'`; `safeAvatar` keeps `https://…` and `data:image/png;…`, drops `javascript:…`, `data:text/html…`, `''`. Element: `shows initials without an avatar and the image with one`; `a javascript: avatar shows initials` (Focus 1); `the button opens the menu (aria-expanded true) listing entries as links in order`; `Escape closes and focus returns to the button; a click outside closes` (Focus 2).
- [ ] **Step 2: Run** `cd packages/shell && bun test` — Expected: FAIL (module missing; then stub exports so assertions fail).
- [ ] **Step 3: Implement** per the spec "1. Profile menu". `bun install` at the root to register the workspace package (network env + `registry.npmjs.org` if it fetches).
- [ ] **Step 4: Run** `make test` and `node_modules/.bin/tsc -p .` — Expected: all pass, tsc clean.
- [ ] **Step 5: Commit** `feat(shell): @composable/shell with a profile component and <nano-profile>, an avatar menu whose entries are data`

### Task 2: The host gets the profile menu; Systems and Themes move into it

**Files:** Modify `packages/ui-workspace/package.json` (dep `@composable/shell: workspace:*`), `src/composable.ts` (merge `shell` catalog with `modes: ['host']`, `trust: 'trusted'`; `defineShell()`; create `profile` and call `setUser`/`setEntries`), `public/index.html` (`<nano-profile name="profile" slot="actions">` replaces `<theme-picker slot="actions">`; remove the Systems nav link; new `<app-route path="/themes">` with the theme cards and the blurb moved from Settings; Settings keeps Layout). Tests: `packages/ui-workspace/test/host.test.ts`, `test/theme-picker.test.ts`, `test/nav.test.ts` / `test/page.test.ts` as affected.

**Interfaces — Consumes:** Task 1's `catalog`, `defineShell`, `Profile.ops`.

- [ ] **Step 1: Failing tests** — host: `the app bar holds <nano-profile> showing Systems and Themes, and no theme picker`; `the sidebar has no Systems link; #/systems still exists`; `#/themes has the theme cards; Settings keeps Layout and no theme picker`; `the profile instance is in the host system, owned by the app, labelled nano/deploy host`.
- [ ] **Step 2: Run** `cd packages/ui-workspace && bun test test/host.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.** Update any existing tests that assert the old app-bar picker or the Systems nav link.
- [ ] **Step 4: Run** `make test`, tsc, `cd packages/ui-workspace && bun run build` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui-workspace): a profile menu in the app bar holds Systems and Themes (a #/themes page); both leave the sidebar and app bar`

### Task 3: `templates/inbox` scaffold, local links, and the folders component

**Files:** Create `scripts/link-local.ts`, `scripts/link-local.test.ts` (or a test beside it the root `make test` doesn't need — run with `bun test scripts/link-local.test.ts`); root `Makefile` (`link-templates`, `serve-inbox`); `templates/inbox/` copied in layout from `templates/nano-template/` (package.json `nano-inbox`, bunfig, tsconfig, `.gitignore`, `scripts/build.ts` + `scripts/serve.ts`, `preview/index.html`, `AGENTS.md`/`CLAUDE.md`/`README.md` rewritten for Inbox, `Makefile` with `serve` on 5175, `test/dom.ts`, `test/described.test.ts`), `src/folders.ts`, `src/folders-el.ts`, `src/sample-data.ts` (FOLDERS and MESSAGES moved from `packages/ui-workspace/src/widgets/sample-data.ts`, converted to the payload shape), `src/index.ts` (catalog with `folders` only for now), tests `test/folders.test.ts`, `test/folders-el.test.ts`.

**Interfaces — Produces:** `linkLocal(dir: string, repo: string): string[]` (returns the links made); `Folders` (`nano.inbox/folders`: getters `folders` `{ id; name }[]`, `selected` string; actions `select(folder)`, `setFolders(folders)`; event `selected(folder)`), `<inbox-folders>`.

- [ ] **Step 1: Failing tests** — link-local: `links node_modules/@pritzlaff/nano-{core,runes,elements} to packages/{core,runes,elements}`; `running it twice changes nothing`; `touches nothing else in node_modules` (Focus 5). folders: `starts with Inbox, Sent, Archive and inbox selected`; `select publishes selected; an unknown folder is refused`; `setFolders replaces them, keeping the selection if it still exists`. element: `lists folders as buttons, the selected one aria-current; clicking selects`.
- [ ] **Step 2: Run** `bun test scripts/link-local.test.ts` and, after `cd templates/inbox && bun install && make -C ../.. link-templates`, `bun test` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `cd templates/inbox && bun test && bun run build` and `make test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(inbox): templates/inbox — a package like nano-template, with folders; scripts/link-local.ts makes the templates' local links repeatable`

### Task 4: Inbox list and reader, wired

**Files:** Create `templates/inbox/src/{list.ts,list-el.ts,reader.ts,reader-el.ts}`, tests `test/{list,list-el,reader,reader-el,wired,manifest,build}.test.ts`; modify `src/index.ts` (all three kinds), `preview/index.html` (the three, wired in the preview page's registry).

**Interfaces — Consumes:** Task 3's `Folders`, sample data. **Produces:** `List` (`nano.inbox/list`: getters `messages`, `folder`, `shown` (messages in the folder, newest first); actions `show(folder)`, `setMessages(messages)`, `open(id)`; event `opened(message)`), `Reader` (`nano.inbox/reader`: getter `message` (or null); action `read(message)`), elements `<inbox-list>`, `<inbox-reader>`.

- [ ] **Step 1: Failing tests** — list: `shows the inbox folder's messages, newest first`; `show(folder) switches`; `open(id) publishes the whole message; an unknown id is refused`; `setMessages replaces them; inputs are bounded`. reader: `starts empty; read shows a message`. elements: `list renders rows as buttons; clicking opens`; `reader renders from, subject, date, body`; `HTML in subject and body renders as text` (Focus 4). wired: `in one registry, folders.selected → list.show and list.opened → reader.read: selecting Sent then opening a message shows it in the reader`. manifest/build: the three kinds, ids, tags and ops.
- [ ] **Step 2: Run** `cd templates/inbox && bun test` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun test && bun run build` (in templates/inbox), `make test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(inbox): list and reader, wired folders → list → reader; the preview shows them together`

### Task 5: The host drops its Inbox; an e2e imports the package instead

**Files:** Modify `packages/ui-workspace/public/index.html` (remove the `#/inbox` route and nav link, the "Messages" dock template), `src/widgets/widgets.ts` (remove `MailFolders`, `MailList`, `MailReader`, their definitions and `mail:*` use), `src/widgets/sample-data.ts` (remove FOLDERS/MESSAGES/`Message` if nothing else uses them), affected tests (`saved-workspaces.test.ts` etc.); `playwright.config.ts` (a third web server: `make serve-inbox INBOX_PORT=5211`); `e2e/inbox.e2e.ts`.

**Interfaces — Consumes:** Task 4's package; Task 2's host.

- [ ] **Step 1: Failing tests** — host: `no #/inbox route, nav link, mail widgets or Messages dock widget`; `a saved layout naming "messages" is ignored and the default workspace opens` (Focus 3). e2e (written now, run by the user): `importing the inbox package (trusted), adding folders/list/reader, wiring folders.selected → list.show and list.opened → reader.read, then choosing Sent and opening a message shows it in the reader`.
- [ ] **Step 2: Run** `cd packages/ui-workspace && bun test` — Expected: FAIL on the new host tests.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `make test`, tsc, ui-workspace `bun run build`, `bunx playwright test --list` (5 tests) — Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui-workspace): Inbox leaves the host — import templates/inbox instead (an e2e does)`
