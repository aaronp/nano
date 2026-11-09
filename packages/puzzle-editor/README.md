# @composable/puzzle-editor

A puzzle-style editor for types, draft components and the connections between them. It is a composite component
(`puzzleEditor`) of four children in a System of its own: `type-editor`, `component-list`, `connection-editor` and
`document`, with Lit views for each.

- `.`: `puzzleEditor`, the children and their ops (`DocumentOps`, `ComponentListOps`, `ConnectionEditorOps`,
  `TypeEditorOps`), and the model (`EditorDoc`, `emptyEditorDoc`, `checkDoc`).
- `./model`: the pure model (types, looks, draft components, the board, the TypeScript printer and parser).
- `./views`: `defineEditor(prefix?)` registers `<puzzle-editor>` and the child elements.

The editor exposes `load` / `model-updated` (its document), `set-instances` (link a System's `changed` here),
`intents-updated` (link to an orchestrator's `set-intents`; it publishes only while Live is on) and `set-live`.

```ts
import { Components, Systems, unwrap } from '@composable/sdk'
import { provideSystem } from '@composable/ui'
import { DocumentOps, emptyEditorDoc } from '@composable/puzzle-editor'
import { defineEditor } from '@composable/puzzle-editor/views'

const scope = Systems.create(), host = unwrap(scope.register('host', Components.party()))
provideSystem(document, scope); defineEditor()
document.body.innerHTML = '<puzzle-editor name="editor"></puzzle-editor>'
// once it has registered itself:
await host.call('editor', DocumentOps.load, emptyEditorDoc())
host.subscribe(DocumentOps.modelUpdated, doc => localStorage.setItem('doc', JSON.stringify(doc)), { from: 'editor' })
```

See `packages/ui-workspace/src/composable.ts` for a host that also links it to the page System and an orchestrator.
