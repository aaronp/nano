# nano-inbox

An Inbox for nano hosts: **folders**, a message **list** and a **reader**, as components wired by ordinary
subscriptions (folders → list → reader). Same shape as `templates/nano-template`: a module plus a `manifest.json`,
imported by a host from the manifest's URL.

| Component | Id | Element | Ops |
| --- | --- | --- | --- |
| Folders | `nano.inbox/folders` | `<inbox-folders>` | `folders`, `current`, `select(folder)`, `setFolders(folders)`; event `selected(folder)` |

A folder is its id (a string); a message is `{ id, folder, from, subject, date, body }`. The list and reader come next.

## Develop

```sh
bun install
make -C ../.. link-templates   # from the repo: link @pritzlaff/nano-* to its packages (re-run after any `bun install`)
bun test           # the components, the elements, the manifest and the build
bun run build      # dist/: index.js, manifest.json, index.html
bun run preview    # build, then serve dist/ at http://localhost:4000
make serve         # build and serve dist/ with CORS on :5175 (PORT=… to change)
```

Use it from a host: open a workspace's Components drawer, click **Import**, and paste
`http://localhost:5175/manifest.json`.

A component is a rune component (state, getters, actions and `event()`s) from `@pritzlaff/nano-runes`; its element
is a `PlacedElement` from `@pritzlaff/nano-elements`. See `AGENTS.md` for the rules (styles, accessibility, no
`<form>` submit, what a package may import).

`dist/manifest.json`, `dist/index.js` (the module: `catalog` and `define()`; the shared packages stay bare imports)
and `dist/index.html` (a themed preview) are what `bun run build` makes. What a package may import:
`@pritzlaff/nano-core`, `-runes`, `-elements`, `lit` (and `lit/decorators.js`, `lit/directive.js`,
`lit/directives/{class-map,style-map,repeat,if-defined}.js`), `typebox`, `typebox/value`.
