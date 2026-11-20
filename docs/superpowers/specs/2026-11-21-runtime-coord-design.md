# RuntimeCoord, and selectors built from coordinates (nano-core)

Small change, before the Platform (pages as their own layer). Decision: ADR-0037.

## Intent
Coordinates compose: `PodCoord` already holds an `ImplCoord` (namespace + name), but its runtime is a bare string, and
`SelectorData`'s fields are all strings. The Platform's slots will be pod coordinates and selectors, so make them
type-checked composition first, so a pod name can't stand where a runtime belongs.

## Design
```ts
type RuntimeCoord = { kind: 'runtime'; id: string }            // toString() = id; Coord.runtime(id), Coord.parse('runtime', s)
type PodCoord     = { kind: 'pod'; implementation: ImplCoord; runtime: RuntimeCoord; pod: string }   // string form unchanged
type SelectorData = { implements?: InterfaceCoord; implementation?: ImplCoord; provider?: Namespace;
                      runtime?: RuntimeCoord; tags?: string[] }
```
- `Coord.runtime(id)` checks the runtime id rule (the `Id` rule runtime ids already follow); a bad id throws like the
  other builders. `Coord.parse('runtime', s)` reads one back.
- One way: selectors take coordinates, never strings. `Selector.of(DB, { runtime: Coord.runtime('v2') })`.
- Serialised forms are unchanged: wherever a selector or pod coordinate is written (nano.json, the registry manifest,
  recordings, observed calls), it is the coordinate's string; reading parses it back. Existing documents and
  recordings still load.
- Boundary (stays plain strings, deliberately): ids used as keys and names in data and APIs (`runtimes` keys,
  `app.runtime(id)`, `ctx.runtimes`, `Target.runtime`), and the `runtime` field of `AppEvent`s and policy `Ask`s.
- Every call site in nano, ui, ui-workspace and examples moves in the same change.

## Testing
`Coord.runtime` (valid, invalid, parse round-trip), `Coord.pod` with a `RuntimeCoord` (string form unchanged, parse
round-trip), `Selector.of` and `matches` with coordinate fields, a dependency declared with a coordinate selector
resolving as before, a manifest/serialised selector reading back, an old nano.json and an old recording loading.
