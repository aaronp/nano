# @pritzlaff/nano-core

The nano model: schemas, ops, interfaces, results, implementations, providers, the registry, pods, runtimes,
deployments (checked values) and the one live `Application`. The map is [design.md](../../design.md).

0.4.0 replaces the 0.3 model. Components, runes and the old registry are gone; see the
[model spec](../../docs/superpowers/specs/2026-11-14-pods-runtimes-application-design.md).

```ts
import { assemble, createRegistry } from '@pritzlaff/nano-core'
assemble({ pods: {}, runtimes: {} }, createRegistry())   // success({})
```
