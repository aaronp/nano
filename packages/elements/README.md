# @pritzlaff/nano-elements

Lit elements over `@pritzlaff/nano-core` components.

- **`ModelElement`:** shows and drives one model. Give it a `registry` and a `model` (an instance id), and
  optionally a `watch` list of more instances whose sources it reads. It joins the registry as a hidden
  subscriber of each, re-renders when they publish, and calls the model's actions through its own handle:
  `this.read(op)` gives the latest value, and `this.act(op, arg)` calls an action, keeping a refusal in
  `this.problem`.
- **`PlacedElement`:** a ModelElement that brings its own component (`static component`).
  - **On the page,** it shows the instance named by its `name` attribute, in the registry provided for the
    document. If no instance has that name, it creates one and removes it when the element goes.
  - **Moving it** (as a dock does) keeps the instance.
  - **Without a `name`,** it gets a generated one.
- **`provide(document, registry)`:** sets the registry that placed elements use.
- **`base`:** the shared styles (the puzzle prototype's palette).

## Theming: the `--nano-*` contract

Every element reads its colours, fonts and radius from these CSS custom properties, which reach inside shadow roots.
A host sets them (or maps its own variables onto them, once); unset, each falls back to the default dark look
(`NANO_TOKENS`). Elements never know which host or theme they're in.

| Group | Tokens |
| --- | --- |
| surfaces | `bg` `surface` `surface-2` `border` `border-strong` |
| text | `fg` `fg-2` `muted` `on-accent` |
| intent | `accent` `accent-soft` `focus` `good` `good-bg` `bad` `bad-bg` `warn` `warn-bg` |
| type, shape | `font` `font-display` `font-mono` `radius` `radius-s` |
| series | `s1` … `s8` |

A host with its own vocabulary maps it, e.g. a newspaper page:

```css
:root { --nano-bg: var(--paper); --nano-surface: var(--paper); --nano-fg: var(--ink); --nano-border: var(--rule);
        --nano-accent: var(--accent); --nano-font: var(--body-font); --nano-font-display: var(--display-font); --nano-radius: 0; }
```

In an element: `static styles = [base, css\`…${t('accent')}…\`]`, or `tv('accent')` in an inline style.

## The component library (`base`)

Bare `button`, `input`, `select` and `textarea` are styled; and the classes: `.btn` (`.primary` `.danger` `.dashed`
`.small`), `.icon-btn`, `.badge` (`.good` `.bad` `.warn` `.accent`), `.chip`, `.pill`, `.card`, `.alert` (`.good`
`.bad`), `.problem`, `.field`, `.input`, `.meter` (a `span` inside, width = value), `.table`, `.tabs`
(`button[aria-selected]`), `.list-row`, `.kicker`, `.display-s/m/l`, `.muted`, `.mono`, `.row`, `.col`, `.grid-auto`.

Where the browser allows it (`appearance: base-select`), a bare `select`'s open list takes the theme too. Set
`color-scheme` (light or dark) on the page, so the browser's own pickers and scrollbars match.

## The kit (`kit`), in shadcn's look

CSS only (`static styles = [base, kit]`, or a page's `document.adoptedStyleSheets`): `.avatar` (`.small` `.large`)
and `.avatar-stack`, `.bubble` (`.mine`), `.kbd`, `.code`, `.input-group` (with `.addon`s and buttons), `.toggle`
(`aria-pressed`) and `.toggle-group`, `input[type=checkbox].switch`, `dialog.dialog` and `dialog.drawer` (`.bottom`)
for native `<dialog>`s (`showModal()`; a `<form method="dialog">` closes one), `.pop` (a `[popover]` surface),
`.menu-item`, `.menu-sep`, `.menu-label`, `.shortcut`, `.toast`.

Elements, defined on import:

| Element | Takes | Emits |
| --- | --- | --- |
| `<nano-select>` (`multiple`, `placeholder`, `label`) | `options` (strings or `{ value, label?, group?, disabled? }`), `value` (string, or array when multiple) | `change` |
| `<nano-command>` | `items` (`{ value, label?, group?, shortcut? }`), `selected` | `pick` (the item) |
| `<nano-calendar>`, `<nano-date-picker>` | `value` (ISO `YYYY-MM-DD`) | `change` |
| `<nano-menu>` (wraps content; right-click opens it) | `items` (`{ label, shortcut?, danger?, disabled? }`, `{ separator: true }`, `{ heading }`) | `pick` (the item) |
| `<nano-hover-card>` (`open-delay`, `close-delay`) | content, and a `card` slot | |
| `<nano-data-table>` (`filter`, `selectable`, `page-size`) | `columns` (`{ key, label, sortable?, align?, width?, minWidth?, render? }`; each resizes by its header's edge, drag or ←/→), `rows` | `selection` (the rows) |
| `<nano-code-block>` (`language`) | `code` | |
| `<nano-tree>` (`open-depth`); `reveal(id, { focus? })` | `nodes` (`{ id, label, kind?, count?, badge?, terms?, end?, body?, children? }`), `query`, `selected` | `select` (`{ id }`; cancel it to keep `selected` yours) |
| `toast(title, { description?, variant?, duration? })` | shows in one `<nano-toaster>`, made on first use | |

Agent pieces, display only, on the AI SDK's data shapes: `<nano-tool>` (`.tool`: a tool part — `type`, `state`,
`input`, `output`, `errorText`), `<nano-task>` (`.task`), `<nano-subagent>` (`.agent`: name, status, its tool
parts), `<nano-cli>` (`.runs`: command, output, exit code), `<nano-trace>` (`.spans`: OpenTelemetry-style `spanId`,
`parentSpanId`, `startTime`, `endTime`, `status`) and `<nano-test-results>` (`.results`: summary and suites).
