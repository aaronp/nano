---
playground: 10-context
---

# NanoContext

A pod reaches the rest of the application only through what its `make` is given: the **context**. It names the pod, and gives it the pods it may call, a way to publish, and a hook for when it closes. Here the calculator uses each:

<<< @/../examples/tutorial/10-context.ts#calculator

- `ctx.self` is the pod's name; `ctx.runtimes`, the runtimes it is placed in.
- `ctx.one(History)` is the one History a call edge from this pod names, as a result value: a failure (`not-found`, `not-unique`) unless exactly one is wired. `ctx.all(History)` gives every one.
- `ctx.one(History)`'s `on(op, fn)` hears each successful `save` to that pod in that runtime, from whoever sends it, with its `{ input, output }` (an event's has no `input`). It stops when this build closes.
- `ctx.publish(op, data)` sends an event ([events](/learn/07-events)).
- `ctx.addOnCloseListener(fn)` runs when this build closes, with why: `restarted`, `removed`, `changed` or `closed`.
- `ctx.deps.history` is the sugar: the `needs` role as a plain object.

<<< @/../examples/tutorial/10-context.ts#deployment

<<< @/../examples/tutorial/10-context.ts#use

## What it prints

```
building calculator in main
history saved 2 + 3 = 5
history saved 6 * 7 = 42
calculator closed: closed
```

The second save came from the raw pod below; the calculator heard it all the same.

::: details Raw
`deps.history.save(c)` is `ctx.one(History)` looked up at each call, then its `call.save(c)`. `call` gives the result value and never throws; `deps` throws an Error carrying the failure, which becomes the calculator's own result. Without `needs`, the same calculator:

<<< @/../examples/tutorial/10-context.ts#raw
:::

Next, [pods](/learn/11-pods): when a pod is built, and its config.
