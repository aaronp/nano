# The nano dev kit: `test-nano` and a guide agents can follow

Board: t-09 (roadmap), t-11 (`bun create nano`). Reference: the `agile` tool in this repo (`agile/bin/agile.mjs`):
a published package whose bin serves the app with the project's folder beside it on loopback, Save writing the file
back, and the hosted app loading a published copy by `?src=`. First of two projects; the second is a suite of
signers (MetaMask, Privy, Fireblocks…) behind one interface, the case study that exercises this kit.

## Intent
Someone (very often an agent) working in their own repo on a nano component should be able to read one shipped file,
build the component, and run `test-nano`: the nano app opens locally with their `nano.json`, they place, wire,
configure and call their pods, Save writes the arrangement back to `nano.json`, and a code change in their editor is
rebuilt and shown. Once published (their own Pages site), a link `https://aaronp.github.io/nano/?src=<their nano.json>`
opens the published version in the hosted app.

**Goals:** a one-line install and one script; the same app as the hosted one, at a version that matches the libraries
the project builds against; Save to the project's file, not a download; a guide an agent can follow end to end (make
a pod, test it headless, see it in nano, publish); the hosted app opening any project by link.
**Non-goals:** editing source code inside nano (the project's own editor does that); a hosted dev service; the signing
suite (next project); a landing page.
**Anti-goals:** the dev server reachable from anything but the local machine, or writing any file but the opened
`nano.json`; a crafted link running foreign code without the user's approval; a second guide that restates the
template's `AGENTS.md`.

## Approaches
- **How `test-nano` gets a nano app** (user chose A): (A) publish the built nano app with a small CLI, as agile is
  published: same-origin import, no prompt, Save writes back, no network, versions in step; costs a new package and
  the app learning to save to a file. (B) no package: serve `dist/` and open the hosted app with a cross-origin
  `?src=`: almost free once cross-origin `?src=` lands, but a prompt on every open, no write-back, needs the network,
  and the hosted app's version may differ. B stays as the documented fallback.
- **Cross-origin `?src=`** (user chose yes): the hosted app accepts a `?src=` on another origin, through the same
  approval prompt as File › Open/Import (sandboxed by default). Today only a same-origin `?src=` is accepted.

## Design (as decided)
1. **Cross-origin `?src=`.** On load, a same-origin `?src=` imports as today (as the file is, no prompt). Another
   origin's `?src=` goes through the Import flow's approval (the Trust choice, Sandboxed the default, foreign modules
   asking before they run); declining imports nothing. The `?src=` is removed from the address after it is handled,
   as today. The template README's "Open it in nano" note changes: a fork's own Pages URL works too.
2. **The package** `@pritzlaff/nano-app`. A new published package holding the built nano app (what Pages serves at the app root, without the
   docs site) and a CLI. It is released with nano-core, nano-elements and nano-ui at the same version
   (`scripts/build-packages-list.ts`, `scripts/version.ts`, `make bump-*`, `publish.yml`), so the app's built-in
   libraries match the version a project installs.
3. **`test-nano`.** In a project: `bun add -d @pritzlaff/nano-app` and a script `"test-nano": "nano-app nano.json"`. The CLI:
   - serves the app and the project on `127.0.0.1` only (Host header checked against loopback names, as agile does);
   - opens the browser at the app with that `nano.json` (`NO_OPEN=1` skips, `PORT` picks the port);
   - resolves the `nano.json`'s relative `modules` against the built output (the template's `nano.json` names
     `./index.js`, built into `dist/`);
   - watches the project's sources, runs its build (default `bun run build`) on a change, and tells the page;
   - accepts a write of that one `nano.json` only (an existing file, whole file or nothing, no CORS so another
     site's page cannot write it).
4. **The app, opened by the CLI.** The file on disk is the truth: each open and each reload opens the project's
   `nano.json` as the whole document, and nothing is read from or kept in the browser's stored document under the
   CLI (so two projects on one port never mix). File › Save writes the whole host document back to that file instead
   of downloading. A rebuild reloads the page (ES modules are cached by URL; a reload is the honest way to new code);
   with unsaved changes it shows "Rebuilt — Reload (unsaved changes are lost) / Later" instead.
   **The file's own text survives Save:** the `modules` entries the file already had are written back exactly as they
   were (e.g. `./index.js`), never the URLs the app resolved them to; only modules added in the session are new.
   The template's `scripts/build.ts` learns to read `modules` inside the document's `app` as well as at the top
   level, so its `PUBLIC_URL` rewrite keeps working on a saved file.
5. **The guide.** An `AGENTS.md` shipped in the package: install, the script, the loop (write a pod and its headless
   test → `bun test` → `bun run test-nano` → place, wire, call → Save → publish → the `?src=` link), what "done"
   means, and the fallback (B). It points to the template's `AGENTS.md` for how pods and views are written rather
   than restating it. The template itself gains the dev dependency, the `test-nano` script and a line in its
   `AGENTS.md`/README.

## Constraints
- No new nano-core exports or concepts. The app's new behaviour is a host concern (ui-workspace and the host core).
  New exported names are the user's call (CLAUDE.md).
- Files ≤150 lines; design.md names every new export.
- The dev server: loopback only; serves only the app and the project folder; writes only the opened `nano.json`.
- Works on macOS and Linux with Bun; Node runs the bin as agile's does (or Bun only, the builder to say which).
- Tests: the CLI's serving and write rules unit-tested; an e2e opening the template through the CLI, placing and
  calling a pod, saving, and seeing the file changed; the cross-origin `?src=` prompt (accept and decline) in e2e.

## Settled after the builder check (my calls)
- **Release:** the app joins the lockstep release through a sibling list beside `PUBLISHED` (which also feeds the
  libraries' peer-version logic), with its own branch in `build-packages`/`publish.yml` (the app is built, not
  bundled from `src/index.ts`) and in `version.ts`'s default list. Version drift between a project's libraries and
  the app is already warned of by the app (`newerCore`, `built.ts`).
- **Bun only** for the bin: the default build is `bun run build` and the template is Bun throughout.
- **Serving `modules`:** the CLI serves the project folder and the build output so the file's relative `modules`
  resolve to the built bundle without rewriting the file's text (e.g. `nano.json` at the root, `./index.js` served
  from `dist/`).
- **Tests:** the e2e builds the package from this commit (as `template-check.ts` links the libraries), not from npm.

## Left to the builder
How the app learns it was opened by the CLI and where it saves (e.g. a small endpoint the CLI serves), how a rebuild
reaches the page (polling, server-sent events…), which parts of the built app the package leaves out, the watch
mechanism, and the CLI's flags beyond the nano.json path.
