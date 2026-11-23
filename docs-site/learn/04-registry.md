---
playground: 04-registry
---

# The Registry

Before anything runs, nano needs to know what it *can* make. The **Registry** is that: a pool of providers, each a namespace's list of implementations, looked up by coordinate.

<<< @/../examples/tutorial/04-registry.ts#registry

- `ns.provider([calculator])` is the `acme.calc` provider; every implementation in it must be under `acme.calc`.
- `registry.add` returns a result instead of throwing: it refuses a provider already added, or an interface that differs from one of the same name.

Ask it what it holds, or what makes a given interface:

<<< @/../examples/tutorial/04-registry.ts#lookup

## What it prints

```
provider acme.calc: acme.calc/calculator
acme.calc.Calculator is made by acme.calc/calculator
```

Still nothing runs. Next, [a Runtime](/learn/05-runtime) places the calculator and we call it.
