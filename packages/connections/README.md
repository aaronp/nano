# @composable/connections

Connections between component instances as data, kept apart from the components and from creating instances.

- `Intent`: a `Connection` (pub/sub fan-out) or a `Workflow` (a chain of steps). Plain JSON, so it can be saved.
- `checkIntents(x)`: untrusted data in, `Result<Intent[]>` out (ids must be unique).
- `plan(intents, instances)`: pure; the routes the intents want and a `Status` per intent.
- `Orchestrators.create(system, intents)`: a policy that keeps a System's links matching the plan as instances come
  and go. Its `OrchestratorOps.setIntents` op lets a link drive it.
- `Binders.firstProvider`: a policy that binds each missing dependency to the first instance providing it.

```ts
import { Systems, unwrap } from '@composable/sdk'
import { Orchestrators, type Intent } from '@composable/connections'

const scope = Systems.create()
const flow: Intent = { kind: 'workflow', id: 'w1', steps: [
  { select: { by: 'name', name: 'crm' }, op: 't/crm/address-updated' },
  { select: { by: 'name', name: 'map' }, op: 't/map/to-jurisdiction' },
] }
const o = unwrap(Orchestrators.create(scope, [flow]))
o.onStatus(s => console.log(s.w1))   // viable once crm and map are registered
```
