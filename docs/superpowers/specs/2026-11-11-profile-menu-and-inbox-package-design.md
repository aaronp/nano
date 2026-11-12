# Profile menu, and Inbox as a package

## Why

`ui-workspace` is a white-label starter: a host that assembles components rather than owning features. The more of
the host page lives in components and web components, the more a different host app can reuse them — and the closer
we get to the next design, `nano.json` + `?src=<url>`: a generic host that loads its title, theme, pages, widgets,
packages and wiring from data, with each template repo's GitHub Pages redirecting to `nano?src=<its nano.json>`.

This design is the housekeeping before publishing 0.3.0, shaped so `nano.json` can drive it later:

1. **A profile menu** — an avatar at the top right whose entries are data. Systems and Themes move into it.
2. **Inbox as its own package** — `templates/inbox`, imported like `nano-template`; the host drops its built-in Inbox.

## Goals

### 1. Profile menu

- **`packages/shell`** (`@composable/shell`, private like `@composable/bundle`): a new home for host-page pieces
  that any host can reuse. Profile is its first resident (the nav and app bar may follow later; not now).
- **Component `nano.shell/profile`** (a rune component, typed and described like every other):
  - `user` — `{ name: string; avatar?: string }` (avatar: an image URL; without one, the element shows initials).
  - `entries` — `{ label: string; href: string }[]`, in order.
  - actions `setUser(user)`, `setEntries(entries)`.
- **Element `<nano-profile name="…">`** (a `PlacedElement`): an avatar button (image or initials) that opens a menu
  listing the entries as links; keyboard and screen-reader friendly (a real `<button>`, `aria-haspopup="menu"`,
  `aria-expanded`, Escape closes, focus returns to the button); `--nano-*` tokens only.
- **How the host fills it:** `@composable/shell` exports a `catalog` (kind `profile`) that the host merges into its
  own catalog like bundle and editor (host-only, `modes: ['host']`), so the profile shows in Systems and the wires view
  like any instance. `composable.ts` creates the instance `profile` (owner `{ kind: 'app', name: 'ui-workspace' }`)
  and calls `setUser`/`setEntries` on it, as it does for the `ex-*` examples; `<nano-profile name="profile">` attaches
  to it. The component's own defaults are an empty name and no entries.
- `@composable/shell` is a workspace package like `@composable/bundle` (`workspace:*` deps, `exports` its
  `src/index.ts`, a `defineShell()`); the host calls `defineShell()` beside `defineBundle()`.
- **This host** places `<nano-profile>` in the app bar's `actions` slot (where `<theme-picker>` is today) and fills it
  with data: a placeholder user (`{ name: 'You' }`) and entries **Systems** (`#/systems`) and **Themes** (`#/themes`).
- **`#/themes`** is a plain page like Settings (same header and panel style); the Settings blurb about themes moves
  with the cards.
- **Moved entirely**: the sidebar's Systems link is removed (the `#/systems` page stays, reached from the menu); the app
  bar's `<theme-picker>` is removed; the theme cards move from Settings into a new `#/themes` page. Settings keeps its
  Layout section and stays in the sidebar.

### 2. Inbox package

- **`templates/inbox`** mirrors `templates/nano-template`: its own `package.json` (name `nano-inbox`), `src/` with
  components and elements, `src/index.ts` catalog + `define()`, a generated manifest, `bun run build` → `dist/`
  (`index.js`, `manifest.json`, `index.html` preview), `bun run preview`, tests, `AGENTS.md`/`README.md`, and a
  `Makefile` with `serve` (default port **5175**). Its `node_modules/@pritzlaff/*` link to this repo's packages the
  same way the template's do. Those links are gitignored and were made by hand, so this design adds a repeatable
  step: `scripts/link-local.ts <dir>` replaces `<dir>/node_modules/@pritzlaff/nano-{core,runes,elements}` with symlinks
  to `packages/{core,runes,elements}` (after a normal `bun install` there), and a root `make link-templates` runs it
  for `templates/nano-template` and `templates/inbox`. Only the package layout is mirrored: no CI, mirror repo or
  `template-export` hook for inbox.
- **Three components** in the namespace `nano.inbox/…`, each with an element, wired by ordinary subscriptions:
  - **Payloads:** a folder is its id, a string (`'inbox'`, `'sent'`, `'archive'`; bounded); a message is the whole
    message `{ id, folder, from, subject, date, body }` (strings, bounded; `body` ≤ 20 000). Whole messages travel so
    each component stands alone: the reader shows what it's given and needs no shared store.
  - `nano.inbox/folders` (`<inbox-folders>`): the folders (`{ id, name }[]`), the selected id; actions
    `select(folder)`, `setFolders(folders)`; event `selected(folder)`. No unread counts (they would need the messages).
  - `nano.inbox/list` (`<inbox-list>`): the messages (seeded with the sample messages moved out of the host), the
    folder shown; actions `show(folder)` (what `selected` wires to), `setMessages(messages)` (so it isn't only a demo);
    event `opened(message)` when one is clicked.
  - `nano.inbox/reader` (`<inbox-reader>`): the message shown (or none); action `read(message)` (what `opened` wires to).
  - Typed and described, inputs bounded, no `<form>` (the template's rules apply).
- **The host drops** its Inbox page (`#/inbox` route and sidebar link), the `<mail-folders>`/`<mail-list>`/
  `<mail-reader>` widgets, their `mail:*` bus topics, the dock's "Messages" widget, and the mail sample data. Inbox is
  used by importing `http://localhost:5175/manifest.json` (or its Pages URL) into a workspace and wiring
  folders → list → reader.
- **Saved state:** a saved dock layout naming the removed "Messages" widget is already ignored by the dock (it only
  restores layouts whose widgets all still exist), so no migration; the `inbox` split-pane sizes key is simply unused.
  Tests and e2e that reference the Inbox page, mail widgets, the app-bar theme picker or the Systems nav link are
  updated or removed with them.
- **Root `Makefile`**: `serve-inbox` (like `serve-template`, `INBOX_PORT=5175`).

## Non-goals

- `nano.json`, `?src=`, pages-as-data, the Pages redirect (next design).
- A real signed-in user, or passkeys; the profile's user is a placeholder.
- Moving the nav, app bar or routing into `packages/shell`.
- Publishing `nano-inbox`, or a mirror repo / `template-export` for it.
- An Inbox page assembled in this host from the package (that is what `nano.json` will do).

## Testing

- shell: the component (set and read user and entries; inputs checked); the element (initials without an avatar,
  image with one; the button opens and Escape closes the menu, focus returns; entries render as links in order).
- host: the app bar has `<nano-profile>` with Systems and Themes; no Systems link in the sidebar; no theme picker in the
  app bar; `#/themes` has the theme cards; Settings keeps Layout; no `#/inbox` route, nav link, mail widgets or
  "Messages" dock widget.
- inbox: each component through a runtime (folders select/publish; list filters by folder and publishes opened;
  reader shows a message); each element in happy-dom; manifest and build tests; the three wired in one registry
  (select a folder → list shows it → open a message → reader shows it).
- e2e: importing the inbox package (trusted) and wiring folders → list → reader shows a message in the reader.

## Calls I made (check these)

- The new package is `packages/shell` (`@composable/shell`), private.
- Themes get their own `#/themes` page (moved from Settings); Settings stays in the sidebar with Layout.
- The profile's placeholder user is `{ name: 'You' }`.
- Inbox is three wired components, not one component with three views — the wiring is the point (it is what
  `nano.json` will describe).
- The profile's avatar: initials are the first letters of the first two words of `name`; an `avatar` must be an
  `http(s):` or `data:image/` URL, else initials are shown.
- Inbox payloads: folder ids and whole messages; `setFolders`/`setMessages` make the package reusable beyond the demo.
- `scripts/link-local.ts` + `make link-templates` make the templates' local links repeatable.
- Inbox's package and ids: `nano-inbox`, `nano.inbox/folders|list|reader`, tags `inbox-folders|list|reader`, port 5175.
