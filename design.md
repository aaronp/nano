# Design: the core in brief

A glossary, bottom up. The source of truth for each term is named after it.

## Core (`packages/core`)

- **Op**: a named operation, `{ns, name, input?, output?}`, with TypeBox schemas. Its **key** (`ns/name`, e.g.
  `composable.bundle/range/value`) is how everything else refers to it. These are the type coordinates: two ops are
  the same op only if their keys are the same.
  - **action**: has input and output (a call).
  - **source**: output only (something published).
  - **sink**: input only (something received).
  - `Ops.fits(from, to)`: from's output can go to to's input if the schemas are equal (annotations ignored) or to's
    input takes anything. (`data.ts`)
- **Component**: a definition with an id (`ns/name`), `make(env)` to build its value, and **Actions**, each an op
  bound to a `run`. An action may also list ops it `emits` after it runs. (`component.ts`)
- **Instance**: one made value, with its own copy of the actions and an **Environment**. Through the environment it
  publishes (`notify`), calls others (`call`), and adds or removes its own ops at run time. (`component.ts`,
  `env.ts`)
- **Coord**: `{registry, instance}`, where an instance lives. (`data.ts`)
- **Registry**: a named set of instances by id, plus the following. (`registry.ts`)
  - **Subscriptions**: when `source` (or `*`) publishes `op`, call `listener`'s `target` action.
  - **Labels**: key/value strings per instance.
  - **Owner**: who added an instance.
  - **Deltas**: every change, as data.
  - **Snapshot**: the whole state, as data.
- **Runtime**: calls and publishes by coord over one registry. It checks inputs and outputs against the op schemas,
  delivers a publish to every matching subscription, and traces each message (`listen`). It adds the registry to
  itself as instance `registry`, so the registry can be called and watched like any component. A **Policy** wraps a
  runtime to change its rules. (`runtime.ts`)
- **Wrap / guard**: replace an instance with a wrapper that holds the original in an inner runtime of its own. Calls
  go through a strategy (forward, buffer), and outward calls can be limited with allow/deny selectors
  (`registry/target/op`, where `*` matches anything). Neighbours' wiring doesn't change. This is how sandboxed and
  remote deployments slot in. (`wrap.ts`)
- **Tags**: a two-way index between plain-string tags and items. It's data only: a tag means nothing to the index.
  (`tags.ts`)

## Systems and the Application (`packages/app`)

- **System**: a namespace. It's one registry with its own runtime, and its id is the registry id (`host`, `lab`, …).
  Ids, wiring and calls are local to a system, and a subscription never crosses one.
- **Spanning systems**: the same Instance can be added to several registries (`add-to-system`). Its environment then
  holds one handle per registry, so the one value can be called, and can publish, in each system. Removing it from a
  system closes its subscriptions there.
- **App gateways**: host instances shared into every system as it's created, and never removable from any. The
  default is `app`, the **AppGateway** (`nano.shell/app-gateway`), which holds focus and what the app bar shows.
  Because it's the same instance everywhere, a component in any system talks to the shell through its own system's
  `app`, and never needs a coord outside its system. (`gateway.ts`, `application.ts`)
- **Application**: the instance `application` in the host system (ns `nano.app`). It owns every system's runtime and
  exposes everything as ops (`ApplicationOps`). (`application.ts`)
  - **Systems**: create a system; make an instance of a catalog kind (deployed by mode, e.g. host or a sandbox, with
    optional allow/deny guards); add an instance to another system or remove it; connect and disconnect.
  - **Screens**: pages in nav order, each with an opaque layout. **Placements** (which panel shows which instance,
    with an optional box and tab) are worked out from a layout by the host's `placementsOf`.
  - **Publishing**: `systems`, `changed` (what: systems, screens or tags), `state-changed` and selection.
  - `createApplication` builds the host runtime with `app` and `application` from the catalogs. (`create.ts`)
- **Catalog**: the kinds the app can make. A kind is a name mapped to a component, title, element tag and deploy
  modes. (`catalog.ts`)
- **Refs**: one string form for anything taggable: `system:<id>`, `instance:<system>/<id>` or `screen:<path>`.
  (`refs.ts`)
- **Infrastructure**: the `registry` instance, host-driven listeners (`app`, `application`, `alerts`,
  `ws-controls-*`) and view-owned instances. Views hide all of these. (`infrastructure.ts`)

## Tagging and querying

- **Within a system**: registry **labels** (`label`, `labels`, `labelled(key, value?)`). They live on the instance,
  are carried along when the instance is shared into another system, and are announced as deltas.
- **At the application**: **tags** on refs, so a tag can mark systems, instances and screens alike. The operations:
  - `tag` and `untag`;
  - `tagsOf(ref)` and `tagged(tag)`;
  - `allTags`, used when saving;
  - `query({screen?, system?, kind?, tag?})`: the instance refs that match every filter given;
  - `screensOf(ref)`: the screens that place an instance.

  A removed instance loses its tags.
- **Labels or tags**: labels are per-system key/value metadata, read by deploy and by views. Tags are the user's
  cross-cutting groupings, such as `billing` or `approvals`, and they span systems and pages.
