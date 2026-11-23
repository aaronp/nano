# Nano docs: concepts and recipes

Board: t-09 (roadmap), t-10 (this). Reference for "what good looks like": https://elysiajs.com/at-glance.html.

## Intent
Show nano simply, one concept at a time, the way Elysia's "at a glance" does, to someone who has never seen it; and,
by writing it, find where nano is harder than it should be. The docs build up one working example that ends as the
installable nano-template: a micro-repo a host loads by URL (roadmap 1–3 together). Later the docs carry the case
studies (Privy, Cloudflare, Kerits wallets).

**Goals**
- A reader goes from nothing to a packaged, loadable component by reading in order, each page one concept.
- Every code sample on a page is a region of a real, tested file (never pasted), so the docs cannot go stale.
- Every runnable sample has "Open in nano": the published app with `?src=<its nano.json>` (the import that exists).
- Published with the app on GitHub Pages.
- A list of the friction found while writing (each a board card under t-09), the second deliverable.

**Non-goals (this step):** `bun create nano` (t-11); a landing page and moving the app to `/app` (decided later);
the case studies; API reference generated from types; versioned docs.

**Anti-goals:** docs that restate the spec or design.md (link to them); samples that only run in the docs; a
framework or concept the docs invent that nano does not have (no concept drift: a gap is reported, not papered over).

## Approaches
- **Running example** (user chose A): (A) grow the template's own example (timer, store, the pipe between them),
  ending at the template exactly; (B) a new small domain (notes/todo), friendlier but a second example to keep alive;
  (C) a toy Signer/Vault, leading to the wallets but the crypto distracts from the basics.
- **Site** (user chose 1): (1) VitePress, as Elysia uses: nav, search, dark mode, code groups, and region embeds of
  real files (`<<< @/…/timer.ts#pod`); a docs-only dependency kept in its own folder; (2) our own Markdown → HTML Bun
  script: no framework, but we build nav, highlighting and search, plainer; (3) docs as pages inside nano: live, but
  coupled to the app and hard to make read like Elysia.

## The docs
Two parts (user's shape): **Concepts**, built in order on the template's example, then **Recipes**, each one thing
we already have, shown on its own.

**Concepts** reveal the finished template a piece at a time (user's choice; not step projects grown in stages):
each page embeds the region of the final file it is about, so the template is the one source. Each page: a short
why, the code region, what it does when run, "Open in nano" where it runs.
1. At a glance: the whole template in one screen, what each part is, a link to each page below.
2. Interfaces: an interface and its ops as values (the template's `Timer`, `Entry`; `src/interfaces.ts`).
3. Implementations and providers: an implementation of `Timer`, the provider that names it (`src/timer.ts`, `src/index.ts`).
4. Pods and deployments: pods as values, runtimes, `nano.json` (the template's).
5. Wiring: a pipe from an event to an action (`picker.changed` → `store.set`), and dependencies (call edges).
6. Running it headless: assemble + `Application` in a test (`test/pods.test.ts`), the template's own way.
7. Views: a web component on a pod (`<nano-timer>`), plain and with nano-elements' styles and themes.
8. In the host: serve the build, import it by URL (File › Open, `?src=`), place pods on a page.
9. Isolation: the same pod sandboxed (`isolation`), what changes and what does not.
10. Packaging and publishing: `bun run build` (`dist/index.js`, `dist/nano.json`), the template as its own repo
    (template-export), loading it from that repo's Pages URL.

**Recipes** (each: what it shows, the regions, Open in nano):
- A timer whose view subscribes to its own pod's events (the template's timer).
- input → debounce → map → log: a pipeline of built-ins with no code of one's own (`examples/slice`).
- Using the host from a component: a pod depending on the host's pods (`HostDeploy`), as Raft's cluster does.
- Components that deploy components: the Raft cluster creating and removing node runtimes (`examples/raft`).

## Decided by me (correct me)
- **Where:** a `docs-site/` folder at the repo root (`docs/` holds the ADRs, board and specs), its own
  `package.json` with VitePress pinned to an exact version; `make docs` (dev server) and `make docs-build`.
- **Snippets:** `// #region <name>` / `// #endregion` markers in the template's and examples' files, embedded with
  VitePress's `<<<` import. The template and examples are already tested in CI, so a sample that breaks fails there.
  The markers are comments only; a file's code does not change for the docs, except where a gap says it should.
- **Publishing:** the Pages workflow builds the docs into `packages/ui-workspace/public/docs/` (VitePress `base`
  `<pages base>/docs/`), so the site is the app at its root as now, the docs at `/docs`, the examples at
  `/examples`. Moving the app to `/app` with a landing page later changes only paths.
- **Open in nano:** a small Vue component (`<OpenInNano src="examples/slice/nano.json"/>`) making the app's URL
  with `?src=`, relative to the site, so it works locally and on Pages. The template's own build is served for it
  at `/examples/template/nano.json` (the host build already copies it there).
- **Look:** VitePress's default theme, its accent set to nano-elements' accent; no custom theme work in this step.
- **Order of work:** the site skeleton, publishing and Open in nano first with page 1; then Concepts 2–10; then the
  Recipes. Each page's friction is a board card as it is found, not fixed in the same step unless trivial.

## Settled after the builder check (my calls)
- **Which template:** the in-repo `templates/nano-template`; its region markers are exported with it (comments,
  harmless, and they show a reader of the template where each page's code is). It is checked in CI by
  `scripts/template-check.ts` against this commit's libraries.
- **A missing region fails the build:** a small check (`docs-site/scripts/check-regions.ts`, run by `docs-build`) that
  every `<<<` embed names a file and region that exist; VitePress alone would not fail on one.
- **Install and CI:** `docs-site/` is outside the Bun workspaces (`packages/*`, `examples`), with its own lockfile;
  pages.yml gets a step after the host build: `cd docs-site && bun install --frozen-lockfile && bun run build`.
  VitePress is pinned exactly.
- **Paths:** the docs build into `packages/ui-workspace/public/docs/` (gitignored like the other build outputs),
  after the host build (whose clean step does not touch `docs/`). VitePress `base` is the Pages base path plus
  `docs/` (`/docs/` locally and on a pull request). Open in nano makes the app's URL from that base (its parent) and
  `?src=` from the same root: `<root>?src=<root>examples/<name>/nano.json`; each link is checked in a browser test
  (`e2e/`), template, slice and raft included.
- **Isolation page:** embeds a tested example that uses it (`examples/originkey`'s `nano.json`) rather than new code.
- **Size limits:** the structure test (150 lines a file) covers `packages/*/src` and `examples/`, not the template;
  markers add two lines a region, so they are kept few, and an example file at its limit gets none rather than a split.
- **Friction:** each gap found is a card on the board (`docs/board/board.md`, parent t-09) as it is found.

## Constraints
- CLAUDE.md holds: no new exports, public methods or options for the docs' sake; a gap is a question for the user.
- The VitePress dependency lives only in `docs-site/`; the packages' builds and tests do not depend on it.
- The root `bun test` is never run (CLAUDE.md); the docs build is checked by `make docs-build` in CI.

## Left to the builder
Page wording and length (short: Elysia's pages are a screen or two), which regions each page embeds, sidebar
labels, and the Vue component's markup.
