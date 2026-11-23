# AGENTS.md: developing a nano project with `nano-app`

For an agent (or a person) working in a project built from the nano template. Writing pods and views is covered by the
project's own `AGENTS.md` (the template's: https://github.com/aaronp/nano-template/blob/main/AGENTS.md); this file is
only the loop around it: try the project in the real nano app, and keep what you did.

## Install and the script

Already in the template (the devDependency and the script `"test-nano": "nano-app nano.json"`); otherwise
`bun add -d @pritzlaff/nano-app` and add the script. Then `bun run test-nano`. Bun only.

`nano-app <nano.json> [--out dist] [--build "bun run build"]` builds once, serves the nano app and the project folder
(then `dist/`) on `127.0.0.1`, and opens the page. `PORT` picks the port (default: any free one), `NO_OPEN=1` skips
the browser (use it when you can't see one). While it runs it rebuilds when `src/` changes. `--build` is a
space-separated argv: no shell, no quoting.

## The loop

1. Write a pod and its headless test (see the project's `AGENTS.md`).
2. `bun test`. Fix it before going on: the app is for what a test can't show.
3. `bun run test-nano`. The app opens the project's `nano.json` as its whole document: nothing from the browser's storage.
4. In the app: place the pods, wire them (pipes), call them, look at the views.
5. File › Save.
6. Commit the `nano.json` (and the source).

Edit `src/` while the page is open: after a successful build the page reloads. If the document has unsaved changes it
shows "Rebuilt — Reload (unsaved changes are lost)" with Reload and Later instead: Save first, then Reload. A failed
build leaves the page as it was; the first line of the error is a toast in the page and is printed in the terminal.

## What Save writes

File › Save writes the whole host document back to the `nano.json` you started with: pods, runtimes, pipes and the
Desk (panels and layout), as a download would. The module paths the file had (`modules`) are put back exactly as they
were, so a saved file still loads from where it did. Download and Save as still download a copy and leave the file alone.

The file is the truth: what the app shows is what the file says, and a change you want to keep is a change in the file.
Edit it by hand if that is easier; the app picks it up on the next reload (a hand edit does not trigger a
rebuild, only `src/` is watched; `dist/nano.json` updates on the next build). The server writes only that one file and
nothing else.

## Publishing

One-time setup: the repository's Settings → Pages → Source: "GitHub Actions". The template's `pages.yml` then publishes
`dist/` to GitHub Pages on every push to `main`, so the app's URL is
`https://<owner>.github.io/<repo>/nano.json`. Anyone opens it in the hosted app with

```
https://aaronp.github.io/nano/?src=<published nano.json>
```

The link is from another origin, so the app opens its Import dialog on that URL, Sandboxed preselected, and the
dialog is the approval: Import adds the app, Cancel imports nothing. Put the link in the project's README. Hosted Import preselects Sandboxed, so views run in frames there; `test-nano` opens
the file as it is (as the file says), so they may look and behave differently.

## Without the package

Anything that serves `dist/` with CORS `*` works: `bun run serve` (the template's own, port 4000). Open the hosted app
with `https://aaronp.github.io/nano/?src=http://localhost:4000/nano.json`. You get the import and its approval, but not
Save to the file or the reload on rebuild: download from the File menu and replace `nano.json` yourself. An https page fetching localhost may be blocked or
prompted by the browser (mixed content, local-network access); it depends on the browser.

## Done means

`bun test` passes; `bun run build` succeeds; the pods you added were placed, wired and called in `bun run test-nano` and
did what you meant; the Saved `nano.json` is committed and `git diff` shows only changes you intended.
