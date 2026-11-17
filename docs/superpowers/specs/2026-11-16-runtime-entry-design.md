# The application layer enters through a runtime; calls are events

*Proposed 2026-11-16 for the user's review. Builds on the layer map (`2026-11-16-layer-map-design.md`).*

## Why

Runtimes constrain what can see what: a `frontend` component must not reach a `backend` database except through the
API the deployment wires, or authorisation and validation can be bypassed. Between pods this holds today (call edges
within a runtime, each message policed by its runtime). The host's layer does not: `app.resolve`/`app.get` search every
runtime and `app.call(runtime, pod)` reaches any pod. And a store had to publish its own `changed` event, a runtime
concern leaking into a plain implementation.

## 1. Entering a runtime

```ts
const frontend = app.runtime('frontend')                 // the host, as a member of one runtime
const todos = frontend.get(TodoListDef.api)              // = frontend.resolve(TodoListDef.api).getOrThrow()
frontend.subscribe(TodoListDef.api.ops.add, call => …)   // calls that travel in 'frontend'; returns an unsubscribe
await frontend.call('todos').add('milk')                 // the result-returning form
```

- `app.runtime(id)` gives the runtime as the host sees it: `resolve`, `get`, `subscribe`, `call`. It only sees pods
  placed in that runtime, and every message is policed by that runtime's policy.
- **Shorthand:** `app.resolve`/`app.get`/`app.subscribe`/`app.call` are `app.runtime(only)…` when the application has
  exactly one runtime. With several they fail `not-unique` ("name a runtime"). (User's choice: option A.)

## 2. A runtime exports

`RuntimeDeployment` gains `exports?: string[]`: the interface coordinates the runtime offers to the host. A pod providing
an interface the runtime doesn't export can't be resolved, called or subscribed to from outside; pods inside still
reach it through their call edges. **Absent means everything is exported (my call: today's deployments keep working);**
`[]` exports nothing. It is data, saved in `nano.json`, and checked by `Runtime.create` (each coordinate provided by
some pod placed there).

## 3. Resolution says exactly why

```ts
type Resolution<T> =
  | { ok: true; runtime: string; pod: string; implementation: string; value: T; getOrThrow(): T }
  | { ok: false; reason: 'not-found' | 'not-exported' | 'not-unique'; fail: Fail; getOrThrow(): never }
```

`not-found`: no pod in that runtime provides it. `not-exported`: one does, but the runtime doesn't export it.
`not-unique`: several do (or, for the shorthand, several runtimes). Each is also the `Fail`'s type.

## 4. The call is the event

Subscribing to an action delivers each successful call as `{ input, output }`, after it returns, in the runtime it
travelled in. The runtime does it; the implementation doesn't know. So `KeyValueStoreDef` goes back to plain CRUD: no
`changed` event, no publish callback in `memory.ts`. Pipes keep delivering an action's output as today (option B).
Subscribing is asked of the runtime's policy (`isAllowed('host', pod, 'subscribe')`), as adding a subscription already is.

## Proven by

The todo example: a `frontend` runtime holding `todos`, a `backend` runtime holding `store`, wired by a call edge where
both are placed; `frontend.get(TodoListDef.api)` works, `frontend.get(KeyValueStoreDef.api)` is `not-found` (or
`not-exported` when placed but not exported), `app.get(...)` is `not-unique`; a subscriber to `store`'s `put` in
`backend` receives `{ input, output }` and one in `frontend` receives nothing. Plus unit tests for each reason, exports
checking, and subscription policing. All suites, `tsc`, the structure test and Playwright stay green.

## New public names (for the user's approval)

`app.runtime(id)` and its `resolve`/`get`/`subscribe`/`call`; `app.subscribe`; `RuntimeDeployment.exports`;
`Resolution` as the union above with `reason`; FailTypes **`not-exported`** (new) and **`not-unique`** (replacing
`ambiguous` everywhere, so one thing has one name).

## Not in this step

The load policy (deferred); events published by `ctx.publish` reaching application subscribers (only action calls
here); payloads on the general stream.
