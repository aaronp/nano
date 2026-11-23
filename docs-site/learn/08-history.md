# A history, by message

The calculator should remember what it calculated. It is not handed a store: it **needs** a `History` and sends it `save` messages. Which History answers is the deployment's choice, not the calculator's.

<<< @/../examples/tutorial/08-history.ts#history-interface

<<< @/../examples/tutorial/08-history.ts#calculator

- `.needs({ history: History })` declares a role, `history`, that some pod providing `History` fills.
- `deps.history` is that pod as a plain object, typed by `History`. `save` is a message to it, and waits for its result.

Two Histories: one in memory, one that also logs each save.

<<< @/../examples/tutorial/08-history.ts#histories

A **call edge**, `{ kind: 'call', from: 'calculator', to }`, says which pod the calculator reaches. The deployment places all three pods; only `to` changes, first `'memory'`, then `'logged'`:

<<< @/../examples/tutorial/08-history.ts#deployment

<<< @/../examples/tutorial/08-history.ts#use

Two pods provide `History` here, so `get(History, { pod: to })` names the one to read.

## What it prints

```
memory: 2 + 3 = 5, 6 * 7 = 42
saved 2 + 3 = 5
saved 6 * 7 = 42
logged: 2 + 3 = 5, 6 * 7 = 42
```

The calculator did not change; the edge did.

::: details Raw
`needs` sets the implementation's `dependencies`. `deps.history` looks up the pod through the call edge at each call (`ctx.one(History)`, a later step); a failure there throws an Error carrying the `fail`, which the calculator's own result then carries.
:::

Next, [a pipe](/learn/09-pipe): the history without the calculator knowing of it.
