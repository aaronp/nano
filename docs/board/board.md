---
version: 1
theme: ocean
ocean.mouse: false
effects.create: random
effects.delete: random
effects.complete: random
---
# Nano

## Backlog

### Revisit ADR-0010: an env (clock, random) on NanoContext
- id: t-01
- tags: adr, nano-core, clock
- history:
  - To Do @ 2026-11-19T12:00:00Z

```md
Due 2026-12-19. ADR-0010 kept capability pods and deferred a dev/prod `env` on NanoContext (docs/adr/decisions.md).
Re-check: did anything need time or randomness in a tight loop? Is the history cost (2 entries per call) a problem?
```

### Revisit the application's deployment policy
- id: t-02
- tags: deployment, security
- history:
  - To Do @ 2026-11-19T18:00:00Z

```md
ADR-0015: today the workspace's policy asks the user to approve each pod-made deploy. Decide who may deploy beyond
that (rules per caller, per runtime, remembered approvals) and whether host-side changes need the policy too.
```

### Sign off the new exports from the observability and Raft work
- id: t-03
- tags: exports, review
- history:
  - To Do @ 2026-11-19T18:00:00Z

```md
CLAUDE.md asks for a sign-off on each new name. Keep, inline or unexport:
- nano-core: `DeploymentAsk` (the deployment policy's parameter type)
- examples/kv: `order`
- examples/raft: `nodeIds`, `EMPTY`; test-only `createRaft`, `openRaft`, `recordedRun`, `ids`
```

### Open the message detail from a dot on the Ring
- id: t-04
- tags: ring, views
- history:
  - To Do @ 2026-11-19T18:00:00Z

```md
A dot click on the Ring pauses there but doesn't open the message detail (it lives in the workspace). Wire it as the
Desk does, without a new nano-ui option if possible.
```

### The Desk adopts `<nano-filter>`
- id: t-05
- tags: desk, views, filter
- history:
  - To Do @ 2026-11-19T20:00:00Z

```md
The Systems tree uses the shared filter; the Desk's own search and filters should use `<nano-filter>` too.
```

### The Ring adopts `<nano-filter>`
- id: t-06
- tags: ring, views, filter
- history:
  - To Do @ 2026-11-19T20:00:00Z

```md
The Systems tree uses the shared filter; the Ring's own filters should use `<nano-filter>` too.
```

## To-Do

### Roadmap
- id: t-09
- tags: roadmap
- history:
  - To-Do @ 2026-11-23T11:38:59.802Z

```md
We want to be able to:

1. easily demonstrate 'nano' in a simple way like Elysia does -- each concept
2. have a tool/means to easily package up and deploy a nano component
3. be able to share (via a URL) a nano app

And use the above to prove some good case-studies:

a. a Privy wallet
b. a Cloudflare wallet
c. Kerits.id wallet, messaging, db
```

### Have a 'Docs' page / tutorial / playground
- id: t-10
- parent: t-09
- history:
  - To-Do @ 2026-11-23T11:41:24.968Z

```md
This is item 1 in our roadmap.

https://elysiajs.com/at-glance.html is an amazing example of simple/slick

We'll want to consider if this is a nano component itself, or something different (TSDog, or a JSFiddle-like site, etc)

We want to gentle work up concepts, and also notice any areas for improvement or gaps we may have left as we build out those docs, step by step:


1. defining the interface, implementation, deployments
2. creating a web-component which uses that API: with the nano-elements (themes/styles) or not
2. running via nano (locally, in tests/headless, and also serving the UI (IDE) host app) to 'import' from file or URL
3. defining the 'sandbox' deployment, etc
4. packaging/publishing the nano web-component / json / etc
```

### Create a 'package' tool
- id: t-11
- parent: t-09
- history:
  - To-Do @ 2026-11-23T11:45:53.763Z

```md
We want a simple way to create a nano project, or add nano to an existing project.

Like how https://elysiajs.com/ shows:

> bun create elysia app

We should have the equivalent:

> bun create nano app

and an 'install' to add to an existing app.
```

### The template has no call edge to show
- id: t-12
- parent: t-09
- history:
  - To-Do @ 2026-11-23T12:53:40.000Z

```md
Found writing the Wiring concept page. The template's three pods are wired only by pipes; none declares a
dependency or calls another, so the page can only describe a call edge (`{ kind: 'call', from, to }`) in prose,
with no code from the finished template. A small pod that depends on `Store` (say, one that remembers the last
pick through `ctx.one(Store)`) would let the docs show the second kind of subscription.
```

### The timer's tick is shaped for the store, not for a timer
- id: t-13
- parent: t-09
- history:
  - To-Do @ 2026-11-23T12:53:40.000Z

```md
Found writing the Interfaces and Wiring pages. `Timer.tick` publishes `{ key: 'tick', value: String(count) }`
(an `Entry`) only so it can be piped into `Store.set`. A pipe can't adapt data, so the event's shape is bent to fit
its destination: a count becomes a string under a fixed key. Awkward to explain to a newcomer ("why is a count a
string?"). Either accept and explain it, or consider how a pipe (or a small mapping pod) carries a differently
shaped event.
```

### The spec's AppDeployment says providers; nano.json says modules
- id: t-14
- parent: t-09
- history:
  - To-Do @ 2026-11-23T12:53:40.000Z

```md
Found writing the Pods page. The pods/runtimes spec (`2026-11-14-pods-runtimes-application-design.md`, "Data")
gives `AppDeployment` a `providers` field; `design.md` and the template's `nano.json` use `modules`. The template's
README ("What a host gets") also still says `providers`. A reader sent to the spec from the docs meets a different
name.
```

### The template shows neither an eager pod nor a pod config
- id: t-15
- parent: t-09
- history:
  - To-Do @ 2026-11-23T12:53:40.000Z

```md
Found writing the Pods page. Every pod in the template's `nano.json` is `"eager": false` with no `config`, though
the timer has a config schema (`intervalMs`). The page explains eager and config with no example in the finished
code. One pod with a config (or an eager one) in `nano.json` would show both.
```

### Actions that take nothing are called with null
- id: t-16
- parent: t-09
- history:
  - To-Do @ 2026-11-23T12:53:40.000Z

```md
Found writing the Interfaces page. `start`, `stop`, `options` and `entries` take `Nothing` (`Type.Null()`), so
callers write `timer.start(null)`. It needs explaining on first sight; worth deciding whether that is the intended
reading or whether a no-input action could be called as `start()`.
```

## Doing

## Done

### Support multiple Nav Items
- id: t-07
- tags: ui
- history:
  - To Do @ 2026-11-19T17:11:13.164Z
  - Doing @ 2026-11-19T17:11:15.369Z
  - Done @ 2026-11-23T09:25:50.760Z

```md
we want to be able to 'clone' the workspace, adding our own nav items
```

### Support custom HTML layouts
- id: t-08
- tags: ui
- history:
  - Doing @ 2026-11-19T17:11:55.067Z
  - Done @ 2026-11-23T09:25:52.184Z

```md
We want to be able to turn our GridLayout into a choice of best-fit responsive layouts.

Ideally those are then used in the same/similar way in other ui-hosts
```
