# AGENTS.md

How to work in this repository: a package of components for nano hosts. `README.md` is the reference; this file
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

`src/timer.ts` + `src/timer-el.ts` and `src/picker.ts` + `src/picker-el.ts` are the worked examples. Copy their
shape.

## Commands

```sh
bun install
bun test          # must pass before you're done
bun run build     # dist/: index.js, manifest.json, index.html
bun run preview   # build and serve dist/ at http://localhost:4000 (the preview page, and manifest.json to import)
```

## Adding a component

1. `src/<thing>.ts`: the component. Its id is `<namespace>/<thing>`, in this package's namespace (the examples use
   `nano.template/…`; a host refuses ids that clash with its own). Give every action that takes an argument a
   typebox schema in the third argument, with the bounds it needs: hosts call actions with untrusted values.
2. `test/<thing>.test.ts`: the component through a runtime, as `test/timer.test.ts` does (place it in a
   registry, call ops by `Ops.key(op)`, subscribe a spy to its events).
3. `src/<thing>-el.ts`: the element. `test/<thing>-el.test.ts`: render it in the happy-dom page (preloaded by
   `bunfig.toml`), click and type, and check the component's state, as `test/timer-el.test.ts` does.
4. `src/index.ts`: export both, and add the kind to `catalog` and its element to `ELEMENTS`. Tags need a dash.
5. Update the expectations in `test/manifest.test.ts` (its ops) and `test/build.test.ts` (the tags), and add the
   element to `preview/index.html`.

Removing the examples: delete their files, tests, catalog entries and preview sections together.

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
- **Accessibility.** Label inputs (`aria-label` or a `<label>`), use real `<button>`s, keep keyboard use working.
- **Don't edit** `dist/` (built), or `preview/themes.ts` (generated from the nano workspace's themes).
- **Don't change** a released component's id or ops without a new major version: hosts' saved connections name
  them.
- Keep files small and focused, and comment what a thing is for, not how it works.

## Done means

`bun test` passes, `bun run build` succeeds, and the preview (`bun run preview`) shows the new element working
in more than one theme (light and dark).
