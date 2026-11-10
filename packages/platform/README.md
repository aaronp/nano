# @composable/platform

Systems as a component. The platform holds the host registry and any systems it creates, makes components from a
catalog, adds the same instance to several systems, and connects actions that fit. It publishes `systems` (a
snapshot of each, naming every instance's component and owner) and `state-changed` whenever any of them changes;
`kinds` lists its catalog (kind, component id, title, tag), again after `catalog-changed` (the host calls it after
an import).

```ts
const host = Runtimes.create(Registries.create('host'))
host.registry.add('platform', Components.instantiate(platform(host, { ...bundle.catalog, ...editor.catalog })))
```

| Action | Does |
|---|---|
| `create-system(name)` | a new registry with its own runtime |
| `create-component({ kind, name, system })` | an instance of a catalog kind |
| `add-to-system({ instance, from, to })` / `remove-from-system` | the same instance in another system, or out of one |
| `connect({ system, source, op, listener, target })` / `disconnect` | a subscription, only between actions in one system whose types fit (core's `Ops.fits`) |
| `select(selection \| null)` | publishes `selection-changed` |

The platform is a plain core component, built with `Components.create` rather than runes, because it holds live
registries and runtimes.

`<c-platform>` is its view: a text filter, then the systems (by system or by component) down to each action's
input and output types. Select an action to see the connect button on the actions that fit it, add a component
to another system, or create one with `+ Add`.

`<c-platform-table>` is its inventory: one row per instance in each system (system, component, instance, name,
owner), then one per kind nothing has been made of. Filter by text, or open Filters to pick systems (or
Unregistered) and components as pills; pills OR within a group and AND across. Click an instance to select it.
`inventory(systems, kinds)` and `matches(row, q, filters)` are the same, without the element.

Every op has a schema and a description (`Op.description`), and examples where a value means something. The tree
shows an op's description and `e.g.` examples under its types, and a component's description under it; its filter
matches descriptions too. The table has a Description column. `examplesOf(schema)` formats examples the same way.
