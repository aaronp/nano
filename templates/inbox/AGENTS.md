# AGENTS.md

How to work in this repository: an Inbox package of components for nano hosts (folders, a message list, a reader). `README.md` is the reference; this file
is what to do, and what not to.

## The shape of a package

- **A component holds the work.** It's a rune component (`component(id, factory, schemas)` from
  `@pritzlaff/nano-runes`): state, getters (read as source ops), functions (actions), and `event()`s it publishes.
  It knows nothing of the DOM, so it's tested without one.
- **Its element is a thin UI.** A `PlacedElement` (`@pritzlaff/nano-elements`) with `static component = …`: it
  `read`s ops, calls `act(op, arg)`, and shows `this.problem` when an action fails. No logic that the component
  could hold.
- **The catalog** (`src/index.ts`) lists each kind: its component, title and element tag. `define()` defines the
  elements. The manifest is generated from the catalog.

`src/folders.ts` + `src/folders-el.ts` is the worked example. Copy its shape. `src/sample-data.ts` holds the
folders and messages the components start with.

## Commands

```sh
bun install
make -C ../.. link-templates   # from this repo: use its packages, not the published ones
bun test          # must pass before you're done
bun run build     # dist/: index.js, manifest.json, index.html
bun run preview   # build and serve dist/ at http://localhost:4000 (the preview page, and manifest.json to import)
```

## Adding a component

1. `src/<thing>.ts`: the component. Its id is `<namespace>/<thing>`, in this package's namespace (here `nano.inbox/…`; a host refuses ids that clash with its own). The third argument has an entry for every
   member: a getter or event gets a typebox schema with a `description`; an action gets `{ in?, out?, description }`,
   with `in` carrying the bounds it needs (hosts call actions with untrusted values). Add `examples` wherever a value
   means something, and a `{ description }` fourth argument for the component. `test/described.test.ts` fails
   until every op is described: it is how the host's views (the Systems tree, the Detail card) explain your ops.
2. `test/<thing>.test.ts`: the component through a runtime, as `test/folders.test.ts` does (place it in a
   registry, call ops by `Ops.key(op)`, subscribe a spy to its events).
3. `src/<thing>-el.ts`: the element. `test/<thing>-el.test.ts`: render it in the happy-dom page (preloaded by
   `bunfig.toml`), click and type, and check the component's state, as `test/folders-el.test.ts` does.
4. `src/index.ts`: export both, and add the kind to `catalog` and its element to `ELEMENTS`. Tags need a dash.
5. Update the expectations in `test/build.test.ts` (the manifest's ops and the tags), and add the
   element to `preview/index.html`.

## Payloads

A folder travels as its id (a string); a message as the whole `{ id, folder, from, subject, date, body }`, so each
component stands alone and the reader needs no shared store. Bound every string and list.

## Porting a widget

Split it: state and behaviour go in the component (test them first, without a DOM); rendering and input go in
the element. Inputs a host may want to wire to other components become actions; things that happen become
`event()`s; values worth showing or connecting become getters. Then restyle it with the kit (below) rather than
carrying the widget's own CSS across.

## Rules

- **Imports.** Use only the shared packages a host provides (listed in `README.md`, "What a package may import":
  `@pritzlaff/nano-*`, `lit` and a few subpaths, `typebox`, `typebox/value`). Anything else gets bundled into
  `dist/index.js`; keep that small, and don't add a second copy of lit or typebox.
- **Styles.** Use `--nano-*` tokens, always with a fallback (`var(--nano-accent, #6FA8FF)`), never hard-coded
  colours or fonts alone, so the element takes on any host's theme. Start from `base` and `kit`
  (`@pritzlaff/nano-elements`: `.btn`, `.badge`, `.card`, `.field`, `.input-group`…) and its kit elements
  (`<nano-select>`, `<nano-date-picker>`, `<nano-data-table>`, `toast()`…) before writing CSS or widgets of your
  own.
- **No `<form>` submit.** A host may run your element in a sandboxed iframe, where forms are blocked and `submit` never
  fires: save on a button's click and on Enter instead.
- **Untrusted ids.** Ids and keys from data are compared (`===`, `includes`), never used as plain-object keys: use a
  `Map` or `Object.hasOwn`, as nano-template's `store.ts` does.
- **Accessibility.** Label inputs (`aria-label` or a `<label>`), use real `<button>`s, keep keyboard use working.
- **Don't edit** `dist/` (built), or `preview/themes.ts` (generated from the nano workspace's themes).
- **Don't change** a released component's id or ops without a new major version: hosts' saved connections name
  them.
- Keep files small and focused, and comment what a thing is for, not how it works.

## Done means

`bun test` passes, `bun run build` succeeds, and the preview (`bun run preview`) shows the new element working
in more than one theme (light and dark).
