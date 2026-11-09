# @composable/editor

A puzzle-style editor for components, types and connections, built as small rune components over
`@composable/core`. Each holds only its own state, can be tested without a UI, and is wired to the others by
ordinary subscriptions.

| Component | State | Publishes |
|---|---|---|
| `ComponentList` | available components (`{ id, ops }`, as a registry snapshot lists them), selection | `components`, `component-selected`, `op-selected`, `removed` |
| `TypeList` | named types (`{ type: TSchema, look? }`), built-ins first | `types`, `type-selected` |
| `TypeEditor` | one type being edited | `type-changed` |
| `ConnectionBoard` | pieces on a grid | `pieces`, `connections` (core `Subscription`s without ids) |

Types are plain TypeBox schemas named by `title`; a brand is a copy with a new title. On the board, neighbours in
a row join when the left output's schema equals the right input's (name included), or the input takes anything.

## Composing

```ts
const rt = Runtimes.create(Registries.create('page'))
const ids = addEditor(rt.registry)   // the four, plus:
// type-list/type-selected → type-editor/edit
// type-editor/type-changed → type-list/update
// component-list/removed  → connection-board/remove-instance
```

The board only publishes connections. Applying them, and saving or loading state, are other components'
jobs: every piece of state here can be set and is published.

## UI

`ModelElement` (in `src/elements/view.ts`) is a Lit element that joins the registry as a hidden subscriber of
its model, re-renders when the model publishes, and calls the model's actions. Each component has one element
on it; `<editor-page>` lays them out like the prototype.

```sh
bun packages/editor/demo/index.html   # the demo, seeded with slider, doubler, chart, meter and log
```
