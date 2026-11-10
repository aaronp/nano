# Themes and a component library for widgets — design

## Intent

The work and data of a widget live in its nano Component; the web component is a thin UI on top. That UI should take
on whatever host it is in, and a host should be able to ship a different UI (a "skin") over the same components and
the same connections. This change makes our widgets themeable, gives the workspace themes like the `adr` Decision
Ledger's, and adds a component gallery to see every primitive, layout and live widget under each theme.
Exporting a configured system (components and connections) to another host is the next step, not this one.

## Goals

1. **A token contract for widgets.** A small, documented set of CSS custom properties, `--nano-*`, that every nano
   element reads (custom properties cross shadow DOM), each with a fallback so an element still looks right in a
   host that defines none:
   - **surfaces:** `bg`, `surface`, `surface-2`, `border`, `border-strong`;
   - **text:** `fg`, `fg-2`, `muted`, `on-accent`;
   - **intent:** `accent`, `accent-soft`, `focus`, `good`, `good-bg`, `bad`, `bad-bg`, `warn`, `warn-bg`;
   - **type and shape:** `font`, `font-display`, `font-mono`, `radius`, `radius-s`;
   - **series:** `s1` … `s8` (charts and route colours).
   The contract is written down in `@pritzlaff/nano-elements`' README, with the gazette mapping as the example of a
   host with a different vocabulary.
2. **A component library in `@pritzlaff/nano-elements`.** Its shared `base` stylesheet becomes the library, every
   rule reading `--nano-*`, modelled on `adr`'s classes: buttons (`.btn` with `primary`, `danger`, `dashed`, `small`;
   `.icon-btn`), `.badge`, `.chip`, `.pill`, `.card`, `.alert` (`good`, `bad`), form `.field`, `.input`, `select`,
   `textarea`, `.meter`, `.table`, `.tabs`, list rows, `.kicker`, `.display-s/m/l`, `.mono`, `.muted`, and layout
   helpers (`.row`, `.col`, `.grid-auto`). Published as `0.2.0`.
3. **Our widgets use it.** The hard-coded colours go from the bundle elements (input, range, log, map/filter, debounce
   view), the platform tree, the editor, and the template's Timer; they use the library's classes and the tokens.
   The Debounce view keeps its look as fallbacks (its dark palette is the default when no host tokens are set).
4. **Workspace themes like `adr`'s.** The four Decision Ledger themes — **Graph paper**, **Night shift**,
   **Blueprint**, **Warm ledger** — join the workspace's themes, with their palettes, fonts and grid paper
   background, and every workspace theme maps onto `--nano-*` (in one place), so existing themes still work and
   widgets follow whichever is chosen.
5. **A Components gallery** (a nav page, also a dock widget, `<nano-gallery>`):
   - **Primitives:** every class in the library, in its variants and states (hover, focus, disabled, error).
   - **Type and colour:** the display scale, the token swatches, the series colours.
   - **Layouts:** the same content as a card grid, a list, a form, a dashboard row (stat cards + a chart), and a
     table — the arrangements a widget is likely to sit in.
   - **Live widgets:** real bundle components (range → debounce → log, input → map) running in the page.
   - **Compare themes:** the same sample side by side in every theme at once (tokens scoped to each column), and a
     single-theme view that follows the page's theme picker.
6. **Skins are a pattern, documented.** The template's README shows how a package ships a second element set over
   the same components (same ids and ops, so connections don't change); no new machinery.

## Non-goals

- Exporting a system's components and connections to another host (next step).
- Making the wiring view (`<c-wires>`) themeable: it is a dark "back of the panel" stage by design.
- Restyling the gazette or other starters.

## Anti-goals

- Widgets knowing which host or theme they are in; reading anything but `--nano-*`.
- A CSS framework or build step for styles: plain CSS in Lit's `css`.
- A file over ~200 lines (the library may split into a few stylesheets).

## Settled by Claude (check these)

- **The prefix is `--nano-`**, so a host's own variables never collide with the contract.
- **Fallbacks are the current dark look**, so a page with no theme (like the template's preview) looks as now.
- **`adr`'s colours are copied, not imported** (it is a separate repo); its fonts (Bricolage Grotesque, IBM Plex)
  are added to the page's font link.
- **The gallery lives in `ui-workspace`** (it shows the host's themes); the library lives in `nano-elements` (every
  package can use it), released as `0.2.0` with the template's dependency moved to `^0.2.0`.
- **Each Decision Ledger theme is single-scheme** (like Sketch): Graph paper and Warm ledger light, Night shift and
  Blueprint dark; the picker's light/dark choice doesn't apply to them.
- **The grid-paper background is a workspace extra** (a theme's optional page background), not part of the contract.
- **Mapping, in one place:** a `nanoVars(tokens, scheme)` derives every `--nano-*` from a workspace theme's tokens;
  tokens a theme doesn't define (`fg-2`, `good`/`bad`/`warn` and their backgrounds, `border-strong`, `radius-s`,
  `s1`…`s8`) come from shared defaults for its scheme, so the existing themes need no new data. The `adr` themes
  define them all. `TOKEN_NAMES` (what every theme must define) doesn't grow.
- **Compare-themes columns set only `--nano-*`** on each column (from `nanoVars`), and show only library classes and
  nano widgets, which read nothing else.
- **The gallery's live widgets attach by name to the worked example** (`ex-range` → `ex-debounce` → `ex-log`,
  `ex-input` → `ex-map`), as the Systems page does; no new wiring.
- **Migration scope:** `nano-elements`' `base`; the bundle elements and the Debounce view; the platform tree; the
  editor's elements. The template's Timer moves to the library on the template's own branch. Tests are behavioural,
  not snapshots, so they keep passing; the gallery gets its own.
- **The library keeps styling bare `button`, `input`, `select` and `textarea`** (as `base` does now) as well as
  adding the classes, so existing markup needs no edits to look right.
- **Release:** the version is bumped to `0.2.0` here; you publish it with `make publish`, then the template moves
  to `^0.2.0`.
