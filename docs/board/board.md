---
version: 1
theme: paper
---
# Nano

## To Do

### Revisit ADR-0010: an env (clock, random) on NanoContext
- id: t-01
- owner:
- tags: adr, nano-core, clock
- history:
  - To Do @ 2026-11-19T12:00:00Z

```md
Due 2026-12-19. ADR-0010 kept capability pods and deferred a dev/prod `env` on NanoContext (adr/decisions.md).
Re-check: did anything need time or randomness in a tight loop? Is the history cost (2 entries per call) a problem?
```

### Revisit the application's deployment policy
- id: t-02
- owner:
- tags: deployment, security
- history:
  - To Do @ 2026-11-19T18:00:00Z

```md
ADR-0015: today the workspace's policy asks the user to approve each pod-made deploy. Decide who may deploy beyond
that (rules per caller, per runtime, remembered approvals) and whether host-side changes need the policy too.
```

### Sign off the new exports from the observability and Raft work
- id: t-03
- owner:
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
- owner:
- tags: ring, views
- history:
  - To Do @ 2026-11-19T18:00:00Z

```md
A dot click on the Ring pauses there but doesn't open the message detail (it lives in the workspace). Wire it as the
Desk does, without a new nano-ui option if possible.
```

## Doing

## Done
