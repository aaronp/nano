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
| `needs-of`, `set-selector`, `bind-need`, `unbind-need` | an instance's needs: list, select, bind (never to itself) and unbind |

## Needs in `nano.json`

An instance may carry `needs`: at most 20, by name (`^[a-z][a-zA-Z0-9-]*$`), each a selector
`{ implements, tags?, layer?, at? }` (`implements` up to 200 characters; up to 20 tags of up to 64; `layer` and `at`
are ids). A document without `needs` loads exactly as before.

```json
{ "id": "svc", "kind": "service", "needs": { "db": { "implements": "example/db", "layer": "storage", "at": "db" } } }
```

- **Saved as pins.** `snapshotApp` writes a bound need as `{ implements, tags?, layer, at }` naming the instance it
  is bound to, so adding a second fitting instance later never changes it; an unbound need is written as its
  stored selector.
- **Resolved after everything loads.** `applyApp` creates every system's instances and subscriptions (and tags)
  first, then calls `set-selector` for each need in document order, so a pin may name an instance later in the
  document or in another system, and a pin that resolves overrides whatever auto-bind picked meanwhile.
- **Never makes instances.** A need that doesn't resolve to one instance is a note,
  `<system>/<id> needs <need>: <reason>` (say `app/form needs bff: nothing matches`), and its instance stays
  disabled. An unknown need, instance or system is a note too; the rest loads.

## Using nano from another project

A project serves its components as a package and opens them in any nano host:

- **`nano-package.json`**: `{ "manifest": 1, "name", "version", "module", "components" }`; the module exports
  `catalog` and `define()`.
- **`nano.json`**: a document whose `imports` lists that manifest's URL.
- **Bundle** with `--external '@pritzlaff/*' --external typebox --external 'typebox/*'`: the host's import map
  supplies them.
- **Serve with CORS** and open `<host>/?src=<url of nano.json>`.

A Makefile target in that project, for example:

```make
PORT ?= 4321
nano-dev:
	bun build src/index.ts --outdir dist/nano --target browser --external '@pritzlaff/*' --external typebox --external 'typebox/*'
	cp nano-package.json nano.json dist/nano/
	@echo "open <host>/?src=http://localhost:$(PORT)/nano.json"
	bunx serve --cors -l $(PORT) dist/nano
```
