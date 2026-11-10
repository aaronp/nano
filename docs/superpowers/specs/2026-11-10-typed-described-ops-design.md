# Typed, described ops

## Why

Many ops are typed `any` (`Type.Unknown()`), so the views show `any`. In the Systems tree, Range's `min`, `max` and `step` read `· → any`. There is also no place to say what an op does or give an example. An AI building from the template has nothing that pushes it to type and describe its ops.

There are three causes:
1. runes `component()` takes an optional schema per key, and a missing one becomes `Unknown`;
2. a runes action can't declare its output, so it is always `Unknown`;
3. the platform's ops use `Type.Unknown()` for real shapes (`Selection`, `Snapshot[]`, `Kind[]`).

## Goals

- Every op of every catalog component, and of the platform, has a real input and output schema and a description.
- Schemas carry TypeBox's `description` and `examples` (JSON Schema's keyword is `examples`, an array).
- Descriptions and examples are visible in the Systems tree, the Wires Detail card and the instance table.
- One test enforces this, so new components (including ones an AI writes from the template) can't regress.

## Non-goals

- Generating schemas from TS types (codegen).
- Validating arguments at runtime against schemas. That's a separate change.
- Typing the hidden `~view` sink ops that `ModelElement` makes. They're internal and stay `Unknown`.

## Decided

### runes `component(id, make, schemas)`

`schemas` is **required** and has **every** key of the surface (`{ [K in keyof A]: … }`), so a missing key is a compile error. What each kind of key takes:

| Key | Takes | Notes |
|---|---|---|
| getter | a bare `TSchema` | its output; the schema's `description` is the op's description |
| `event()` member | a bare `TSchema` | as for a getter; it replaces `event(schema)`'s schema if both are given |
| action | `{ in?: TSchema; out?: TSchema; description: string }` | `in` is omitted for an action that takes nothing, and then defaults to `Type.Null()`; `out` defaults to `Type.Void()` |

Example (Range):
```ts
component('composable.bundle/range', make, {
  value: Type.Number({ description: 'The current value', examples: [50] }),
  min: Type.Number({ description: 'Lowest value', examples: [0] }),
  set: { in: Type.Number({ examples: [42] }), out: Type.Void(), description: 'Sets the value, clamped into [min, max]' },
  …
})
```

A type-level check, so the schema agrees with the code:
- `Static<getter schema>` must be assignable to the getter's type;
- an action's `in` must be assignable to its parameter type.

A mismatch is a compile error. If this proves impractical with the installed TypeBox, record a ruling and keep only the required-keys check.

### core

- `Op` gains `description?: string`.
- `Ops.source`, `Ops.action` and `Ops.sink` take an optional last argument `{ description?: string }`.
- `Component` gains `description?: string`. `Components.create(id, make, opts?)` takes `{ description }`, and runes `component()` takes it as an option too.
- **`Ops.fits` ignores annotations.** `description`, `examples` and `$comment` are removed at every depth before the canonical comparison, and `anything()` allows them. `title` still counts, because it is part of a type's identity.
  - Without this, a described `number` would stop fitting a plain one, and the example wiring in `ui-workspace/src/composable.ts` would fail.
- Snapshots carry ops as they are, so descriptions travel with them without further change.

### Annotate

Each needs real schemas, a description per op, and examples wherever a value is meaningful:
- every bundle component (`range`, `debounce`, `log`, `input`, `map`, `filter`);
- every editor component;
- the template's `Timer` and `Picker`;
- every platform op.

Where "any value" is genuinely right (Log's `info` takes anything), it is an explicit `Type.Unknown({ description })`.

For the platform, define `Selection`, `Kind` and the snapshot shape as TypeBox schemas, and derive the TS types from them with `Static`, so there is one source for each.

Each component also gets a `description`.

### Guard test

A test (in `ui-workspace`, which merges every catalog, with the platform added) walks every op of every catalog component and the platform. Each op must have:
- a description;
- for a source: an output schema that isn't a bare `Unknown` (a `Type.Unknown` with a description is allowed);
- for an action: input and output schemas that pass the same check.

The template gets the same test over its own catalog.

### Views

- **Systems tree** (`<c-platform>`):
  - an op row's body shows the description as muted text under `in → out`;
  - examples follow as `e.g. 42`, at most 2, JSON-stringified and cut to 40 characters;
  - a component row's body shows the component's description;
  - the tree's free text also matches descriptions.
- **Wires Detail card:** shows the op's description, and each schema's description and examples, under Input and Output.
- **Instance table:** a Description column, holding the component's description.
- **Template `AGENTS.md`:** a rule: "Give every op a schema and a description, and examples where a value means something; the guard test enforces it."

### Release

This all goes into the **unpublished 0.3.0** (core, runes, elements). The template follows when the user publishes.

### Settled after the builder check

- **How a component's description reaches the views:** through the snapshot, like `component`.
  - A snapshot instance gains `description?` (from `inst.component.description`).
  - The `instance-added` delta carries it too.
  - This covers instances outside the catalog, and the views keep reading only snapshots.
- **The core runtime's own ops are in scope** (`core/src/runtime.ts`: the `registry` instance's `add`, `remove`, `subscribe`, `snapshot` and the delta sources). They are "core components" too.
  - Core defines `Snapshot`, `Delta` and `Subscription` as TypeBox schemas, with the TS types derived from them by `Static`.
  - The guard test includes these ops.
- **One description field:** views and the guard read only `Op.description`. runes fills it from:
  - a getter's or event's schema `description` (the `schemas` entry wins over `event(schema)`);
  - an action's `description`.
- **An action that takes nothing:** an omitted `in` defaults to `Type.Unknown({ description: 'Ignored: any value triggers it' })`, not `Null`.
  - Any event can still trigger it, as today (`anything()` accepts a described `Unknown`).
  - Existing wirings keep fitting.
- **Pass-through values** (Map's `map` result, Filter's, Log's `info` input) are explicit `Type.Unknown({ description })`. They still display as `any`, now with their description.
  - So the done criterion is "no **undescribed** `any`".
- **The runes API breaks** inside the unpublished 0.3.0. That's accepted.
  - Every in-repo `component()` caller changes, tests included.
  - The template's check fails until 0.3.0 is published, as it already does after the version bump.
- **The table's Description column** behaves like the others: sortable, resizable, and matched by the free text.

## Left to the builder

- The exact wording of descriptions and choice of examples, which should be real values the component would produce or accept.
- How the type-level check is written.
- Styling of descriptions and examples, using the kit's muted token.

## Done means

- Tests come first.
- The guard test passes, and every package passes.
- `tsc` is clean. The npm packages and the app build. The template check passes once 0.3.0 is published.
- No `any` is left in the tree for catalog components or the platform.
