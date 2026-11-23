# Pods

A **pod** is one implementation placed as data: which implementation, when to build it, and its config. One implementation can be placed many times, each pod built and configured on its own. The calculator now takes a config, checked by a schema:

<<< @/../examples/tutorial/11-pods.ts#calculator

- `.config(Precision)` declares the config's schema; `make` gets the pod's config, typed by it, as `config`.
- `make` runs once per build: what it closes over is that pod's state.

Two pods of the one calculator, one eager and one lazy:

<<< @/../examples/tutorial/11-pods.ts#deployment

<<< @/../examples/tutorial/11-pods.ts#use

- `Pod.eager` is built when the Application is created (and when `apply` adds or changes it); `Pod.lazy`, on its first need.

A config that does not fit the schema is refused when the deployment is assembled, before anything is built:

<<< @/../examples/tutorial/11-pods.ts#refused

## What it prints

```
built fine, precision 6
created
fine: 1 / 3 = 0.333333
built rounded, precision 2
rounded: 1 / 3 = 0.33
pod rounded: config does not fit Precision
{"implementation":"acme.calc/calculator","config":{"precision":2},"eager":false}
```

::: details Raw
A pod is a plain value: `Pod.lazy` and `Pod.eager` only write it. It prints the last line:

<<< @/../examples/tutorial/11-pods.ts#raw
:::

Next, [isolation](/learn/12-isolation): where a pod runs.
