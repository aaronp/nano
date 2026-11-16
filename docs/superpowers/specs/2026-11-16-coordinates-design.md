# Coordinates as typed values; providers are authors; `modules` in nano.json

*Agreed with the user on 2026-11-16. Items marked **(my call)** were mine; the user can overturn them.*

## Why

The old core had a structured coordinate (`Coord = { registry, instance }`). The 2026-11-14 model replaced every
coordinate with a string checked by the `COORD` pattern, without anyone deciding to replace it. Coordinates come back
as rich, kind-checked values that layer (an instance's coordinate is an implementation's plus where it runs). Strings
stay the saved form, so `nano.json` doesn't change shape.

"Provider" meant three things. It now means one: **the author who supplies implementations** (GCP, AWS, a
consultancy), possibly of someone else's contract.

## Coordinates (`packages/nano/src/coord.ts`)

| Kind | Is | String form |
|---|---|---|
| `Namespace` | an author's dotted name | `example.kv` |
| `InterfaceCoord` | namespace + name (the contract author's namespace) | `example.kv.KeyValueStore` |
| `ImplCoord` | namespace + name (the provider's namespace) | `aws.kv/dynamo` |
| `PortCoord` | interface + op name | `example.kv.KeyValueStore/get` |
| `PodCoord` | implementation + runtime + pod (the instance) | `aws.kv/dynamo@main/store` **(my call)** |

- Built by layering: `const kv = Coord.namespace('example.kv')`, `kv.interfaceId('KeyValueStore')`,
  `kv.implementationId('memory')`, `Coord.port(i, 'get')`, `Coord.pod(impl, 'main', 'store')`. A namespace also builds (layer 2): `kv.interface(name, ops)` is
  `Interface.define(kv.interfaceId(name), ops)` and `kv.provider(impls, meta?)` is `Provider.define(kv, impls, meta)`.
- Each is a frozen value with a `kind` and `toString()` giving its string form. A bad part throws, as the builders do today.
- `Coord.parse(kind, s)` reads a string back. The kind is required: a port string reads as an implementation
  coordinate otherwise.
- Op and schema coordinates stay content hashes: they let pipes check that two ends fit.
- `Interface.define` and `Implementation.define` take a coordinate or its string **(my call: callers move over as
  they are touched)**; the values they make keep their string `coord`, so saved data and lookups are unchanged.

## Providers and modules

- `Provider.define(ns, implementations, meta?)` keeps its shape: the provider's own namespace and what it supplies. An
  implementation's namespace must be its provider's. An interface's namespace is its contract author's, which may differ.
- `AppDeployment.providers` (namespace → URL of the code to load) is renamed **`modules`**. Host-owned as before;
  every `nano.json`, the template and the workspace host move to it.

## Proven by

`packages/nano/test/coord.test.ts`: each kind formats and parses back; the wrong kind is refused; bad parts throw;
layering keeps its parts; the builders accept a coordinate. All suites, `tsc`, the structure test and Playwright stay
green. `design.md` lists the new exports.

## Not in this step

Subscriptions, selectors, pods and the stream keep naming pods and runtimes by string; moving them to `PodCoord` is
later, if ever. The contract template (`KeyValueStoreDef`) comes next, on top of this.
