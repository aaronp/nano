# Writing a deployment at the call site: resolve, create, and the data it records

*Proposed 2026-11-17 for the user's review. Items marked **(my call)** were mine; the user can overturn them.*

## The user's idea

Wire an application in code, with types at the call site, and get the deployment as data: the pods, their call
edges and the policy rules that let them in. For example, resolve the key/value store in `backend`, then create the
todo list in `frontend` over it. The result is the `nano.json` that could be saved, shared or applied.

## Built on what exists

- **Resolving** is today's `resolve`, read over deployment data instead of a running app. It answers the coordinates
  of the one pod providing an interface in a runtime (`runtime`, `pod`, `implementation`).
- **An implementation** is today's `api.impl(coord).needs({ … }).make(…)`. The inline factory (`({ deps }) => …`, its
  `deps.store` being "the kvs") is written there and has a coordinate, so a deployment can name it. A bare closure
  can't be saved, so `create` takes an implementation.
- **What gets recorded** is today's data: a pod in `pods`, its placement in `runtimes.<id>.pods`, a `call` edge in the
  runtime of the pod it reaches, and a `PolicyRules` rule there that lets it in.
- **Making it live** is today's `Application.create` (before) or `app.apply` (after).

## The API

```ts
const d = AppDeployment.edit({ pods: {}, runtimes: { frontend: …, backend: … } }, registry)   // or app.deployment()
d.place(kvMemory, { pod: 'store', in: 'backend' })               // a pod with nothing to reach
const kvs = d.resolve('backend', KeyValueStoreDef.api)           // { runtime: 'backend', pod: 'store', implementation }
kvs.create(todosKv, { pod: 'todos', in: 'frontend' })            // pod + edge todos→store (in backend) + rule (if backend has rules)
const data = d.deployment()                                      // the AppDeployment: save as nano.json, assemble, create or apply
```

- `AppDeployment.edit(base, registry)` copies `base` and gives a builder. The registry is only used to read what
  each pod provides. Nothing runs.
- `place(impl, { pod, in, eager? })` adds a pod and places it.
- `resolve(runtime, api)` is the one pod placed there providing `api`. Like the running form, it throws
  `not-found` or `not-unique`.
- `handle.create(impl, { pod, in, eager? })` places a new pod and records its edge to the handle's pod in the
  handle's runtime. If that runtime's policy is `rules`, it **prepends** `{ allow: ['call', 'subscribe'], from: pod,
  outside: <pod not placed there>, toInterface: api }`. With no policy (allow-all), nothing needs adding.
  **(my call: prepended, since the first match wins and the operator asked for exactly this edge.)** It returns the
  new pod's handle, so chains like `kvs.create(todos).create(ui)` read top-down.
- `deployment()` gives the data. A pod whose implementation needs a role it wasn't wired for fails at `assemble`, as
  today.

## Case-study tests (`examples/todo/build.test.ts`)

1. **Code gives the checked-in `nano.json`.** Build the todo app from code (place `store`, resolve it, create
   `todos` over it, add the host rule) and `expect(d.deployment()).toEqual(<nano.json>)`. The code and the data say
   the same thing.
2. **It runs.** `Application.create` from the built data, then `frontend.get(TodoList).add('milk')` works, and every
   `todos → store` call is `sent` in `backend`.
3. **Editing a running app.** Start with `backend` holding only `store`, then
   `AppDeployment.edit(app.deployment(), registry)`, resolve, create `todos` in `frontend`, and `app.apply(...)`.
   The todo list works, and `app.deployment()` now carries the edge and the rule.
4. **The rule is what lets it in.** In the same built app, a second pod given an edge to `store` by hand (no
   rule) is `denied` on its first call, while `todos` is allowed.
5. **The errors are the running ones.** Resolving an interface no pod provides throws `not-found`, and with two
   providers `not-unique`.

## New public names (for the user's approval)

`AppDeployment.edit(base, registry)`, and its builder: `place`, `resolve`, `deployment`. The handle: `runtime`, `pod`,
`implementation`, `create`. `using` is not added: it would restate `resolve`.

## Not in this step

Registering implementations into a running app's registry (for now an edit can only use implementations the app was
created with); `modules` URLs filled in by the builder; pipes and tags from the builder (add them to the data by
hand); the messaging case study (a), which comes next and uses this.
