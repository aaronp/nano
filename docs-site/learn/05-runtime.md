# A Runtime

To run the calculator, place it. A **pod** is one component described as data: an implementation and how to build it; `Pod.lazy` builds it on its first call. A **Runtime** is pods placed together, with the call edges and pipes between them (none yet). An **Application** is the one live thing: it builds the pods and delivers every message.

<<< @/../examples/tutorial/05-runtime.ts#deployment

- The deployment is plain data (a `nano.json` is the same, saved). `AppDeployment.assemble` checks it against the Registry and gives its runtimes.
- `Application.create` starts them.

Call the calculator from outside, through runtime `main`. `get(Calculator)` finds the one pod there that provides it and gives a plain object, typed by the contract:

<<< @/../examples/tutorial/05-runtime.ts#typed

## What it prints

```
2 + 3 = 5
{"ok":true,"value":{"a":2,"op":"+","b":3,"result":5}}
```

::: details Raw
`app.call(runtime, pod)` calls a pod by name and gives each call's result value, `{ ok, value }` or `{ ok: false, fail }`, where `get` unwraps it (and throws on a failure). It prints the second line:

<<< @/../examples/tutorial/05-runtime.ts#raw
:::
