# A component kit with shadcn's look — design

## Intent

Widgets need more than buttons and badges: filterable pickers, overlays, a data table, and display pieces for an
agent at work. We take shadcn's look (its spacing, radii, borders, focus rings, popover shadow; MIT, meant to be
copied) but not its stack (React, Radix, Tailwind): everything is Lit or plain CSS in `@pritzlaff/nano-elements`,
reading only `--nano-*`, so any host can use it and re-theme it.

## Goals

1. **Native select themed:** where the browser allows (`appearance: base-select`), a bare `<select>`'s open list takes
   the theme; the gallery's compare columns set `color-scheme` so native pickers match light or dark.
2. **A shadcn theme** (neutral greys, light and dark) in the workspace's picker.
3. **CSS-only pieces** (`kit` stylesheet): avatar and avatar stack, chat bubble, kbd, input group, toggle and toggle
   group, switch, dialog and drawer (native `<dialog>`), popover surface, menu, toast.
4. **Lit elements where behaviour is needed:** `<nano-select>` (filterable, single or `multiple`, chips, combobox
   keyboard and ARIA), `<nano-command>` (palette: groups, shortcuts), `<nano-calendar>`, `<nano-date-picker>`,
   `<nano-menu>` (context menu), `<nano-hover-card>`, `<nano-data-table>` (sort, filter, select rows),
   `toast()` + `<nano-toaster>`, `<nano-code-block>` (copy button).
5. **Agent pieces, display only**, on the AI SDK / AI Elements data shapes: `<nano-tool>` (a tool part: type, state
   `input-streaming | input-available | output-available | output-error`, input, output, errorText), `<nano-task>`,
   `<nano-subagent>`, `<nano-trace>` (spans with parentId, start, end, status, as a waterfall), `<nano-cli>`,
   `<nano-test-results>` (summary, suites, tests).
6. **Gallery tabs:** Pickers & inputs, Overlays, Data, Agent.

## Non-goals

Binding these to nano Components; React; Tailwind; new dependencies; animation beyond CSS transitions.

## Settled by Claude

- Pop-ups use the `popover` attribute (top layer, so docked panels don't clip them), placed by script from the
  anchor's rect; no anchor positioning yet.
- The date picker uses our calendar, not `<input type=date>` (which can't take a theme). Dates are ISO `YYYY-MM-DD`.
- Elements define themselves on import, guarded, and are exported from the package root.
- Files stay under ~200 lines.
