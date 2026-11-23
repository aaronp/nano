---
playground: 02-contract
---

# The contract

In nano the contract comes first: an **interface** names what a component offers, and every op in it carries a TypeBox schema for what goes in and what comes out. The calculator's one op is `calculate`, an action from a `Sum` to a `Calculated`:

<<< @/../examples/tutorial/02-contract.ts#contract

- `Coord.namespace('acme.calc')` is your namespace; `ns.interface('Calculator', …)` defines `acme.calc.Calculator` in it.
- `Schema.define` pairs a schema with a hash of it; an op's identity is computed from its name and those hashes.
- `Op.action(input, output)` is a call that answers. (Events come later.)

The TypeScript types come from the schemas, so they cannot drift apart:

<<< @/../examples/tutorial/02-contract.ts#types

The same schemas check values at run time:

<<< @/../examples/tutorial/02-contract.ts#check

## What it prints

```
acme.calc.Calculator has calculate
{ a: 2, op: '+', b: 3 } fits: true
{ a: 2, op: '%', b: 3 } fits: false
```

Next, [an implementation](/learn/03-builder) of this contract.
