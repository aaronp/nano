# nano.json: New, Open, Import, Save, Save As, Download

## Why

The host is a white-label starter. Its value is the components and their arrangement, not its own pages — so the
whole working app should be data: which packages are imported, which systems exist with which instances (deployed
how, configured how, wired how), the workspaces and their order, the theme and title. With that data:

- a person can keep several apps in their browser and switch between them (New / Open / Save / Save As);
- an app can be shared as a file or a link (`Download`, `?src=<url>`), and a template repo's GitHub Pages can
  redirect to `nano?src=<its nano.json>`;
- another host app with a different layout can load the same data and place the same components.

The reference for the Open experience is the ADR project (`adr/src/ui/components/OpenDialog.tsx`): a native
`<dialog>` that opens a file by drop, by file picker, or from a URL; `?src=` wins over what's stored; a file loaded
from `?src=` is never autosaved over local work.

## Goals

1. **`nano.json`** — one versioned, validated document describing an app (below).
2. **A File menu** to the right of the app title: **New, Open…, Import…, Save, Save As…, Download**.
3. **`?src=<url>`** opens a `nano.json` on load, like Open.
4. **Component configuration** through an opt-in convention: a `config` getter and a `configure(config)` action.
5. **Saved workspaces are top-level nav items**, in an order the user sets, and that order is part of `nano.json`.

## Non-goals

- Pages as data (today's fixed pages stay: Overview, Systems, Components, Themes, Settings).
- Recorded setup calls in `nano.json` (a possible later hand-written extra).
- Saving to a server, or writing back to a URL.
- Merging conflicting edits (Import never overwrites; Open replaces).

## Anti-goals

- A `nano.json` from a URL or file silently running code in the host: packages it lists are never imported as
  *trusted* without the person confirming.
- Losing someone's work: Open never discards unsaved changes without asking; `?src=` never overwrites a saved app.

## Design

### The document (`nano.json`, version 1)

A TypeBox schema (`NanoAppSchema`) in a new `packages/shell/src/app.ts`, so any host can read and write it:

```
{
  nano: 1,
  title: string,
  theme?: string,                                   // a theme id the host knows; unknown → the host's default
  profile?: { user: { name, avatar? }, entries: [{ label, href }] },
  imports: [{ url: string, trust: 'trusted' | 'sandboxed' }],
  systems: [{
    id: string,
    instances: [{ id, kind, mode?: 'host' | 'sandbox' | 'isolated-sandbox', allow?: string[], deny?: string[], config?: unknown }],
    subscriptions: [{ source, op, listener, target }],
  }],
  workspaces: [{ id, title, system, layout }],      // in nav order; layout = the dock's saved layout JSON
}
```

- Every field is bounded (strings, list lengths, overall size ≤ 1 MB) and validated before anything is applied; a
  document that fails validation is refused with the reason, and nothing changes.
- Instances of kinds the host doesn't have (an import failed, or a package isn't listed) are skipped with a note,
  as are subscriptions whose ends are missing. The rest still loads.
- The host's own built-in instances (`platform`, `registry`, the `ex-*` examples, `profile`) are not written to
  `systems`, and their ids are reserved: an incoming instance with one is skipped with a note. User instances in the
  host system are written under a `host` entry in `systems` (the built-ins excluded).
- `workspaces[].id` is the saved workspace's path (`/…`); its `icon` is included; `layout` is the dock's saved layout
  JSON as the dock stores it. A layout naming a widget the host doesn't have is kept but ignored by the dock, as today
  (the default layout opens).
- `profile.entries[].href` follows the profile component's own allowlist (`#`, `/`, `http(s):`, `mailto:`); a
  document breaking it is refused.

### Component configuration: `config` / `configure`

- A component opts in by offering a getter named `config` and an action named `configure` (op names, in any
  namespace). `config`'s schema and `configure`'s input are the same; it is whatever the component needs to be
  recreated.
- **Save** reads `config` from every instance that offers it. **Open/Import** creates the instance, then calls
  `configure(config)`; an error is a note, not a failure.
- The bundle's components with settings opt in (at least: map's code, input's kind, debounce's interval, range's
  bounds and value — the builder checks which have settings); so do the template's Store (its entries) and the
  inbox's list (its messages) and folders (its folders).

### The File menu

- **`<nano-file-menu>`** in `packages/shell`: a button "File" next to the title (the app bar's title slot), opening
  a disclosure list of commands (like `<nano-profile>`: keyboard, Escape, outside click). Each command dispatches a
  `file:<command>` event (`file:new`, `file:open`, `file:import`, `file:save`, `file:save-as`, `file:download`); the
  host does the work. Save is disabled while the app is unchanged since its last save.
- **New** — an empty app: no imports, no user systems or workspaces beyond the host's built-ins, default theme,
  title "Untitled". Asks first if there are unsaved changes.
- **How Open applies a document:** imported packages can't be unloaded, so Open (and New) stores the document as the
  app to start with and **reloads the page**; on start-up the host applies it in order — title, theme, profile;
  imports (awaited); systems; instances (deployed with their mode and guard selectors, then `configure`); then
  subscriptions; then workspaces (whose layouts name instances that now exist). Import doesn't reload: it applies the
  new parts in the same order to the running app.
- **Open…** — a dialog like the ADR one: drop a `nano.json`, choose a file, or enter a URL; the browser's saved apps
  are listed too, to open by name. Replaces the current app (after asking about unsaved changes, and after the
  imports confirmation below).
- **Import…** — the same dialog; *adds* what is new: imports not already present; systems that don't exist; within a
  system (new or existing), instances whose ids are free and subscriptions whose ends exist; workspaces whose path is
  free. Anything that clashes is skipped and listed. Title, theme and profile are left alone.
- **Mode after the confirmation:** an instance whose kind ends up sandboxed (its package imported sandboxed) but whose
  `mode` is `host` or `sandbox` is deployed `isolated-sandbox` instead, with a note.
- **Imports confirmation** (Open, Import, `?src=`): before loading, a list of the packages the document wants, each
  with the trust it asks for; *trusted* ones are unchecked by default and must be ticked to stay trusted, otherwise
  they are imported sandboxed. Packages already imported are shown as such. Cancel changes nothing.
- **Save** — writes the current app to its name in this browser. An app with no name yet (New, opened from a URL or
  `?src=`, or a file) prompts for one (Save As).
- **Save As…** — asks for a name and saves under it in this browser; that becomes the current app's name.
- **Download** — the current app as `<name or title>.json`.
- **Title:** a new store `nano.title` sets the app bar's title and `document.title`; the host's default is "Nano";
  New sets "Untitled". **Theme:** an id the host doesn't know falls back to its default, with a note.
- **Storage full:** a quota error on Save/Save As says so and changes nothing.

### Browser storage

- **A working copy (the user's choice):** the current app is kept continuously in this browser as
  `localStorage['nano.working']` (a `NanoApp`), rewritten (debounced, ~500 ms) whenever it changes — an instance
  added, removed, reconfigured (a `config` value changed), wired or unwired; a workspace added, removed, reordered or
  re-laid out; the theme, title, profile or imports changed. A reload restores it exactly (applied on start-up as
  Open applies a document). This changes today's behaviour: instances added in Systems now survive a reload.
- "Unsaved changes" means the working copy differs from the named app it was last saved as or opened from (or there
  is no name yet). Save copies the working copy to its name; Save As to a new one.

- Saved apps: `localStorage['nano.apps']` = `{ [name]: NanoApp }`; the current app's name in `nano.app`.
- Today's stores (imports, saved workspaces, dock layouts, theme) stay as the live state the host already uses; the
  working copy is built from them plus the platform's live systems, and written back to them on start-up.
- **`?src=<url>`** (absolute or relative to the page): on load, if the working copy has unsaved changes it is first
  kept as a saved app named `Before opening <url host + path>` (deduplicated); then the document becomes the working
  copy, after the imports confirmation; the `?src=` is then removed from the address bar, so a reload restores the
  working copy rather than fetching again. A `?src=` app
  has no name until saved, so it never overwrites a saved app.

### Workspaces in the nav

- Each saved workspace is a top-level nav item (where the "Workspaces" group is today), in the app's order; the
  "+" (new workspace) and the components-drawer toggle stay with them.
- Reorder by dragging an item, or with Alt+↑ / Alt+↓ while it's focused; the order is stored with the saved
  workspaces and written to `nano.json`'s `workspaces` order.
- The built-in "Main" workspace stays first and isn't reorderable (it's the host's, not the app's) — it is not
  written to `nano.json`.

## Testing

- `NanoAppSchema`: a full document round-trips; bounds and the 1 MB cap refuse oversized input; unknown fields are
  dropped; an invalid document changes nothing.
- Save → New → Open by name restores imports, systems (instances with mode and guard selectors), configs,
  subscriptions, workspaces and their order, theme, title, profile.
- Import adds only new ids and lists the skipped clashes; leaves title/theme/profile alone.
- `config`/`configure`: each opted-in component round-trips its settings. The ops are matched by name within the
  instance's own component (one key each), so there is never more than one of each.
- Imports confirmation: a *trusted* package is imported sandboxed unless ticked; Cancel changes nothing.
- `?src=`: unsaved live work is kept as "Before opening …"; a saved app is never overwritten.
- File menu element: keyboard/Escape/outside click; each command dispatches its event; Save disabled when unchanged.
- Nav: saved workspaces are top-level, in order; drag and Alt+↑/↓ reorder; the order survives Save/Open.
- e2e: open a `nano.json` from a URL (served by the test) with the template package, a sandboxed instance and a
  wiring, and see it working; Download produces a file that opens back to the same app.

## Calls I made (check these)

- `nano.json`'s schema and `<nano-file-menu>` live in `packages/shell`, so other hosts can use them; the host does
  the work behind each `file:*` event.
- Open asks before discarding unsaved changes; `?src=` keeps them as an automatic "Before opening …" app.
- Open and New reload the page (imports can't be unloaded); Import applies to the running app.
- The working copy is autosaved (debounced ~500 ms); `?src=` is removed from the address bar once applied.
- A loaded document's *trusted* imports need an explicit tick, else they import sandboxed.
- Built-ins (platform, `ex-*` examples, profile instance, the Main workspace) are not written to `systems` /
  `workspaces`.
- Workspace reordering: drag, plus Alt+↑/↓ for the keyboard.
- Limits: 1 MB per document; clashes on Import are skipped and listed, never renamed.
