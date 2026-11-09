# @composable/platform

Systems as a component. The platform holds the host registry and any systems it creates, makes components from a
catalog, adds the same instance to several systems, and connects actions that fit. It publishes `systems` (a
snapshot of each) and `state-changed` whenever any of them changes.

```ts
const host = Runtimes.create(Registries.create('host'))
host.registry.add('platform', Components.instantiate(platform(host, catalog)))
```

| Action | Does |
|---|---|
| `create-system(name)` | a new registry with its own runtime |
| `create-component({ kind, name, system })` | an instance of a catalog kind |
| `add-to-system({ instance, from, to })` / `remove-from-system` | the same instance in another system, or out of one |
| `connect({ system, source, op, listener, target })` / `disconnect` | a subscription, only between actions in one system whose types fit (the editor's `joins`) |
| `select(selection \| null)` | publishes `selection-changed` |

The platform is a plain core component, built with `Components.create` rather than runes, because it holds live
registries and runtimes.

`<c-platform>` is its view: a text filter, then the systems (by system or by component) down to each action's
input and output types. Select an action to see the connect button on the actions that fit it, add a component
to another system, or create one with `+ Add`.
