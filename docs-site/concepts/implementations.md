# Implementations and providers

An interface says what; an **implementation** says how. It names the interfaces it provides and has a `make` function that builds one working instance: its state, and a handler for each action.

<<< @/../templates/nano-template/src/timer.ts#timer-implementation

Reading it from the top:

- `ns.implementationId('timer')` is its name, `acme.template/timer`, which a `nano.json` uses to say which code a pod runs.
- `config` is the schema of the settings a pod may pass it (here an optional `intervalMs`).
- `make(ctx, config)` runs once per pod, when the pod is first needed. What it closes over (`clock`, `count`) is that pod's state. `ctx` is the pod's link to the rest of the app: `ctx.publish` sends an event, `ctx.addOnCloseListener` cleans up when the pod is closed.
- `provide(Timer, { … })` pairs the interface with its handlers. A handler returns `success(value)` or `failure(code, message)`; nothing throws.

**When it runs:** `start` begins counting and publishes each count as `tick`; a second `start` doesn't start a second clock; `stop` ends it, and no ticks follow.

A **provider** is the set of implementations one module offers, under one namespace. It is the module's default export, and it is what a host loads:

<<< @/../templates/nano-template/src/index.ts#provider

The model's definition: `design.md` ("How it works", step 1), and the implementation's factory in `docs/superpowers/specs/2026-11-14-values-and-application-design.md` ("Implementation and its factory").
