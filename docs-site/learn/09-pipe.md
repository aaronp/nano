---
playground: 09-pipe
---

# A pipe

In the last step the calculator still knew it had a history. With an event, it need not: it publishes `calculated`, and a **pipe** carries each one into `History`'s `save`. The calculator has no `needs`; it is the one from [events](/learn/07-events).

<<< @/../examples/tutorial/09-pipe.ts#interfaces

`calculated`'s data and `save`'s input are the same schema, `Calculated`. That is what lets a pipe join them.

<<< @/../examples/tutorial/09-pipe.ts#pipe

- A pipe names its two ends: `from` a pod's `source` op, `to` a pod's `target` action. `port(Calculator, Calculator.ops.calculated)` is the op's name in a deployment, `acme.calc.Calculator/calculated`.
- Each event published is delivered to `save` as its own message.

<<< @/../examples/tutorial/09-pipe.ts#use

The pipe is checked when the deployment is assembled: the source's data must have the target's input schema (nano compares the schemas themselves, not their names), or the pipe is refused. Piping `calculated` into `load`, whose input is `null`, is refused:

<<< @/../examples/tutorial/09-pipe.ts#refused

## What it prints

```
[{"a":2,"op":"+","b":3,"result":5},{"a":6,"op":"*","b":7,"result":42}]
runtime main: calculator->history (acme.calc.Calculator/calculated to acme.calc.History/load): acme.calc.Calculator/calculated does not fit acme.calc.History/load
```

So define the data once (`Calculated`) and use that one value on both sides.

Next, [NanoContext](/learn/10-context): what `make` is given.
