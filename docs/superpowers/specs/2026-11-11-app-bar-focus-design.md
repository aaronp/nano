# App bar controls, and panel focus

## Why

The app bar is mostly empty: a title, File, and the profile avatar. Each view's controls live in a bar of its own
inside the page (the workspace's "Workspace" toolbar), which costs a row of height and looks different from view to
view. We want the app bar to hold **the controls of whatever the user is working in** — the page's own controls by
default, and a selected panel's controls when it has some — like the single bar in other apps (search, view toggle,
undo/redo, all in the top bar).

It should be done with the system we already have: "who is focused" and "what is in the app bar" are operations and
events on a component like any other, and components react to them through ordinary subscriptions and calls. No
special host-side wiring per component.

Workspaces run in systems of their own, and a component can only call and subscribe within its own system. Crossing
systems is done the way we always meant to: **a component that is in two registries at once — an app gateway**. The
gateway carries only the operations a workspace should have (focus and the app bar), so a workspace's components get
those and nothing else of the host's (not the platform's create/remove/connect).

## Goals

### 1. The app gateway

- A new component kind, **app gateway** (`nano.shell/app-gateway` or similar), with one instance, `app`, in the host
  system. It **owns** the focus and app-bar state and the operations below. *(Our call: the gateway owns them rather
  than forwarding to the platform; the platform keeps its current operations unchanged.)*
- **The same instance is added to every workspace system** (`addToSystem`, one instance in two registries), so each
  workspace's components can subscribe to `focus` and call `setAppBarComponent` in their own system.
  *(Our call: added automatically when a workspace's system is made or restored, including Main's `host`; it is
  reserved like `profile`, so not written to `nano.json` and not removable from the Systems view.)*
- It carries **only** these operations; anything else a workspace should reach across systems is added to it later,
  deliberately.

Its operations:

- **`setFocus(focus)`** — `focus` is `{ system, instance, widget? } | null`. `widget` is the dock panel the instance is
  shown in (one instance can be shown in two panels). `null` means nothing is focused.
- **`focused`** (source) — the current focus, for reading.
- **`focus`** (event source) — published whenever the focus changes, with the new focus (`null` included).
- **`setAppBarComponent(target)`** — `target` is `{ system, instance } | null`. The app bar shows that instance's
  element; `null` empties the space.
- **`setAppBarDefault(target)`** — the same shape: the controls the current page wants when no focused panel has its
  own (the workspace sets its controls; plain pages set `null`).
- **`appBar`** (source) — what the app bar shows now.
- **Rule: on every focus change, the gateway first resets the app bar to the default, then publishes `focus`.**
  Components therefore only ever *set* the bar in response to their own focus; they never clear it. A focused panel
  without controls leaves the page's default showing.
- All typed and described like every other op (examples, descriptions).
- Focus is **separate from** the platform's existing `select` / `selection-changed` (what is selected in the Systems view).

### 2. The app bar shows a component (`ui-workspace`)

- A slot in the app bar **right after the File menu** (choice A from the mockups: controls sit together next to File;
  the right side stays for the avatar).
- The app bar follows the gateway's `appBar` source: it renders the element for the named instance — the kind's
  `tag` from the catalog, with `name` = the instance — and replaces it when the target changes, empties it on `null`.
  It's a second view of an existing instance, like the Systems page's elements attaching by name.
- An instance whose kind has no element shows nothing (and says so in the status line).

### 3. Focus comes from the dock (`workspace-dock`)

- The dock calls the gateway's `setFocus({ system, instance, widget })` when the user **clicks into a panel, tabs (keyboard focus)
  into it, or clicks its tab**. Golden-layout already tracks a focused component item; build on it.
- It calls `setFocus(null)` when the user clicks the dock's empty space, when the focused panel closes, and when the
  page changes (route change) — whatever page is shown then sets its own default.
- At most one focused panel at a time, app-wide.
- **Panels that show no instance** (Notes, Chart, Metrics, Activity): clicking one still gives it the dock's focused
  marker, and calls `setFocus(null)`, so the page's default controls show. The marker is therefore the dock's own
  (which panel the user is in), not driven by the gateway's `focus`. *(Our call.)*
- The focused panel gets a visible marker (e.g. its tab styled as active/accent) so the user can tell which panel owns
  the bar.

### 4. The workspace's controls become a component, and move into the app bar

- The workspace toolbar (`.dock-bar` in `workspace-dock.ts`) **goes away**; the dock fills the page.
- A new component kind, **workspace controls**, one instance per workspace dock (Main and each saved workspace), with
  an element. Its ops mirror today's buttons: window style (`tabs` | `clear`), connections, save as workspace…,
  save layout, restore, reset. Its element:
  - **View: Tabs | Clear** as a segmented toggle (replacing the `<select>`; today's "Distraction free" is "Clear").
  - **Icon buttons** with tooltips and `aria-label`s: Connections, Save as workspace…, Save layout, Restore, Reset.
  - Uses the app bar's colours (inherits `--appbar-fg`, as the File button now does), so it reads on every theme.
- When a workspace page is shown, it calls `setAppBarDefault` with its controls instance.
- **Workspace controls are host built-ins, like `profile`** *(our call)*: they live in the host system, are owned by
  the host, are never written to `nano.json` or the working copy, never appear as a dock widget or in the components
  drawer, and are hidden from (or locked in) the Systems view. Their names are dynamic (one per workspace), so they need
  a reserved prefix or owner check in `RESERVED`/snapshot/apply and in the palette filter.
- **Narrow screens** (the shell's narrow breakpoint): the controls fold into a "⋯" overflow menu in the app bar.
  *(Our call.)*
- The dock's status messages ("Opened your saved layout.", "Layout saved", errors) go to the status line in the footer;
  the "Add widgets from the menu…" hint is dropped.
- The controls drive the dock through their ops (the same behaviour the buttons have now, including the
  `dock:save-as` and `dock:connections` events and remembering the window style per dock).

### 5. Components put their own controls up

- A component that wants app-bar controls subscribes to the gateway's `focus` event (in its own system); when the event
  names **its own coordinates**, it calls `setAppBarComponent` on the gateway with its controls instance — itself or a separate
  controls component. That is all; the reset rule handles leaving.
- A focused panel's controls **take the whole space** (they replace the workspace's controls, not sit beside them).
- No existing component needs to do this yet; one test component (or the gallery / puzzle editor, builder's choice)
  proves the path end to end.

## Non-goals

- A search box for the workspace (the Kerits-style middle). The space is for whatever the view puts there; search
  comes when a view needs it.
- Toasts, alerts or page navigation as platform ops (they belong on the platform eventually, not in this change).
- Components deciding to *clear* the bar, or several components sharing it.
- Changing the Systems view's existing `select`.

## Anti-goals

- Per-component special-casing in the host or the dock ("if it's the editor, show X").
- The app bar losing its controls on a theme (same foreground and background) — check all themes.
- Focus that flickers: clicking inside a panel that is already focused must not reset and re-set the bar.

## Constraints

- Ops typed and described like the rest (`typed-described-ops`).
- `nano.json` snapshots: focus and the app bar are live UI state, **not** written to documents or the working copy.
- Accessibility: keyboard reachable, `aria-label`s on icon buttons, the toggle exposes its state (`aria-pressed` or a
  radio group), visible focus rings.
- Existing e2e and unit tests that use the toolbar's buttons move to the app bar controls.

## Decided after review

- Cross-system access goes through the app gateway (one instance in several registries), not by adding the platform to
  workspace systems and not by a per-system proxy (decided with the user).
- The calls marked *(our call)* above were settled without the user; check them while reading.

## Left to the builder

- Whether workspace controls live in `ui-workspace` or `@composable/shell`.
- How the dock learns each panel's `{ system, instance }` (panels already record the instance they show).
- Sandboxed panels: focus happens inside an iframe, which the host doesn't see as `focusin`. Treat a click on the
  panel (or the iframe gaining focus, via `window` blur) as focus; sandboxed components are mostly headless, so a
  simple approach is fine.
- Icons (the File menu's stroke style); exact tooltip wording.
