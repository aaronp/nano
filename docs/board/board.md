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

### Support multiple Nav Items
- id: t-07
- tags: ui
- history:
  - To Do @ 2026-11-19T17:11:13.164Z
  - Doing @ 2026-11-19T17:11:15.369Z

```md
we want to be able to 'clone' the workspace, adding our own nav items
```

### Support custom HTML layouts
- id: t-08
- tags: ui
- history:
  - Doing @ 2026-11-19T17:11:55.067Z

```md
We want to be able to turn our GridLayout into a choice of best-fit responsive layouts.

Ideally those are then used in the same/similar way in other ui-hosts
```

## Doing

## Done
