---
id: ADR-0001
title: Observe a nano app with a time machine over its recorded messages
status: accepted
date: 2026-11-18
revisit: 
tags: observability, time-machine
decision: tools
---

## Goal
Event-driven observability for any nano app: record it from its start, move a cursor over the recording by hand or on
a scaled ticker, and let views (the time bar, the Messages table, the Desk's dots, later the Ring view) react the same
whatever moves time. Spec: `docs/superpowers/specs/2026-11-18-time-machine-design.md`.

## Hypothesis
- We believe: 
- Will result in: 
- Measured by: 

## People
- Project owner — decider
- Claude — author

## Criteria
| id | criterion | weight | description |
| --- | --- | --- | --- |

## Solution: tools — Plain web components and modules, not pods
The time machine and its views send no nano messages, so they are never recorded: no recursion, and the observed app
is never touched. State at a time t comes from folding the history (cheap) or from a shadow app replayed to t (exact).

| criterion | score |
| --- | --- |

Pros:

Cons:

## Solution: pods — Observability as nano pods
The tools would be pods in the app. Their own messages would be recorded, so recording them needs a no-op mode.

| criterion | score |
| --- | --- |

Pros:

Cons:

## Decision
Plain web components and modules. Reset means reset and clear (restart every pod, start a fresh clean recording).
The in-memory history keeps 100,000 entries; past that, the bar says "history too long to rebuild state".

---
id: ADR-0002
title: A message's travel window is constant in recording time
status: proposed
date: 2026-11-18
revisit: 
tags: time-machine
parent: ADR-0001
decision: constant
---

## Goal
Each message in flight is drawn for a visual travel time (600 ms at speed 1). Decide what the speed setting scales.

## Hypothesis
- We believe: 
- Will result in: 
- Measured by: 

## People

## Criteria
| id | criterion | weight | description |
| --- | --- | --- | --- |

## Solution: constant — Constant window; speed scales cursor motion
The window is a constant `travelMs` (600) of recording time; on screen a message takes `travelMs / speed`. Frames are
a pure function of the cursor.

| criterion | score |
| --- | --- |

Pros:

Cons:

## Solution: scaled — Scale the window by speed
The window itself changes with speed, so the same cursor gives different frames at different speeds.

| criterion | score |
| --- | --- |

Pros:

Cons:

## Decision
Constant window. If wrong: retune one constant.

---
id: ADR-0003
title: Live mode ticks frames on the recording's clock while anything is in flight
status: proposed
date: 2026-11-18
revisit: 
tags: time-machine
parent: ADR-0001
decision: date-now
---

## Goal
In Live mode the cursor follows the newest entry, but dots must keep moving between appends.

## Hypothesis
- We believe: 
- Will result in: 
- Measured by: 

## People

## Criteria
| id | criterion | weight | description |
| --- | --- | --- | --- |

## Solution: date-now — Tick while in flight, on Date.now
Live mode keeps emitting frames while any message is in flight; the default ticker's `now` is `Date.now`, the clock
that stamps entries.

| criterion | score |
| --- | --- |

Pros:

Cons:

## Decision
Tick while in flight on `Date.now`. If wrong: nothing to undo.

---
id: ADR-0004
title: The time machine accepts only the six speeds
status: proposed
date: 2026-11-18
revisit: 
tags: time-machine
parent: ADR-0001
decision: six
---

## Goal
The spec lists speeds 1/30, 1/10, 1/4, 1/2, 1 and 2.

## Hypothesis
- We believe: 
- Will result in: 
- Measured by: 

## People

## Criteria
| id | criterion | weight | description |
| --- | --- | --- | --- |

## Solution: six — Only those six
`setSpeed` throws a `RangeError` for anything else.

| criterion | score |
| --- | --- |

Pros:

Cons:

## Solution: any — Any positive number

| criterion | score |
| --- | --- |

Pros:

Cons:

## Decision
Only the six. If wrong: loosen one check.

---
id: ADR-0005
title: clockDriver takes an optional ticker
status: proposed
date: 2026-11-19
revisit: 
tags: time-machine, clock
parent: ADR-0001
decision: ticker
---

## Goal
The clock driver measures elapsed real time; headless tests need to fake it.

## Hypothesis
- We believe: 
- Will result in: 
- Measured by: 

## People

## Criteria
| id | criterion | weight | description |
| --- | --- | --- | --- |

## Solution: ticker — An optional `ticker` option
`clockDriver(app, registry, tm, { maxHz?, ticker? })`, with the time machine's own `Ticker` type. The only addition to
the planned signature.

| criterion | score |
| --- | --- |

Pros:

Cons:

## Decision
The optional ticker. If wrong: drop one option.

---
id: ADR-0006
title: The time bar is <nano-time-machine> in nano-ui
status: proposed
date: 2026-11-19
revisit: 
tags: time-machine, views
parent: ADR-0001
decision: nano-ui
---

## Goal
The spec named a workspace element `<c-time-machine>`; the project owner then asked for reusable time-machine displays.

## Hypothesis
- We believe: 
- Will result in: 
- Measured by: 

## People

## Criteria
| id | criterion | weight | description |
| --- | --- | --- | --- |

## Solution: nano-ui — `<nano-time-machine>` in nano-ui
Takes a time machine, emits `reset`, sends no nano messages. Usable by any host.

| criterion | score |
| --- | --- |

Pros:

Cons:

## Solution: workspace — `<c-time-machine>` in the workspace
As the spec first said; not reusable outside the workspace.

| criterion | score |
| --- | --- |

Pros:

Cons:

## Decision
`<nano-time-machine>` in nano-ui. If wrong: a rename.

---
id: ADR-0007
title: Reset lives on the history (host.history.reset())
status: proposed
date: 2026-11-19
revisit: 
tags: time-machine, workspace
parent: ADR-0001
decision: on-history
---

## Goal
Adding `history` and `reset` took the workspace's `Host` to 11 members, over the repo's 10-member limit.

## Hypothesis
- We believe: 
- Will result in: 
- Measured by: 

## People

## Criteria
| id | criterion | weight | description |
| --- | --- | --- | --- |

## Solution: on-history — `host.history = { store, listen, reset }`
`Host` keeps 10 plain members; the recording code lives in its own module (`src/history.ts`) because `host.ts` was
already at 150 lines. Concurrent Resets join the one in progress.

| criterion | score |
| --- | --- |

Pros:

Cons:

## Solution: on-host — `host.reset()` beside `host.history`
11 members (first done through a type intersection, which hid it from the structure check).

| criterion | score |
| --- | --- |

Pros:

Cons:

## Decision
On the history. If wrong: rename back to `host.reset()`.

---
id: ADR-0008
title: Module-level exports that no package index re-exports are internal
status: proposed
date: 2026-11-19
revisit: 
tags: conventions
parent: ADR-0001
decision: internal
---

## Goal
CLAUDE.md treats every new export as a question. Files share helpers: `cleanStart`, `SPEEDS`, `inFlight`,
`recording`, `cordOf`, `follow`, `causeChain`.

## Hypothesis
- We believe: 
- Will result in: 
- Measured by: 

## People

## Criteria
| id | criterion | weight | description |
| --- | --- | --- | --- |

## Solution: internal — Internal plumbing, no design.md entry
The same rule already applied to workspace-internal exports.

| criterion | score |
| --- | --- |

Pros:

Cons:

## Solution: inline — Inline them
No shared helpers between files; duplication instead.

| criterion | score |
| --- | --- |

Pros:

Cons:

## Decision
Internal plumbing. If wrong: inline them.

---
id: ADR-0009
title: Messages search filters the recent rows in the view
status: proposed
date: 2026-11-19
revisit: 
tags: time-machine, views
parent: ADR-0001
decision: recent
---

## Goal
The Messages table must be searchable by pod, port or value.

## Hypothesis
- We believe: 
- Will result in: 
- Measured by: 

## People

## Criteria
| id | criterion | weight | description |
| --- | --- | --- | --- |

## Solution: recent — Filter the frame's recent rows
The last 200 messages up to the cursor. No new store method; older messages aren't searchable from the table.

| criterion | score |
| --- | --- |

Pros:

Cons:

## Solution: store — Search the whole store with `store.search`

| criterion | score |
| --- | --- |

Pros:

Cons:

## Decision
Filter the recent rows. If wrong: switch to `store.search`.

---
id: ADR-0010
title: Fast vs deterministic time — keep capability pods; defer an env on NanoContext
status: accepted
date: 2026-11-19
revisit: 2026-12-19
tags: time-machine, clock, random, nano-core
parent: ADR-0001
decision: manual
---

## Goal
Keep everyday apps cheap (time and randomness pass straight through to `setTimeout` and the native random, little
traffic) while being able to turn on recorded, exactly replayable time and randomness for troubleshooting, demos and
examples: a "prod" vs "dev" mode. Raised by the project owner.

Today time and randomness are capability pods (`nano.ui/clock`, `nano.ui/sim-clock`, `nano.ui/random`,
`nano.ui/seeded-random`), reached as ordinary dependencies. A spike (see Notes) measured what that costs.

## Hypothesis
- We believe: capability pods are fast enough, and recorded for free, for every use we have now
- Will result in: deterministic replay without new nano-core machinery
- Measured by: no example or view needing time or randomness in a tight loop before the revisit date

## People
- Product Owner — decider
- Claude — consulted

## Criteria
| id | criterion | weight | description |
| --- | --- | --- | --- |
| crit-1 | performance | 3 | high is good - it means our solution doesn't overly affect performance on the hot path |
| crit-2 | simplicity | 3 | high is good. It means no new concepts or machinery, but leveraging our current designs |
| crit-3 | efficacy | 3 | high is good. It means we can have deterministic control for our replay functionality |

## Solution: switch — Swap the clock pod's implementation by apply
The switch applies the deployment with the clock pod changed between `nano.ui/clock` and `nano.ui/sim-clock`, and
Resets so a recording never mixes the two. Workspace code only; no interface change.
Spiked (Notes): about 3 µs per call through a pod, and 2 history entries per call when recording.

| criterion | score |
| --- | --- |
| crit-1 | 3 |
| crit-2 | 4 |
| crit-3 | 4 |

Pros:
- It's simple - nano already supports replacing pod implementations

Cons:
- It could be slow on the 'hot path', forcing clock and random calls to go via  our Runtime/pods

## Solution: manual — Leave it to the nano.json
Choose the clock implementation per example, as today.
Replay is exact when the nano.json chooses `nano.ui/sim-clock` and `nano.ui/seeded-random` (the Typing
fixture's `typingSim`); everyday examples choose the real ones.

| criterion | score |
| --- | --- |
| crit-1 | 4 |
| crit-2 | 4 |
| crit-3 | 2 |

Pros:

Cons:
- may not support our replay use-case / may not be fit for purpose

## Solution: sol-6 — Add clock/random functions to NanoContext
This would allow us to leverage our 'Pod' approach (calling to clock or random interfaces), giving us flexibility and abstractions
It would also allow us to supply a direct invocation, keeping the interface consistent to the components, but allowing an Application to supply a 'dev' vs 'prod' impl

| criterion | score |
| --- | --- |
| crit-1 | 4 |
| crit-2 | 4 |
| crit-3 | 4 |

Pros:
- It supports the best of both worlds, and represents a familiar 'env' concept we see in e.g. ZIO or effects libraries

Cons:
- It adds some additional complexity to the Application / NanoContext creation

## Solution: quiet — An untracked invocation strategy for capability calls
Keep the clock and random pods, but let a call edge be marked so its messages skip the listeners (not recorded).
Proposed by the project owner as a question.

| criterion | score |
| --- | --- |
| crit-1 | - |
| crit-2 | - |
| crit-3 | - |

Pros:
- No change to NanoContext; pods stay the only abstraction

Cons:
- Saves only the recording cost (about 1 µs and 2 entries per call); the runtime's own cost (about 2.5 µs) stays
- Unrecorded values can't be replayed, so it works against efficacy in dev mode
- A second kind of edge: new machinery on the hot path of every message

## Decision
Keep the capability pods and choose the implementation per nano.json (manual), as today. **Defer** an `env`
(clock and random) on `NanoContext`: it would distract from the Raft case study for little benefit now, and bring
extra scope (dev mode recording env values as a new kind of history entry, replay mode feeding them back per pod,
and the NanoContext member limit). The pod approach measured fast enough (about 3 µs per call) and is recorded for
free, which is what makes replay exact. The time-bar switch (`switch`) stays possible later as workspace code.
Revisit on 2026-12-19 (board task).

## Notes
Spike, 2026-11-19 (bun, M-series Mac, 20,000 calls from inside a pod handler, `nano.ui/random` and `nano.ui/clock`):

| call | recording off | recording on | history entries per call |
| --- | --- | --- | --- |
| `Math.random()` direct | 0.01 µs | 0.01 µs | 0 |
| `rng.next` through the pod | 2.9 µs | 3.6 µs | 2 (sent, delivered) |
| `Date.now()` direct | 0.03 µs | 0.03 µs | 0 |
| `clk.now` through the pod | 2.4 µs | 3.7 µs | 2 |

- Performance: a pod call costs about 100–300× a direct call, but 2.5–3.7 µs in absolute terms: invisible for a
  debounce or a Raft timer, it matters only in tight loops. The bigger dev-mode cost is the history: 2 entries per
  call.
- Simplicity (sol-6): `NanoContext` has 9 members and the structure limit is 10, so one `env` member fits, not two.
- Efficacy (sol-6): pod calls are recorded as messages for free. Direct `env` functions are invisible to the
  recorder, so dev mode would have to write their values into the history (a new kind of entry) and replay mode read
  them back per pod, in order.
- The clock driver's flood (ADR-0011) is separate: it comes from `advance` ticks, whichever solution is chosen.

---
id: ADR-0011
title: Let the clock driver advance only when a timer is due
status: proposed
date: 2026-11-19
revisit: 
tags: time-machine, clock
parent: ADR-0001
decision: 
---

## Goal
A live sim-clock app records an `advance` every 50 ms (about 40 entries a second), flooding the Messages table and
evicting the history's clean start within the hour.

## Hypothesis
- We believe: 
- Will result in: 
- Measured by: 

## People

## Criteria
| id | criterion | weight | description |
| --- | --- | --- | --- |

## Solution: next-due — A "next due" op on ClockControl
The driver advances only to the next due timer. New API.

| criterion | score |
| --- | --- |

Pros:

Cons:

## Solution: infer — Infer due times from recorded after/cancel/fired traffic
No new concept, but fragile.

| criterion | score |
| --- | --- |

Pros:

Cons:

## Solution: accept — Accept it; lower the rate, cap the index, hide advance rows

| criterion | score |
| --- | --- |

Pros:

Cons:

## Decision

---
id: ADR-0012
title: Keep the observe API public in nano-ui
status: proposed
date: 2026-11-19
revisit: 
tags: time-machine, exports
parent: ADR-0001
decision: 
---

## Goal
The spec said new exports are workspace-internal except `kvStep`; the plan exported `record`, `replay`,
`timeMachine`, `foldAt`, `shadowAt`, `clockDriver`, `<nano-time-machine>` and their types from nano-ui for reuse.

## Hypothesis
- We believe: 
- Will result in: 
- Measured by: 

## People

## Criteria
| id | criterion | weight | description |
| --- | --- | --- | --- |

## Solution: public — Public in nano-ui
Reusable by any host, the Ring view and the Raft example.

| criterion | score |
| --- | --- |

Pros:

Cons:

## Solution: internal — Workspace-internal as the spec said

| criterion | score |
| --- | --- |

Pros:

Cons:

## Decision

---
id: ADR-0013
title: The order export in examples/kv
status: proposed
date: 2026-11-19
revisit: 
tags: exports, examples
parent: ADR-0001
decision: 
---

## Goal
`kvStep` sorts entries into `list` order with `order`, now exported from `examples/kv/memory.ts`.

## Hypothesis
- We believe: 
- Will result in: 
- Measured by: 

## People

## Criteria
| id | criterion | weight | description |
| --- | --- | --- | --- |

## Solution: keep — Keep the export

| criterion | score |
| --- | --- |

Pros:

Cons:

## Solution: inline — Inline it in kvStep

| criterion | score |
| --- | --- |

Pros:

Cons:

## Decision

---
id: ADR-0014
title: The shadow app leaves out the host's ui pod
status: proposed
date: 2026-11-19
revisit: 
tags: time-machine
parent: ADR-0001
decision: 
---

## Goal
`shadowAt` rebuilds the app without the host's own `ui` pod. Pods that call HostUI (`approve`, `alert`) then behave
differently in the shadow than they did live.

## Hypothesis
- We believe: 
- Will result in: 
- Measured by: 

## People

## Criteria
| id | criterion | weight | description |
| --- | --- | --- | --- |

## Solution: accept — Accept for now
No current example calls HostUI from a pod that the shadow rebuilds.

| criterion | score |
| --- | --- |

Pros:

Cons:

## Solution: stub — Provide a recording-backed HostUI stub in the shadow

| criterion | score |
| --- | --- |

Pros:

Cons:

## Decision

---
id: ADR-0015
title: Pods create runtimes through a HostDeploy interface
status: accepted
date: 2026-11-19
revisit: 
tags: deployment, raft, host
decision: host-deploy
---

## Goal
The Raft example's management pod creates an N-node cluster: runtimes `<name>-1..N`, each holding the shared
messaging pod, a `raft-api` pod and a `ledger` pod. A pod changing the app's deployment is new and powerful.

## Hypothesis
- We believe: 
- Will result in: 
- Measured by: 

## People
- Project owner — decider
- Claude — author

## Criteria
| id | criterion | weight | description |
| --- | --- | --- | --- |

## Solution: host-deploy — A HostDeploy component, policed by an application deployment policy
`HostDeploy` is a component like any other: it takes a nano deployment (`deploy({ pods, runtimes, onConflict? })`,
where `onConflict` is `'error'` (default) or `'overwrite'`;
`undeploy({ runtimes })`). Its instance is placed in the host's runtime and its host-supplied implementation holds the
`Application`, applying through `AppDeployment.edit` / `app.apply`. Pods that need it declare it as a dependency.

Who may deploy is a new **deployment policy** on the `Application` (nano-core): `isAllowed({ caller, deployment })`,
passed to `Application.create` as runtime policies are, with `DeploymentPolicies.allowAll()` for tests. The workspace's
policy prompts through `HostUI.approve`. `apply` takes a `caller` and `applied` records it, so replay re-applies only
the host's own applies and reproduces a pod's by replaying its cause.

Pros:
- Deployment change stays separate from UI concerns
- Who may deploy is policy, like who may call
- Reuses AppDeployment.edit and apply; the apply is recorded, so the time machine covers it

Cons:
- A nano-core change (DeploymentPolicy, apply's caller) and a new nano.ui interface

## Solution: hostui — A deploy op on HostUI
Smaller, but mixes deployment changes into an interface about the UI.

| criterion | score |
| --- | --- |

Pros:

Cons:

## Decision
HostDeploy. The application's deployment policy (who may change the deployment) is to be revisited: see the board.

---
id: ADR-0016
title: The Raft case study: a cluster deployed by a pod, watched by the time machine and the Ring
status: accepted
date: 2026-11-19
revisit: 
tags: raft, observability
parent: ADR-0001
decision: per-runtime
---

## Goal
A teaching example of event-driven observability with nano, in the style of raft.github.io: a ring of servers electing a leader and replicating a log, every message visible, pausable, slowable and replayable. Spec: `docs/superpowers/specs/2026-11-19-raft-case-study-design.md`.

## People
- Product Owner — decider
- Claude — author

## Solution: per-runtime — One runtime per node, all traffic through a shared messaging pod
The gateway pattern and a ring of rings; the management pod deploys `<name>-1..N` through `HostDeploy` (ADR-0015).

## Solution: one-runtime — One runtime, N node pods calling each other
Simpler, but a single ring and no natural place for latency.

## Decision
One runtime per node through shared messaging. Node actions copy raft.github.io (stop, resume, restart, time out, request). Scrubbing binds pod views to an application rebuilt to the cursor (`shadowAt`). `HostDeploy.deploy` takes `onConflict: 'error' | 'overwrite'`. The Ring takes a `views` map so module views (the glyph) render. Strong headless tests; views only display.

---
id: ADR-0017
title: A new runtime may place existing pods
status: proposed
date: 2026-11-19
revisit: 
tags: deployment, raft
parent: ADR-0016
decision: shared
---

## Goal
`HostDeploy`'s `addTo` must refuse conflicts, but a Raft node runtime places the shared messaging and clock pods.

## People
- Product Owner — decider
- Claude — author

## Solution: shared — Refuse only new pod definitions and runtime ids that exist; a new runtime may place existing pods

## Decision
The gateway pattern. If wrong: one check.

---
id: ADR-0018
title: The ledger fold uses foldAt's own step type
status: proposed
date: 2026-11-19
revisit: 
tags: raft, exports
parent: ADR-0016
decision: existing
---

## Goal
The plan named a `FoldStep` type that nothing exports.

## People
- Product Owner — decider
- Claude — author

## Solution: existing — Use `foldAt`'s step parameter type

## Decision
No new export. If wrong: a type alias.

---
id: ADR-0019
title: A node's published status is its state value
status: proposed
date: 2026-11-19
revisit: 
tags: raft
parent: ADR-0016
decision: node
---

## Goal
The views need a node's status; the core already has `Node`.

## People
- Product Owner — decider
- Claude — author

## Solution: node — `RaftNode.status` and `changed` publish the core `Node` as is

## Decision
No restated shape. If wrong: a projection function.

---
id: ADR-0020
title: The approval text names everything a deploy places and wires
status: proposed
date: 2026-11-19
revisit: 
tags: deployment, security
parent: ADR-0016
decision: truthful
---

## Goal
The approval is the only gate on a pod-triggered deploy; a count of new pods hid placements of existing pods and new edges into them.

## People
- Product Owner — decider
- Claude — author

## Solution: truthful — List created, replaced, newly placed, wired, removed and dropped pods

## Decision
e.g. "Create runtimes example-1..3 (9 pods); places raft-messaging, raft-clock; …". If wrong: a longer dialog.

---
id: ADR-0021
title: A dot click on the Ring seeks only
status: proposed
date: 2026-11-19
revisit: 
tags: ring, views
parent: ADR-0016
decision: seek
---

## Goal
The spec says a dot click opens the message detail, which lives in the workspace.

## People
- Product Owner — decider
- Claude — author

## Solution: seek — Seek (which pauses); defer opening the detail

## Decision
Wiring the detail needs an event or a new option. If wrong: a small follow-up.

---
id: ADR-0022
title: Raft's shared pods are raft-messaging and raft-clock
status: proposed
date: 2026-11-19
revisit: 
tags: raft, examples
parent: ADR-0016
decision: prefixed
---

## Goal
Chat already has `messaging` and Typing a `clock`; the combined build and imports would collide.

## People
- Product Owner — decider
- Claude — author

## Solution: prefixed — Prefix the shared pods with raft-

## Decision
If wrong: two constants.

---
id: ADR-0023
title: Messaging latency draws from its own seeded random
status: proposed
date: 2026-11-19
revisit: 
tags: raft, determinism
parent: ADR-0016
decision: own
---

## Goal
Delivery latency (10–30 ms) needs seeded randomness shared by every cluster.

## People
- Product Owner — decider
- Claude — author

## Solution: own — A `raft-random` pod (seed 1) for messaging, beside each node's own seeded random

## Decision
If wrong: one pod.

---
id: ADR-0024
title: A node's ledger is rebuilt from its recorded writes
status: proposed
date: 2026-11-19
revisit: 
tags: raft, observability
parent: ADR-0016
decision: writes
---

## Goal
A published event is recorded only while something listens, so `written` events may be missing from the history.

## People
- Product Owner — decider
- Claude — author

## Solution: writes — Fold successful `Ledger.write` calls (each carries the whole state)

## Decision
State at t from the history, as the spec intends. If wrong: switch the filter.

---
id: ADR-0025
title: Each node arms one timer for its next due work
status: proposed
date: 2026-11-19
revisit: 
tags: raft, clock
parent: ADR-0016
decision: next-due
---

## Goal
Ticking every 10 ms floods the history; timers on the shared sim clock must stay deterministic.

## People
- Product Owner — decider
- Claude — author

## Solution: next-due — One timer for the next due work (late, never early)

## Decision
Proven by the replay tests. If wrong: a fixed tick.

---
id: ADR-0026
title: Raft views: element classes unexported; idle peer dots faint
status: proposed
date: 2026-11-19
revisit: 
tags: raft, views, exports
parent: ADR-0016
decision: tags
---

## Goal
CLAUDE.md treats exports as questions; the glyph must show pending replies distinctly.

## People
- Product Owner — decider
- Claude — author

## Solution: tags — Only the `views` map and tags are public; idle dots faint, pending hollow, granted filled

## Decision
If wrong: trivial.

---
id: ADR-0027
title: A pod-made deploy can't place the host's own pods
status: proposed
date: 2026-11-19
revisit: 
tags: deployment, security
parent: ADR-0016
decision: refuse
---

## Goal
A deploy that places `ui` or `deploy` in its own runtime would hand out HostUI and HostDeploy.

## People
- Product Owner — decider
- Claude — author

## Solution: refuse — Refuse an addition placing `ui` or `deploy` in a new or replaced runtime (and overwriting or removing them)

## Decision
If wrong: one check.

---
id: ADR-0028
title: Should the Ring draw no dots for hidden shared pods?
status: proposed
date: 2026-11-19
revisit: 
tags: ring
parent: ADR-0016
decision: 
---

## Goal
Clock traffic on the Ring draws a dense stream of dots into the hidden `raft-clock` (the spec asks for dots to a hidden pod's runtime).

## People
- Product Owner — decider
- Claude — author

## Solution: as-spec — Draw them, as the spec says

## Solution: skip — Skip messages to hidden shared pods (a new Ring option)

## Decision


---
id: ADR-0029
title: New exports from the Raft work
status: proposed
date: 2026-11-19
revisit: 
tags: exports
parent: ADR-0016
decision: 
---

## Goal
`DeploymentAsk` (nano-core, the deployment policy's parameter type), `nodeIds` and `EMPTY` (example), and test-only `createRaft`, `openRaft`, `recordedRun`, `ids`.

## People
- Product Owner — decider
- Claude — author

## Solution: keep — Keep them

## Solution: trim — Inline or unexport them

## Decision


---
id: ADR-0030
title: Let the cluster pod read the deployment
status: proposed
date: 2026-11-19
revisit: 
tags: raft, deployment
parent: ADR-0016
decision: 
---

## Goal
After a Reset or reload the cluster list is empty (remove works by trying sizes 5 then 3); listing needs the pod to read the deployment, a new capability.

## People
- Product Owner — decider
- Claude — author

## Solution: read — A read op on HostDeploy (new API)

## Solution: as-is — Leave the list in memory

## Decision

