---
playground: 07-events
---

# Events

A result goes back to the one caller. An **event** goes out to whoever listens, without the calculator knowing who. The contract names it, with its data's schema:

<<< @/../examples/tutorial/07-events.ts#interface

The calculator publishes `calculated` after each calculation, through the context `make` is given:

<<< @/../examples/tutorial/07-events.ts#calculator

- `ctx.publish(Calculator.ops.calculated, data)` sends it; the data must fit `Calculated`.
- The plain object has a method for each op of the contract, events too. This one yields nothing: `calculate` publishes.
- A failed calculation throws before publishing, so it publishes nothing.

From outside, the typed client's `calculated()` listens. It hears every event from the moment it is called; `break` stops listening:

<<< @/../examples/tutorial/07-events.ts#listen

## What it prints

```
heard 2 + 3 = 5
heard 6 * 7 = 42
{"output":{"a":1,"op":"-","b":4,"result":-3}}
```

::: details Raw
`runtime.subscribe(op)` listens to an op by its constant and gives each emission as `{ input, output }` (an event has no `input`; pass a callback as a second argument to get an unsubscribe instead). It prints the third line:

<<< @/../examples/tutorial/07-events.ts#raw
:::

Next, [a history](/learn/08-history), kept by sending messages.
