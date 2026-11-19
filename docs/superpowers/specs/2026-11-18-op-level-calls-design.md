# Op-level calls: declared, observed, reconciled

Status: approved 2026-11-18. Builds on `design.md` and `2026-11-14-pods-runtimes-application-design.md`.

## The concern

Nano shows *that* pod A may call pod B (the call edge), not *which op calls which op*, either as designed or as it
actually happens. Pipes have that detail; calls don't. The root cause: a handler does not know which op it is.
`NanoContext` belongs to the pod (made once at build, closed over by every handler), and the runtime invokes a handler
with `input` only, so nothing a handler sends can say "this came from `messaging.send`".

## Decisions (the user's)

1. **Two origins.** *Lifecycle* code (the factory at mount, pod-change listeners, close listeners, sources, timers)
   runs under the pod's `NanoContext`, as today; its messages have no sender op (the pod is the sender). *Op* code (a
   handler running for an action call, a pipe delivery or an `on` emission) runs under an **invocation context** that
   knows its pod and op.
2. **Handlers get that context.** The runtime calls `handler(input, ctx)`. `ctx` is the pod's `NanoContext` plus an
   optional `callingOp` (the port being handled). Calls and publishes through it are sent with the sender op and
   continue the invoking message's chain (`correlation`, `cause` = the invoking message's id). A handler that ignores
   the second argument behaves as today and is attributed to the pod. (Open, lean: one type, `NanoContext` with an
   optional `callingOp`; a separate `OpContext` only if a test shows lifecycle code misusing op-only members.)
3. **Declared calls.** `Implementation.define(..., { calls: { send: ['store.save'] } })`: an op of this implementation
   to the `role.op` names it calls. Checked at define: the op is provided here, the role is a dependency, and the op
   exists on the role's interface (when the role names one).
4. **Recorded calls.** A call edge may carry `ops: { source: Port; target: Port }[]`. Absent means "derived from the
   caller's `calls`". A declared pair belongs on every call edge from the pod whose `to` provides the role's
   interface; `Runtime.create` checks the ports as it checks a pipe's.
5. **Observed calls.** An observer (in the workspace first; no new nano-core export) reads `listen` and keeps the live
   picture: the declared pairs, plus observed pairs marked "not declared", plus live `on` connections. It gives the
   observed deployment for the views and export.
6. **Explicit save.** Save as declared, or Reconcile: observed call pairs written into the edges' `ops`. Live `on`s are
   shown, never saved (persisting them would need a new subscription kind). Calls from the host and denied calls are
   shown, not reconciled.
7. **Frames.** A sandboxed pod's op is invoked by port across the frame protocol; the frame's handler gets the same
   invocation context, and its calls carry the sender op back to the host.

New names approved: `calls` (Implementation), `ops` (call edge), `callingOp` (context).

## Out of scope (next, in order)

- Pods deploying pods from an op (`authenticate` creating a `KeyValueStore` pod) under the op's correlation.
- Sender-op selectors in policy rules.
- A Deployment Policy (placement; runtime-shipped and author-layered).

## Value

- **See:** Connections and Systems show `messaging.send → chatStore.save`, not "messaging is built on chatStore".
- **Check:** declared pairs are data; a deployment can be checked before it runs (later: by policy).
- **Trust:** observed reality is compared with the declaration; drift is shown, not hidden.
- **Groundwork:** the chain carried through a handler's ctx is what `authenticate` and sender-op policy build on.

## Examples and tests that show it

- **chat:** `alice.say → messaging.send → chatStore.save`, one declared chain op to op across three pods, one
  correlation.
- **todo:** `todos.add → todoStore.put` declared and drawn; an undeclared `todoStore.list` from a refresh timer shows
  as from the pod `todos`, not declared (the lifecycle-vs-op trade-off).
- **drift (new small case study):** a component declares `submit → store.save` but also calls `store.delete`; the
  observer flags it, Reconcile adds it.
- **Unit:** two concurrent `send` invocations are each attributed correctly; a handler ignoring `ctx` is attributed to
  the pod; a `calls` naming an unknown op or role is refused at define; an edge's `ops` with a port its pods lack is
  refused by `Runtime.create`.

## Constraints

- CLAUDE.md: no other new exports or concepts without the user; files in packages/nano ≤150 lines; every export in
  `design.md`; the structure baseline only shrinks.
- Component code that ignores the new argument is unchanged.
