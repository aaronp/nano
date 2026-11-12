# @pritzlaff/nano-app

The application as plain data and one component, with no DOM. The `application` instance owns the systems (each a
registry with its own runtime) and the components in them, the screens that place instances, app-wide tags on
systems, instances and screens, and the queries over all of that. It saves to and loads from `nano.json`
(`snapshot`, `apply`, `checkApp`). Views live elsewhere (`@composable/platform`, `@composable/shell`); they call its ops.

A minimal host:

```ts
import { createApplication } from '@pritzlaff/nano-app'

const { host, catalog } = createApplication({ catalogs: [bundle.catalog, editor.catalog] })
// host is the Runtime over registry `host`, with `app` and `application` already added.
await host.call(me, 'application', Ops.key(ApplicationOps.createSystem), 'lab')
```

`createApplication({ catalogs, deploy?, placementsOf? })` merges the catalogs into one object (add kinds to `catalog`
later, then call `catalog-changed`). Optional: `gateways`, `locked(id)`, `registryId`.

## What a host implements

| Contract | Id | Meaning |
|---|---|---|
| `app` | `app` | The `AppGateway`; `createApplication` adds it. Focus and the app bar's target; the host's dock sets focus. |
| `alerts` | `alerts` | `alerts(show)` builds it: the host decides how a message reaches the user. Add it to the host registry. |
| `deploy` | option | `(system, id, kind, mode, owner, outward?) => Result`: puts a kind's component in a system. The default deploys in the host only and rejects other modes. |
| `placementsOf` | option | `(layout) => { panel, instance, box?, tab? }[]`: reads which instances a screen's opaque layout places; `box` is the panel's rectangle as fractions of the page, `tab` is `{ group, active }` when it shares a tab group. Without it, no screen places anything. |

A component contract the host does not implement (say `alerts`) is just an absent instance: a call to it fails with
the runtime's `no instance alerts in host`, which callers should treat as a result, not a crash.

## References

`system:<id>`, `instance:<system>/<id>`, `screen:<path>`. Ids match `/^[a-z0-9][a-z0-9-]*$/`; paths are
`/a`, `/a/b`. Reserved ids: `application`, `app`, `alerts`, `registry`, `profile`, `ws-controls-*`, `ex-*`.
Tags are plain strings (trimmed, at most 64 characters), keyed by reference.

## Main ops (`ApplicationOps`, namespace `nano.app/application`)

| Op | Does |
|---|---|
| `create-system`, `create-component`, `add-to-system`, `remove-from-system`, `connect`, `disconnect` | build systems and wire them |
| `set-screen`, `remove-screen`, `move-screen`, `screens`, `placements` | screens and what they place |
| `tag`, `untag`, `tags-of`, `tagged`, `all-tags` | tags on any reference |
| `query({ screen?, system?, kind?, tag? })` | instance refs matching every filter, sorted |
| `screens-of(ref)` | the screens that place an instance |
| `systems`, `kinds`, `select`, `changed` | snapshots, the catalog, selection, and a change feed |
