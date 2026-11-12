# nano-inbox

An Inbox for nano hosts: **folders**, a message **list** and a **reader**, as components wired by ordinary
subscriptions (folders → list → reader). Same shape as `templates/nano-template`: a module plus a `manifest.json`,
imported by a host from the manifest's URL.

| Component | Id | Element | Ops |
| --- | --- | --- | --- |
| Folders | `nano.inbox/folders` | `<inbox-folders>` | `folders`, `current`, `select(folder)`, `setFolders(folders)`; event `selected(folder)` |
| List | `nano.inbox/list` | `<inbox-list>` | `messages`, `folder`, `shown`, `show(folder)`, `setMessages(messages)`, `open(id)`; event `opened(message)` |
| Reader | `nano.inbox/reader` | `<inbox-reader>` | `message`, `read(message)` |

A folder is its id (a string); a message is `{ id, folder, from, subject, date, body }`.

## Wire it

1. `make serve` (or `make serve-inbox` from the nano repo).
2. In a host, import `http://localhost:5175/manifest.json` (Trusted or Sandboxed).
3. Systems → **+ Add** `folders`, `list` and `reader`.
4. Connect `folders · selected → list · show` and `list · opened → reader · read`.
5. Open the three as panels.

The reader keeps showing its message after a folder switch: it shows what it is given.

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
