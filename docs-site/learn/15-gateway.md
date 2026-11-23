---
playground: 15-gateway
---

# An app gateway

An application can hold several runtimes, each its own pods, wiring and policy. Two runtimes meet only where they share a pod: one pod placed in both, an **app gateway**. Here `front` calculates, `back` reports, and the history is the gateway. A report:

<<< @/../examples/tutorial/15-gateway.ts#report

The history is listed in both runtimes' `pods`:

<<< @/../examples/tutorial/15-gateway.ts#deployment

- In `front`, a pipe carries the calculator's `calculated` into the history's `save`.
- In `back`, a call edge lets the report reach the history.
- It is one pod, so one build: what `front` saves, `back` loads.

<<< @/../examples/tutorial/15-gateway.ts#use

Nothing else crosses. `back` has no calculator to find, and a call edge from the report to the calculator is refused, as the calculator is not placed in `back`:

<<< @/../examples/tutorial/15-gateway.ts#apart

## What it prints

```
built calculator
built history
built report
2 calculations, total 47
no pod provides acme.calc.Calculator in back
runtime back: report->calculator: calculator is not placed here
```

Each message to the history travels in one runtime, the one its call edge or pipe is in, and that runtime's [policy](/learn/13-policies) decides it: the gateway answers both runtimes, each on its own terms.

Next, [a view](/learn/16-view): the calculator on a page.
