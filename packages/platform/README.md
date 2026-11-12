# @composable/platform

Lit views of the Application (`@pritzlaff/nano-app`): the systems tree and the inventory table. The ops, kinds
and selection come from `nano-app`; this package only draws them and calls `ApplicationOps` for the buttons.

```ts
import { definePlatform, definePlatformTable } from '@composable/platform'
import { ApplicationOps as P } from '@pritzlaff/nano-app'
```

`<c-platform>` is the tree: a text filter, then the systems (by system or by component) down to each action's
input and output types. Select an action to see the connect button on the actions that fit it, add a component
to another system, or create one with `+ Add`.

`<c-platform-table>` is the inventory: one row per instance in each system (system, component, instance, name,
owner), then one per kind nothing has been made of. Filter by text, or open Filters to pick systems (or
Unregistered) and components as pills; pills OR within a group and AND across. Click an instance to select it.
`inventory(systems, kinds)` and `matches(row, q, filters)` are the same, without the element.

Every op has a schema and a description (`Op.description`), and examples where a value means something. The tree
shows an op's description and `e.g.` examples under its types, and a component's description under it; its filter
matches descriptions too. The table has a Description column. `examplesOf(schema)` formats examples the same way.
