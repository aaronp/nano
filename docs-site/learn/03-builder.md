# An implementation, with the builder

The contract says what; an **implementation** says how. You start from the interface, so TypeScript knows each method's input and output from the schemas:

<<< @/../examples/tutorial/03-builder.ts#builder

- `Calculator.impl(ns.implementationId('calculator'))` names it `acme.calc/calculator`, under your namespace.
- `make` returns a plain object with a method per action. It runs once each time the component is built; anything it closes over is that build's state.
- A method's return value is its result; a throw becomes a failure (more in [results](/learn/06-results)).

The implementation is a value: nothing runs yet.

<<< @/../examples/tutorial/03-builder.ts#describe

## What it prints

```
acme.calc/calculator provides acme.calc.Calculator
acme.calc/calculator provides acme.calc.Calculator
```

::: details Raw
The builder ends in `Implementation.define`. Written out, `make` returns `provide(interface, handlers)` parts, and each handler returns a result value: `success(value)`, or `failure(type, reason)`, where the builder turns a throw into `failure('threw', message)`. The second line above is this one:

<<< @/../examples/tutorial/03-builder.ts#raw
:::

Next, [the Registry](/learn/04-registry): where implementations are found.
