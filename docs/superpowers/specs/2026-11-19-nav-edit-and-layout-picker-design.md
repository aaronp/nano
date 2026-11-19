# Nav edit mode, and layouts filled from a picker

Revises `2026-11-19-workspace-layout-templates-design.md` (which stands where not revised): the per-item hover
Duplicate/Edit buttons and the edit dialog go; the components drawer goes; templates no longer need a matching
panel count.

## Intent

Make workspace pages feel like a canvas you lay out first and fill second. A new page is empty; you choose any layout
(the golden-layout dock or a fixed HTML one) and fill its positions from a picker. Managing pages happens in place in
the nav, not in dialogs.

Goals: rename / re-icon / reorder workspace pages in the nav; `+` makes an empty page; every layout always
selectable; empty positions and dock splits filled from one picker; panels that don't fit are parked, never lost.
Non-goals: editing non-workspace nav items (Systems, Desk, …); user-authored layouts; resizing template positions.
Anti-goals: a second way to add components besides the picker; losing a panel because a layout has fewer positions;
routes the user has to type.

## Approaches

Nav: one sensible way — an edit mode on the nav with inline editing (a settings page or the old dialog work against
"edit in place").

Layout:
1. **Extend what's there (picked).** Template state allows empty positions and a parked list; the picker replaces
   `<component-drawer>` (same entries and filter) as a popover; the dock's per-panel `+` uses its existing `split`.
   Keeps reading order, swap, restore and the kept hand-made dock.
2. Every position a golden-layout item, templates as locked golden-layout trees: one engine, but no real drawer or
   reflow (ruled out before).
3. User-editable HTML templates: nothing asks for it.

## Part 1 — Nav edit mode (ui-workspace)

- **Hover the app's title row** ("Nano", beside the menu button) → two icon buttons: `+` (new page) and ✎ (edit
  mode). Shown on hover and focus-within, keyboard reachable, always visible on touch (`hover: none`).
- **`+`**: makes an empty workspace page titled "New workspace" (then "New workspace 2", …), mounts it, navigates
  to it, and starts rename on its nav item. Its dock starts empty (see Part 2's empty dock).
- **Edit mode** (✎ toggles; Esc leaves): every workspace nav item (Main and saved pages) shows a drag handle.
  - Click a name → it becomes a text input in place; Enter or blur saves, Esc cancels; empty is refused (keeps the old).
  - Click an icon → the existing icon grid (`ICONS`) as a popover anchored to it; choosing one saves.
  - Reorder saved pages by dragging the handle or Alt+↑/↓ on a focused item (announced in a polite live region, as
    the retired code did). Main stays first.
- **Routes follow titles**: renaming a saved page moves it to `slug(title)` (`/new-workspace`), its storage keys
  moving with it (`savedWorkspaces.update`); a clash gets `-2`, `-3`, …. Main keeps `/workspace`; its title and icon
  are stored too (*proposal accepted with the design*).
- Order and Main's title/icon live in localStorage beside the saved pages (`saved-workspaces.ts`; *builder's call*
  how — the list's order is the nav's order).
- **Removed**: the per-item ⧉/✎ hover buttons and the Workspaces row's `+`; `askWorkspace` (the dialog) if nothing
  else uses it. "Save as workspace…" in the workspace controls stays (it copies the current page; with no dialog it
  makes "<title> copy" and starts rename).

## Part 2 — Layouts filled from a picker

**Every layout is selectable**, whatever the panel count (`enabledFor` goes; the picker row has no disabled state).

**Template state** (`${storageKey}.template`): `order` entries may be `null` (an empty position); a new
`parked: PanelState[]` holds panels that didn't fit. Switching to a template fills positions in reading order; the
rest are parked. `get()` accepts `order.length === positions` with nulls; a state saved before this change (no nulls, no `parked`) still
reads as valid, `parked` defaulting to `[]`; Save writes `parked` (*my call*).

**Empty positions** show a large `+`. **Filled positions** keep the ⇄ position select and gain ✕, which empties the
position (the panel is removed, not parked).

**The picker** (`<nano-picker>`, replacing `<component-drawer>`): a popover anchored at the `+` that opened it, with
a filter field (focused) and sections Components, Widgets, Imported (each Imported package with ✕ remove, and failed
imports listed) — the drawer's content. Click an entry → it fills that place; Esc / outside click → nothing. Import
stays in the File menu. The app bar's Components drawer toggle and the drawers' hidden-state code go.

**Where the picker lives**: the dock makes it (it already holds the palette, `defs`) and awaits the choice
(a promise of the palette id, or null), then fills through its own paths (`split`, the template's position mount);
no new event or delivery path (*my call*). The picker reads the dock's `template[data-widget]` entries, as the drawer did.

**The dock**: each panel header gets `+`, which splits that panel (beside it when wider than tall, else below, as
`split` does) and opens the picker for the new half; cancelling the picker adds nothing (the picker opens first; the split happens only on a choice, so nothing is written
on cancel — *my call*). An empty dock (a new page, or after
closing the last panel) shows one large `+` (the picker; the panel fills the dock). Drag-from-drawer goes with the drawer.

**Parked panels**: while any are parked, a dismissable notice above the layout: "2 panels hidden — Bring back".
Bring back switches to the smallest template with positions ≥ all panels (ties: the current template if it fits,
else the first in `TEMPLATES` order); none big enough → the dock. Dismissing hides the notice until the parked count
changes. Parked panels are kept in the template state and in Save.

**Switching between templates** compacts: the placed panels, in reading order and skipping empty positions, fill
the new template's positions; then parked panels, in the order they were parked; the rest park (*my call*).

**Adding from outside the picker while a template shows** (explorer click → `openPod`, `addWidget`, Import/Open):
already shown → focus it; else fill the first empty position; else flip to the dock and add it there, as now (*my
call*: never parks silently).

**Parked panels in the picker**: when the picker is opened from an empty position, a "Hidden" section lists the parked
panels first; choosing one places it there (*my call*: lets you bring back one at a time; Bring back does all).

**Back to the dock**: the kept hand-made arrangement, minus panels emptied in the template, plus panels added in the
template split in (by `split`, in reading order). Parked panels are in the dock as before.

**New names (approved with this design):** `<nano-picker>`; `parked` in `TemplateState`; the nav's edit mode; the
"Bring back" notice. Template places stay **positions** (`slot` is `LayoutData.slots`).

## Testing

Pure: reading order with nulls and parking; template-state validation with nulls/parked; bring-back choice; slug
and clash suffixes; reorder. Elements (happy-dom): picker fills an empty position and a dock split; cancel adds
nothing; ✕ empties; switching 4 panels to two-cols parks 2 and shows the notice; bring back picks grid; nav edit mode
rename/icon/reorder. Then a hand check in the built page.

## Left to the builder

Visuals of `+`, the notice and the edit-mode handles; the popover's placement; where Main's title/icon are stored.
