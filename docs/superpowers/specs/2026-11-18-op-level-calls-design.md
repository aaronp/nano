# Op-level calls: declared, observed, reconciled

Status: draft for review. Builds on `design.md` and `2026-11-14-pods-runtimes-application-design.md`.

## Why

Connections and Systems show a call edge as "pod A is built on pod B". The user wants to see *what calls what*:
`messaging`'s `send` calls `chatStore`'s `save`. A call and a pipe are the same thing in nano's terms — a message
from a sender op to a receiver op — so calls should be modelled like subscriptions: **declared** (design time, as
data, checkable against policy) and **live** (observed while running, the way a connection is the live form of a
subscription), with the live reality available as a deployment that can be rendered and, explicitly, saved.

Success: open the chat example; Connections draws `alice.say → messaging.send`-style lines between op ports for calls,
as it does for pipes; Systems lists a pod's outgoing and incoming op calls; a call made at runtime that nobody declared
appears, marked "observed, not declared", and a Reconcile writes it into the deployment.

## Goals

1. **Declared on the implementation.** An implementation states which of its ops call which ops of its dependency
   roles: the component's promise, true wherever it is deployed.
2. **Recorded on the deployment.** A call edge (`{ kind: 'call', from, to }`) may list the op pairs that flow along it.
   When a pod is placed (and its edges made), the pairs are derived from 1.
3. **Observed while running.** Each call message knows its sender op (the op whose handler made it), so the trace can
   say `from.op → to.op`. An observer over a runtime's `AppEvent` stream keeps the live set of op calls (and the live
   `on` connections) and can give the **observed deployment**: the declared one plus what was seen.
4. **Reconcile explicitly.** The user chooses at save time: save as declared, or reconcile (write observed pairs into
   the deployment). Nothing is written back silently.
5. **Views.** Connections draws op-to-op call lines (gated by the existing "Call edges" checkbox), solid when
   declared, distinct when observed-only. Systems shows the pairs on a pod, an operation (calls / called by) and an
   edge.

## Non-goals (separate designs, agreed order after this)

- Sender-op selectors in policy rules (a `fromPort`-style match). This design only makes the data available.
- A Deployment Policy (which pods may be placed in which runtimes, layered: runtime-shipped and author-declared).
- Renaming the existing `Policy`.

## Anti-goals

- A second way to deliver data, or a call that bypasses the call edge. The edge stays the swap point: it chooses
  *who* answers; the op pairs say *which ops* are used.
- Declarations that are enforced by surprise. Undeclared calls still work exactly as today (the runtime's policy
  decides); they are *visible*, not blocked, in this step.
- Instrumenting component code. Authors write `ctx.deps.store.save(x)` as now.

## What exists (and is reused)

- Calls are messages: `sent` `{ runtime, kind: 'call', from, to, port }`, then `delivered` / `denied`, with a chain
  (`id`, `correlation`, `cause`). Pipe deliveries and emissions carry `cause`; **a call made from a handler's code
  starts a new chain today**, so the sender op is not recorded. That is the one runtime change here.
- Implementation `dependencies: Record<role, SelectorData>`; `ctx.deps.role.op(x)` calls through `one(role)`.
- `Subscription` call edge `{ kind: 'call', from, to }`; pipe `{ kind: 'pipe', from, source, to, target }`.
- `app.listen` / `runtime.listen` — the observer reads only this.
- `AppDeployment.edit(...).create` places a pod with its edge; the workspace's auto-connect does the same.

## Decisions (the user's)

- The sender of a call is **the op on the pod** whose handler made it (`messaging`'s `send`), not the pod.
- Declare on **both** the implementation (promise) and the deployment's call edge (record).
- The observer tracks live calls *and* live subscriptions; its observed deployment is what the views render and what
  can be exported.
- Saving is an explicit choice: as declared, or reconciled.
- `on` made from code (today "in no deployment", D91/D92) becomes visible in the observed deployment. The declared
  deployment is unchanged, so D91/D92 still hold for it; this is a reading, not a revision, unless reconciled.

## Shape (proposed; every new name needs the user's yes, per CLAUDE.md)

- Implementation: `calls?: { [op: string]: string[] }` — an op of this implementation to `role.op` names it calls,
  e.g. `{ send: ['store.save', 'store.list'] }`. Checked at define: the op is one this implementation provides, the
  role is a dependency, and the op exists on the role's interface (when it names one).
- Call edge: `ops?: { source: Port; target: Port }[]` on `{ kind: 'call', from, to }`. `source` is a port of `from`'s
  implementation, `target` a port of `to`'s. Checked by `Runtime.create` like a pipe's ports.
- Sender on the message: the `sent` event of a call made inside a handler gets `cause` = that handler's message id
  (and its correlation), so `cause`'s port is the sender op. How the context knows the running handler is the
  builder's choice (the handler's chain passed to the build's `deps`/`one` client per invocation is the obvious one;
  `AsyncLocalStorage` is not available in the browser frame).
- Observer: a function over `listen` that gives `{ deployment(): AppDeployment, notDeclared(): ... }` and an event on
  change. Lives in nano-core if the workspace and tests both need it; else the workspace.

## Answered after the builder check (the user's)

- **Attribution: nano wraps each handler invocation** with its own `deps` (and `one`/`all`) that know the running op,
  so component code is unchanged. Calls outside any handler (sources, timers, `on` callbacks, close listeners) have no
  sender op and are shown as from the pod.
- **A new field, not `cause`:** a call's `sent` event gets `by: <message id>` (the handler's message), leaving
  `cause` and `correlation` as they are. (`by` is the approved name.)
- **`on` is shown, never reconciled:** live `on` connections appear in the views and the observed deployment's
  reading, but Reconcile writes only call op pairs. Persisting `on` would need a new subscription kind: a later design.

This supersedes "Sender on the message" under Shape (no `cause` reuse) and goal 4's scope (op pairs only).

## Calls made from the builder check (Claude's, for the user to check)

- An edge with no `ops` means "derive from the implementation's `calls`": old and saved deployments keep working, and
  only calls beyond the declaration show as not declared.
- A declared pair goes on every call edge from the pod whose `to` provides the role's interface. An observed pair goes
  on the edge the call actually travelled.
- The observer lives in the workspace first, so there is no new nano-core export. It moves to core only if the user agrees.
- Sandboxed pods pass the sender through the frame protocol, because the examples import sandboxed by default and the
  feature would show nothing for them otherwise.
- Calls from the host and denied calls are shown, not reconciled: the host has no op, and a denied call has no edge.

## Left to the builder

- Exact names (`calls`, `ops`, the observer's) — propose, then ask.
- How a frame (sandboxed pod) reports its sender: the host stand-in sees the call; the frame protocol may need the
  cause passed through.
- Drawing: the observed-only style in Connections; the Systems layout.
- Whether `design.md`'s 150-line and 10-member limits push the observer into its own file (they will).
