# Workspace pages and layout templates

## Intent

Arrange a workspace by hand in the dock (golden-layout), duplicate it as a page of its own (new nav title, route and
icon), and flip any workspace page to a simple fixed HTML layout (one, two side by side, two stacked, main + two,
three columns, 2×2 grid, main + drawer) without re-placing anything. The panels go into the layout's positions in the
dock's reading order; the user can swap which panel sits where. Flipping back to the dock restores the hand-made
arrangement untouched.

Goals: duplicate and edit workspace pages from the nav; one layout picker per page; templates that are plain
responsive CSS (a real drawer, reflow on narrow screens); swap panels between positions.
Non-goals: user-authored HTML templates; resizing within a template; reordering nav items (the old drag/Alt+↑↓);
a page per system (every page shows the same live app).
Anti-goals: a second notion of "which pods are on the page" (the dock's panels and `LayoutData.slots` already say
it); panels mounted twice (a pod's view made in a hidden dock and a template at once).

## Approaches

1. **Template engine beside the dock (picked).** Each template is a CSS grid (named areas, media queries). It reads
   the dock's panels and keeps only its own state, as each engine does beside `LayoutData`. Picked: nothing new in
   the model, and truly responsive.
2. Templates as locked golden-layout trees. Least code, but no real drawer and no reflow — the point of a template.
3. Templates as user-written HTML with `data-slot` placeholders. Most flexible; loading and validating them is more
   than is needed now.

Saved pages: kept in localStorage (`lib/saved-workspaces.ts`'s `KEY`, as the dock's layout is) — *my call*; the
retired version kept them as the Application's screens, which nano-core 0.4 does not have.

## Design

### Workspace pages (ui-workspace)

`/workspace` is the main page. Saved pages are `SavedWorkspace` (`{ path, title, icon }`; `system` dropped) in
localStorage, mounted at start before `<app-shell>` reads its routes, as the retired `mountWorkspace` did: a nav `<a
data-saved>` after Main and an `<app-route bleed>` holding a components drawer and a `<workspace-dock>` with Main's
widget templates, `storage-key` `layoutKey(main key, path)`. Drop the system/registry wiring from the retired code.

**Hover actions** on every workspace nav entry (Main included for duplicate; saved ones also edit): two icon buttons
shown on hover and on focus-within (keyboard reachable), hidden when the nav rail is collapsed.
- **Duplicate** (⧉): `askWorkspace` (no systems) → a new page whose dock storage is a copy of the source's (its
  golden-layout arrangement and template state, via `arrangement()`), mounted and navigated to. `refusal` checks it.
- **Edit** (✎, saved pages only): `askWorkspace` prefilled → updates title and icon in place; a changed route moves the
  page's storage keys to the new path and updates the nav link and route.
- The dock's "Save as workspace…" command and the `+` button: Save as = duplicate of that page; `+` = a new empty page
  (same dialog). Both replace the "not available yet" stubs (BACKLOG(3)).

### Layout templates

A new `dock/templates.ts` (≤150 lines): the template table and the render into positions.

| id | thumbnail | positions | narrow (≤ 840px) |
|----|-----------|-----------|------------------|
| `dock` | Dock | golden-layout, as today | as today |
| `one` | ▯ | 1 | — |
| `two-cols` | ▯▯ | 2 side by side | stacked |
| `two-rows` | ▭/▭ | 2 stacked | — |
| `main-two` | ▯\|▭▭ | main left, 2 stacked right | stacked |
| `three-cols` | ▯▯▯ | 3 side by side | stacked |
| `grid` | ⊞ | 2×2 | stacked |
| `main-drawer` | Main + drawer | main, drawer | drawer is a slide-over toggled by a button |

**Enabled when the page's panel count equals the template's positions**; Dock always. (`main-drawer` has 2.)

**Switching to a template.** The dock reads its panels from golden-layout's root in reading order (left→right,
top→bottom, a stack's tabs in tab order, as `dockPlacements` walks it), keeps that config, clears golden-layout, and
mounts each panel once into its position with the existing `mountPanel`, through a small container stand-in
(`element`, `on('destroy')`, `focus`, `stateRequestEvent`), so pod views, explorer and wiring panels behave as in the
dock. Leaving fires each panel's `destroy`. Panels holding no instance (notes, stream, plain widgets) are rebuilt and
lose what they held; an implementation panel whose pod is still being made blocks the switch until named (*my calls*).

**Swap.** Each template panel has a thin header: its title and a native `<select>` of positions; choosing one swaps
the panel with the one there.

**Adding panels while in a template** (explorer click → `openPod`, drawer item → `addWidget`): an already-shown pod is
focused; otherwise the page flips back to Dock and adds it there (the count no longer fits) — *my call*.

**Switching back to Dock.** Reloads the kept golden-layout config.

**State.** Per dock in localStorage beside the window style: `${storageKey}.template` = `{ template, order, dock }`:
`order` the panels' saved states (`{ widget, name? }`) by position, `dock` the kept golden-layout config, so a reload in
a template still flips back to the hand-made arrangement. Unknown template id reads as `dock`.

**`arrangement()`** (approved): a public method on `<workspace-dock>` returning `{ ...goldenLayoutConfig, template? }`
(the kept config while a template shows). `main.ts`'s Save uses it instead of reaching into the private layout; Save
as / duplicate copy it. Import/Open of a file whose `layout[dockId].template` is set switches to that template.

**Controls.** In `<nano-workspace-controls>`, the thumbnail row (a radio group, each with its title as label; disabled
ones say why in their title) before Tabs/Clear; Tabs/Clear only shows in Dock. Narrow: the row goes first in the menu.

**New names (approved):** the template ids above; `<workspace-dock>`'s `template` / `setTemplate(id)` and
`arrangement()`; the nav hover actions Duplicate and Edit.

## Testing

Pure parts in `lib/` with bun tests: panels in reading order from a golden-layout tree; which templates are enabled
for a count; `swap(order, i, j)`; reading/writing template state (unknown → dock); saved-workspace rename (refusal,
moved keys). The page itself checked by hand in the running workspace.

## Left to the builder

Template CSS; thumbnail drawings; drawer button placement; `dock:focus` in template mode (report the clicked panel's
instance as the dock does); file splits to stay under 150 lines.
