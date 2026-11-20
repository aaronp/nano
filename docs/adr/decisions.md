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
Give any nano app event-driven observability: record it from its start, move a cursor over the recording by hand or
on a scaled ticker, and let views (the time bar, the Messages table, the Desk's dots, the Ring) react the same way
whatever moves time. The impact is architectural: whatever does the observing must not itself become part of what is
observed, or recording and replay turn recursive and the observed app is perturbed. Spec:
`docs/superpowers/specs/2026-11-18-time-machine-design.md`.

## Hypothesis
- We believe: keeping the observing tools outside the app (plain modules and web components that send no nano messages)
- Will result in: recordings that contain only the app's own traffic, and views that are decoupled from what drives time
- Measured by: replaying a recording reproduces it exactly (`diverge` is null) with the views mounted

## People
- Product Owner — decider
- Claude — author

## Criteria
| id | criterion | weight | description |
| --- | --- | --- | --- |
| isolation | Observed app untouched | 5 | Observing adds no messages to, and changes nothing in, the app being observed. |
| simplicity | Simplicity | 4 | No recursion, no "don't record this" mode, few new concepts. |
| reuse | Reusable displays | 3 | The time machine and its views work for any app and any host. |
| dogfooding | Built with nano | 2 | Uses nano's own pods and wiring, showing the model off. |

## Solution: tools — Plain web components and modules, not pods
The time machine, folding helpers, the shadow app and the views are ordinary TypeScript and Lit elements. They read
the recording and the app's event stream, and send no nano messages.

| criterion | score |
| --- | --- |
| isolation | 5 |
| simplicity | 5 |
| reuse | 4 |
| dogfooding | 2 |

Pros:
- Nothing to exclude from recordings; no recursion
- Views are subscribers to frames, decoupled from what moves time

Cons:
- The observability layer doesn't showcase nano's own pod model

## Solution: pods — Observability as nano pods
The time machine and views are pods wired into the app.

| criterion | score |
| --- | --- |
| isolation | 2 |
| simplicity | 2 |
| reuse | 3 |
| dogfooding | 5 |

Pros:
- Dogfoods nano; the tools could be deployed and rewired like any pod

Cons:
- Their own messages are recorded, so recording needs a no-op mode while replaying
- Observing perturbs the app being observed

## Decision
Plain web components and modules. State at a time t comes from folding the history (cheap) or from a shadow app
replayed to t (exact). Reset means reset and clear; the in-memory history keeps 100,000 entries.

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
title: Stop the clock driver flooding the history with idle advances
status: proposed
date: 2026-11-19
revisit: 
tags: time-machine, clock
parent: ADR-0001
decision: 
---

## Goal
While a sim-clock app is live, the clock driver calls `ClockControl.advance` every tick (up to 20 a second), and
each call is a recorded host message, about 40 history entries a second whether or not anything is due. The impact:
the Messages table shows mostly `advance` rows, and the 100,000-entry history drops its clean start within the hour,
after which state can no longer be rebuilt (no scrubbing past state, no shadow app). A Raft cluster adds its own real
traffic on top. Decide how the driver keeps simulated time moving without drowning the history.

## Hypothesis
- We believe: advancing only when something is due (or recording far fewer advances)
- Will result in: a history dominated by the app's own messages, rebuildable for a working session
- Measured by: an idle sim-clock app records near zero entries per second; a live Raft cluster's history stays
  rebuildable for at least 30 minutes

## People
- Product Owner — decider
- Claude — author

## Criteria
| id | criterion | weight | description |
| --- | --- | --- | --- |
| history | History stays useful | 5 | Few entries per second when idle; the clean start survives a working session. |
| exact | Exact replay | 5 | Replay still reproduces the run, so every advance that changes anything is recorded. |
| concepts | No new concepts | 3 | No new op, interface or option, or the smallest one. |
| robust | Robustness | 3 | Doesn't depend on fragile inference about which timers exist. |

## Solution: next-due — A "next due" op on ClockControl
The sim clock answers when its next timer is due; the driver advances straight to it (capped by real elapsed time ×
speed), and does nothing while nothing is due.

| criterion | score |
| --- | --- |
| history | 5 |
| exact | 5 |
| concepts | 3 |
| robust | 5 |

Pros:
- Idle apps record nothing; every recorded advance fires something
- The clock knows its timers, so nothing is inferred

Cons:
- A new op on a nano.ui interface (new API)

## Solution: infer — Infer due times from the recorded after/cancel/fired traffic
The driver watches `after`, `cancel` and `fired` messages to the clock and computes the next due time itself.

| criterion | score |
| --- | --- |
| history | 5 |
| exact | 4 |
| concepts | 5 |
| robust | 2 |

Pros:
- No new API

Cons:
- Restates the clock's timer table outside the clock (concept drift)
- Breaks if a timer is set before the driver starts listening, or by a host call it misses

## Solution: accept — Accept it; slow the ticks and hide advance rows
Lower the driver's rate (e.g. 4 a second), cap the time machine's index, and filter `advance` rows from the table.

| criterion | score |
| --- | --- |
| history | 2 |
| exact | 5 |
| concepts | 4 |
| robust | 4 |

Pros:
- Smallest change

Cons:
- Still records advances forever; the history still fills, just more slowly
- Coarser ticks make paced playback jerkier

## Decision

---
id: ADR-0012
title: Make the observe API public in nano-ui
status: proposed
date: 2026-11-19
revisit: 
tags: time-machine, exports
parent: ADR-0001
decision: 
---

## Goal
The time-machine spec said its new exports are workspace-internal (only `kvStep` public). The plan instead exported
the observe API from nano-ui (`record`, `replay`, `timeMachine`, `foldAt`, `shadowAt`, `clockDriver`,
`<nano-time-machine>`, `<nano-ring>` and their types) so the displays can be reused, which the Product Owner asked
for. The impact: public names are a contract every host and example then depends on, and CLAUDE.md treats each one
as a question. Decide whether observability is part of nano-ui's public surface.

## Hypothesis
- We believe: publishing the observe API from nano-ui
- Will result in: any host or example (the Raft case study, a future IDE) gets recording, scrubbing and the Ring for free
- Measured by: a second host uses the time bar and the Ring without copying workspace code

## People
- Product Owner — decider
- Claude — author

## Criteria
| id | criterion | weight | description |
| --- | --- | --- | --- |
| reuse | Reuse across hosts | 5 | Hosts other than ui-workspace can observe their apps. |
| surface | Small public surface | 4 | Fewer public names to keep stable. |
| freedom | Freedom to change | 3 | The API can still change shape cheaply while it's young. |

## Solution: public — Public in nano-ui
Exported from `@pritzlaff/nano-ui` and listed in design.md.

| criterion | score |
| --- | --- |
| reuse | 5 |
| surface | 2 |
| freedom | 2 |

Pros:
- One implementation for every host; the Raft example and the Ring use it directly

Cons:
- About 17 new public names to keep stable

## Solution: internal — Workspace-internal, as the spec said
The observe code lives in ui-workspace and isn't exported.

| criterion | score |
| --- | --- |
| reuse | 1 |
| surface | 5 |
| freedom | 5 |

Pros:
- Free to reshape while it settles

Cons:
- Other hosts must copy it; examples can't ship observability

## Solution: subpath — Public, but behind a separate entry point
Export from `@pritzlaff/nano-ui/observe`, marked experimental.

| criterion | score |
| --- | --- |
| reuse | 5 |
| surface | 3 |
| freedom | 4 |

Pros:
- Reusable, while signalling the API may still change

Cons:
- A second entry point to build and document

## Decision

---
id: ADR-0014
title: How the shadow app treats the host's own UI pod
status: proposed
date: 2026-11-19
revisit: 
tags: time-machine, replay
parent: ADR-0001
decision: 
---

## Goal
`shadowAt` rebuilds the app to a time t without the host's own `ui` pod (HostUI), so replay never opens real
dialogs. Any pod that calls HostUI (`approve`, `alert`) then gets a failure in the shadow where it got an answer live,
and the rebuilt state drifts from what really happened. The impact grows as examples lean on approvals (HostDeploy
asks through the deployment policy, which is fine; a pod asking `approve` directly is not). Decide how the shadow
answers host-UI calls.

## Hypothesis
- We believe: answering HostUI calls in the shadow from the recording
- Will result in: shadow apps that match the live run even for pods that ask the user things
- Measured by: a fixture pod that calls `approve` rebuilds to the same state in the shadow as live

## People
- Product Owner — decider
- Claude — author

## Criteria
| id | criterion | weight | description |
| --- | --- | --- | --- |
| fidelity | Shadow fidelity | 5 | The shadow's state at t equals the live state at t. |
| safety | No real side effects | 5 | Rebuilding never shows dialogs or alerts to the user. |
| effort | Effort | 2 | How much new machinery it needs. |

## Solution: accept — Leave it out; document the assumption
Pods calling HostUI drift in the shadow; no current example does.

| criterion | score |
| --- | --- |
| fidelity | 2 |
| safety | 5 |
| effort | 5 |

Pros:
- Nothing to build

Cons:
- Silent drift for any app whose pods ask the user

## Solution: stub — A recording-backed HostUI stand-in in the shadow
The shadow places a `ui` stand-in whose answers come from the recorded outcomes of the live calls, in order.

| criterion | score |
| --- | --- |
| fidelity | 5 |
| safety | 5 |
| effort | 3 |

Pros:
- Exact shadows for interactive apps; the same idea extends to any host-side pod

Cons:
- A replay-mode stand-in is new machinery (close to the deferred env idea in ADR-0010)

## Decision

---
id: ADR-0015
title: Pods create runtimes through a HostDeploy component, policed by an application deployment policy
status: accepted
date: 2026-11-19
revisit: 
tags: deployment, raft, host, security
parent: ADR-0016
decision: host-deploy
---

## Goal
The Raft example's management pod deploys an N-node cluster: runtimes `<name>-1..N`, each holding the shared
messaging pod, a `raft-api` pod and a `ledger` pod. A pod changing the app's deployment is new and powerful: it can
add code paths, rewire existing pods and remove things. The impact is on nano's security model and on replay (a
pod-made change must be reproduced exactly once). Decide how a pod asks for a deployment change and who allows it.

## Hypothesis
- We believe: a HostDeploy component policed by an application-level deployment policy
- Will result in: pods that can deploy only what the user approves, recorded and replayed exactly once
- Measured by: the approval names everything a deploy places, wires, replaces and drops; replay of a recorded
  cluster creation applies it once; host pods can't be touched

## People
- Product Owner — decider
- Claude — author

## Criteria
| id | criterion | weight | description |
| --- | --- | --- | --- |
| security | Who may deploy is policy | 5 | Deployment changes pass a policy, like calls do; the user sees exactly what changes. |
| separation | Separation of concerns | 4 | Deployment isn't mixed into UI interfaces. |
| replay | Exact replay | 4 | A pod's deployment change is reproduced once, by replaying its cause. |
| size | Size of change | 2 | How much new core API it needs. |

## Solution: host-deploy — A HostDeploy component and an application deployment policy
`HostDeploy` is a component like any other: `deploy({ pods, runtimes, onConflict? })` (`onConflict` `'error'` by
default, or `'overwrite'`) and `undeploy({ runtimes })`. Its instance is placed in the host's runtime and its
host-supplied implementation holds the `Application`. nano-core gains `DeploymentPolicy`
(`isAllowed({ caller, deployment })`, `DeploymentPolicies.allowAll()`), `apply(next, { caller })` and
`applied.caller`. The workspace's policy prompts through `HostUI.approve` with a summary of everything created,
replaced, placed, wired and dropped, bounded at 20 s, one pending deploy at a time; host pods (`ui`, `deploy`) can't
be placed, replaced or removed by a pod.

| criterion | score |
| --- | --- |
| security | 5 |
| separation | 5 |
| replay | 5 |
| size | 3 |

Pros:
- Who may deploy is policy, like who may call; the approval is truthful
- Reuses apply; recorded with its caller, so replay re-applies only the host's own changes

Cons:
- A nano-core change and a new nano-ui interface

## Solution: hostui — A deploy op on HostUI
Add `deploy` to the existing HostUI interface, asking the user inline.

| criterion | score |
| --- | --- |
| security | 3 |
| separation | 1 |
| replay | 3 |
| size | 5 |

Pros:
- Smallest change; no core API

Cons:
- Mixes deployment into an interface about the UI
- No application-level policy: the rule lives in one host's UI code

## Decision
HostDeploy with an application deployment policy. Revisiting the application's deployment policy as a whole (who
may deploy, beyond the user's approval) is a board item.

---
id: ADR-0016
title: The Raft case study — a cluster deployed by a pod, one runtime per node, watched by the time machine
status: accepted
date: 2026-11-19
revisit: 
tags: raft, observability
parent: ADR-0001
decision: per-runtime
---

## Goal
A teaching example of event-driven observability with nano, in the style of raft.github.io: a ring of servers
electing a leader and replicating a log, with every message visible, pausable, slowable and replayable. It must
show nano off (runtimes created by a pod, the app gateway pattern, storage as a pod, determinism as a mechanism, the
time machine and the Ring) rather than be another Raft. The main structural choice is how the servers talk. Spec:
`docs/superpowers/specs/2026-11-19-raft-case-study-design.md`.

## Hypothesis
- We believe: one runtime per node, all traffic through a shared messaging pod, on a simulated clock with seeded randomness
- Will result in: a cluster you can pause, slow to 1/30× and scrub, whose recording replays exactly
- Measured by: replay at both paces gives `diverge` null and ledgers folded from history equal a rebuilt app's, for seeds 1–5

## People
- Product Owner — decider
- Claude — author

## Criteria
| id | criterion | weight | description |
| --- | --- | --- | --- |
| teaching | Shows nano's model | 5 | Exercises runtimes, the gateway pattern, pod-made deployments and the Ring's ring of rings. |
| control | Network control | 3 | One place to add latency, drops or partitions later. |
| simplicity | Simplicity | 3 | Few moving parts for a reader to follow. |

## Solution: per-runtime — One runtime per node, through a shared messaging pod
Runtimes `<name>-1..N`, each with its own `raft-api`, `ledger` and seeded random; `raft-messaging` and `raft-clock`
shared across them (the gateway pattern).

| criterion | score |
| --- | --- |
| teaching | 5 |
| control | 5 |
| simplicity | 3 |

Pros:
- A ring of rings on the Ring view; the gateway pattern in action
- Messaging is the one place for latency (and later drops), under seeded random

Cons:
- More runtimes and wiring to deploy

## Solution: one-runtime — One runtime, N node pods calling each other
All nodes in one runtime with call edges between them.

| criterion | score |
| --- | --- |
| teaching | 2 |
| control | 2 |
| simplicity | 5 |

Pros:
- The simplest deployment

Cons:
- A single ring; no gateway pattern; no natural place for latency or drops

## Decision
One runtime per node through shared messaging. Node actions copy raft.github.io (stop, resume, restart, time out,
request). Scrubbing binds pod views to an application rebuilt to the cursor. The Ring takes a `views` map so module
views (the glyph) render. Strong headless tests; views only display.

---
id: ADR-0024
title: How a storage pod's state at a time t comes from the history
status: accepted
date: 2026-11-19
revisit: 
tags: observability, raft, storage
parent: ADR-0001
decision: writes
---

## Goal
Scrubbing and consistency checks need a storage pod's state at any time t from the history alone (folding, without
rebuilding the app). The spec's guidance was "keep state in a store pod and publish changes as events". But nano
records a published event only while something listens to it, so the events may simply be missing from the history.
The impact: folding events would silently show stale or empty state. Decide what the fold reads.

## Hypothesis
- We believe: folding the store's recorded write calls (each carrying the whole new state)
- Will result in: state at any t that always matches a rebuilt app
- Measured by: `foldAt(ledgerStep)` equals the shadow app's `Ledger.read` at every boundary, seeds 1–5

## People
- Product Owner — decider
- Claude — author

## Criteria
| id | criterion | weight | description |
| --- | --- | --- | --- |
| complete | Always in the history | 5 | The fold's input is recorded whether or not anyone is watching. |
| cost | History cost | 3 | How much it adds to the history. |
| general | Generality | 3 | The pattern works for other storage pods. |

## Solution: writes — Fold successful write calls
Calls are always recorded; `Ledger.write` carries the whole `Persistent`, so each one is a full snapshot.

| criterion | score |
| --- | --- |
| complete | 5 |
| cost | 4 |
| general | 4 |

Pros:
- Works headless and with no views open

Cons:
- Relies on writes carrying whole state (or the fold replaying partial writes)

## Solution: events — Fold the `written` events
As the spec's guidance said.

| criterion | score |
| --- | --- |
| complete | 1 |
| cost | 4 |
| general | 4 |

Pros:
- Matches the published-events guidance

Cons:
- Missing from the history whenever nothing listens

## Solution: always-record — Record every publish, listened to or not
A nano-core change: publishes become recorded messages regardless of listeners.

| criterion | score |
| --- | --- |
| complete | 5 |
| cost | 2 |
| general | 5 |

Pros:
- Events become a reliable source for every pod

Cons:
- A core change, and more history for every publish in every app

## Decision
Fold the write calls. Worth revisiting the spec's "publish changes as events" guidance, since events alone aren't a
reliable history source today.

---
id: ADR-0028
title: Whether the Ring draws messages to hidden shared pods
status: proposed
date: 2026-11-19
revisit: 
tags: ring, views
parent: ADR-0016
decision: 
---

## Goal
The Ring draws a message to or from a hidden pod as going to its runtime's centre (spec). For Raft, the hidden shared
`raft-clock` receives every timer call (`after`, `cancel`) from every node and from messaging, so a dense stream of
dots runs into the `raft` runtime and dominates the picture, hiding the Raft messages the example is about. Decide
what the Ring shows for traffic to hidden pods.

## Hypothesis
- We believe: letting the deployment say which traffic the Ring hides
- Will result in: a Raft Ring that shows votes and appends travelling between nodes, as on raft.github.io
- Measured by: in a live 3-node cluster, most dots on the Ring are Raft messages

## People
- Product Owner — decider
- Claude — author

## Criteria
| id | criterion | weight | description |
| --- | --- | --- | --- |
| clarity | Clarity | 5 | The picture shows the messages the app is about. |
| honesty | Nothing hidden by surprise | 3 | The viewer can tell traffic was left out. |
| concepts | No new concepts | 3 | No new Ring option, or the smallest one. |

## Solution: as-spec — Draw them, as the spec says

| criterion | score |
| --- | --- |
| clarity | 1 |
| honesty | 5 |
| concepts | 5 |

Pros:
- Every message is visible

Cons:
- Clock traffic swamps the picture

## Solution: skip-hidden — No dots for messages whose other end is hidden
A message is drawn only when both ends are shown.

| criterion | score |
| --- | --- |
| clarity | 4 |
| honesty | 3 |
| concepts | 4 |

Pros:
- Uses the existing `show` filter; no new option

Cons:
- Also hides messages to a hidden pod that does matter (e.g. a node writing its ledger)

## Solution: hide-ports — The deployment's layout lists ports the Ring doesn't draw
`layout.ring.hide: [port(Clock, Clock.ops.after), …]` beside `layout.ring.show`.

| criterion | score |
| --- | --- |
| clarity | 5 |
| honesty | 4 |
| concepts | 3 |

Pros:
- Precise: hides timer traffic, keeps everything else

Cons:
- A second Ring setting in the layout

## Decision

---
id: ADR-0030
title: Let the Raft cluster pod read the deployment
status: proposed
date: 2026-11-19
revisit: 
tags: raft, deployment
parent: ADR-0015
decision: 
---

## Goal
The cluster pod remembers which clusters it created only in memory. After a Reset (which restarts every pod) or a
page reload, its list is empty while the node runtimes remain; remove now works by guessing sizes (5, then 3), but
the view can't show what exists. A pod reading the deployment is a new capability. The impact is on what pods may
know about the app, and on whether a management pod can be stateless.

## Hypothesis
- We believe: giving the cluster pod a way to read which runtimes exist
- Will result in: a cluster view that's correct after Reset or reload, and a stateless management pod
- Measured by: after a Reset, the cluster view lists the clusters whose runtimes exist

## People
- Product Owner — decider
- Claude — author

## Criteria
| id | criterion | weight | description |
| --- | --- | --- | --- |
| correct | Correct after Reset/reload | 4 | The view shows what really exists. |
| exposure | Minimal exposure | 4 | Pods learn as little about the app as possible. |
| concepts | No new concepts | 3 | No new op, or the smallest one. |

## Solution: read-op — A read op on HostDeploy
`HostDeploy.runtimes()` returns runtime ids (or a filtered view), policed like deploy.

| criterion | score |
| --- | --- |
| correct | 5 |
| exposure | 3 |
| concepts | 3 |

Pros:
- One source of truth: the deployment

Cons:
- New API; pods can see the app's shape

## Solution: ledger — Persist the cluster list in a storage pod
The cluster pod keeps its list in a store pod with config, like the ledgers.

| criterion | score |
| --- | --- |
| correct | 3 |
| exposure | 5 |
| concepts | 4 |

Pros:
- No new host capability

Cons:
- Reset empties stores too, so the list still goes wrong after Reset; a second copy of the truth

## Solution: as-is — Leave the list in memory
Remove keeps guessing sizes.

| criterion | score |
| --- | --- |
| correct | 1 |
| exposure | 5 |
| concepts | 5 |

Pros:
- Nothing to build

Cons:
- The view is wrong after every Reset or reload

## Decision

---
id: ADR-0031
title: Start pods explicitly, per runtime, with start and getOrCreate
status: accepted
date: 2026-11-20
revisit: 
tags: core, lifecycle, pods
decision: explicit
---

## Goal
Opening a page must start the lazy pods it shows and reuse those already running, never making duplicates. Today a
lazy pod is built only by its first call (D70: "there is no `start()`"), and a subscription never builds its source,
so a view that only listens waits forever. The impact is on core's lifecycle model: how, and by whom, a pod is
started. Spec: `docs/superpowers/specs/2026-11-20-pages-as-deployment-design.md`.

## Hypothesis
- We believe: two explicit operations on a runtime's live view, `start(pod)` and `getOrCreate(pod)`
- Will result in: data-driven page opening with no surprising side effects, and no duplicate pods
- Measured by: opening a second page naming a running pod starts nothing (`started: false`); subscribing never builds a pod

## People
- Product Owner — decider
- Claude — author

## Criteria
| id | criterion | weight | description |
| --- | --- | --- | --- |
| explicit | No hidden side effects | 5 | Starting a pod is something someone asked for, visible in code and on the stream. |
| model | Fits the model | 4 | Few new concepts; policed and traced like other messages. |
| reuse | Reuse, not duplicates | 4 | A running pod is found and reused; one build however many callers. |
| simplicity | Simplicity | 3 | Little new core surface. |

## Solution: explicit — start and getOrCreate on RuntimeView
`start(pod): NanoResult<void>` builds a placed pod that isn't running (refusing one that is); `getOrCreate(pod)`
returns `{ started, pod }` (`pod` is exactly `call(pod)`'s client) or the `Fail`. `start` is a message of a new kind
`start`, from `host`, asked of the runtime's policy.

| criterion | score |
| --- | --- |
| explicit | 5 |
| model | 4 |
| reuse | 5 |
| simplicity | 3 |

Pros:
- Starting is always asked for, traced and policed
- `started` tells the caller whether it started the pod

Cons:
- Reverses D70; a new message kind in `AppEvent` and `Ask`
- A call still builds a lazy pod on the way, so a policy refusing `start` doesn't block that path

## Solution: subscribe-builds — A subscription builds its lazy source
Connecting an `on` to a lazy, unbuilt pod builds it, as a call does.

| criterion | score |
| --- | --- |
| explicit | 1 |
| model | 3 |
| reuse | 4 |
| simplicity | 5 |

Pros:
- One rule in `connect`; no new API

Cons:
- Wiring a subscription starts a pod as a side effect

## Solution: ping — The host calls something on each lazy pod
Opening a page calls an op on each pod to build it.

| criterion | score |
| --- | --- |
| explicit | 2 |
| model | 1 |
| reuse | 3 |
| simplicity | 3 |

Pros:
- No core change

Cons:
- There is no op every pod has; the host would invent one

## Decision
Explicit `start` and `getOrCreate` on `app.runtime(id)` (not `Application`, which is at its 10-member cap). `start`
is a traced, policed message of kind `start`; `lifecycle` keeps its meaning. Supersedes D70 and the "no `start()`"
lines in D90, D98, the model spec and the design.md FAQ: the old rule was about the application; this is per pod.

---
id: ADR-0032
title: Keep pages in AppDeployment.layout
status: accepted
date: 2026-11-20
revisit: 
tags: presentation, layout, deployment
decision: in-layout
---

## Goal
Pages, their layouts and which pods sit where should be deployment data, not the workspace's private storage, so a
different front-end (say React, with its own look) can load and show them. The impact is the shape of the saved
document and how the system and its presentation relate.

## Hypothesis
- We believe: pages (containers of slots, each with a fixed id as its coordinate) in `AppDeployment.layout.pages`
- Will result in: one portable document holding the system and its pages, saved and loaded together
- Measured by: a reload reopens the same pages and pods; a document's pages open in another host with no workspace state

## People
- Product Owner — decider
- Claude — author

## Criteria
| id | criterion | weight | description |
| --- | --- | --- | --- |
| portable | Portable | 5 | Another front-end can read pages without the workspace's engine state. |
| one-truth | One source of truth | 5 | No second copy of pods or pages to keep in step. |
| core | Core untouched | 4 | Core keeps ignoring presentation. |
| multi | Several front-ends | 2 | Different front-ends can keep different pages over one system. |

## Solution: in-layout — layout.pages in the deployment
`layout.pages: Page[]`, each `{ id, title, icon?, slots, geometry?, <engine>? }`; core only shape-checks `layout`.

| criterion | score |
| --- | --- |
| portable | 5 |
| one-truth | 5 |
| core | 5 |
| multi | 2 |

Pros:
- One document to persist, export and load
- Builds on the existing `LayoutSlot` and `LayoutBox`

Cons:
- `layout` changes from "the page" to "the pages" (the old shape reads as page `workspace`)

## Solution: separate — A presentation document pointing into a deployment
Pages live in their own document that names pods by runtime and pod.

| criterion | score |
| --- | --- |
| portable | 4 |
| one-truth | 2 |
| core | 5 |
| multi | 5 |

Pros:
- Several front-ends can each own pages over one system

Cons:
- Two documents to keep in step; slots can name pods that no longer exist

## Decision
`layout.pages` in the deployment. Slots are the truth; an engine's state (the page's `workspace` key) is a hint keyed
by slot id. A slot is a pod's (`{ id, runtime, pod }`) or a host view's (`{ id, view }`). Page ids are fixed when the
page is made; titles change freely.

---
id: ADR-0033
title: Change pages through a HostPages capability, apart from HostDeploy
status: accepted
date: 2026-11-20
revisit: 
tags: presentation, host, capabilities
decision: host-pages
---

## Goal
Pages need a capability to read and change them, which the workspace UI and pods can use and the host persists. The
impact is whether rearranging presentation and changing the system share one path and one approval.

## Hypothesis
- We believe: a separate `HostPages` interface (`pages`, `setPage`, `removePage`, `open`)
- Will result in: presentation changes that never change the system, and a system that never depends on pages
- Measured by: no page operation applies a deployment; pruning slots of removed pods is the only system → page effect

## People
- Product Owner — decider
- Claude — author

## Criteria
| id | criterion | weight | description |
| --- | --- | --- | --- |
| decoupled | Presentation decoupled | 5 | Page changes and system changes have separate owners and paths. |
| approval | Sensible approval | 3 | A pod changing pages is asked; a drag in the UI isn't a "deployment". |
| surface | Small surface | 3 | Few new names. |

## Solution: host-pages — A new HostPages interface
A nano-ui interface the workspace implements as host pod `pages`; a pod's changes ask `HostUI.approve`.

| criterion | score |
| --- | --- |
| decoupled | 5 |
| approval | 5 |
| surface | 3 |

Pros:
- Each fact has one owner and one path

Cons:
- A new interface, a third host pod and a second approval path

## Solution: extend-deploy — HostDeploy.deploy accepts layout
`deploy` takes `layout` beside pods and runtimes.

| criterion | score |
| --- | --- |
| decoupled | 1 |
| approval | 2 |
| surface | 5 |

Pros:
- One capability, one approval path

Cons:
- Dragging a panel becomes a deployment; presentation and system blur

## Decision
`HostPages`. A pick is two separate steps: deploy the pod (system), then add a slot (presentation). Pages never
start, stop, count or remove pods; when the system removes a pod, pages drop its slots on `applied`.

---
id: ADR-0034
title: Trust the app's own stored document at boot
status: accepted
date: 2026-11-20
revisit: 
tags: security, persistence, host
decision: trust-own
---

## Goal
The host now persists the whole document (system, modules, views, pages) and boots from it. The document names code
to load (`modules`), and `Application.load` is for trusted documents. The impact is a trust boundary: does a reload
run stored code without asking?

## Hypothesis
- We believe: the stored document is the app's own (same origin, written by it) and loads without asking
- Will result in: a reload that simply reopens what you had
- Measured by: a reload asks nothing for nano.ui or same-origin providers; a foreign provider still asks once per session

## People
- Product Owner — decider
- Claude — author

## Criteria
| id | criterion | weight | description |
| --- | --- | --- | --- |
| safety | Safety | 5 | Stored data can't run code a person never agreed to. |
| flow | Smooth reload | 4 | A reload reopens your work without prompts. |
| simplicity | Simplicity | 2 | No new consent store. |

## Solution: trust-own — Trust storage, keep per-session consent for foreign code
Same-origin storage is trusted like the app's code; foreign providers ask once per session as now; `?src=` imports
into the stored document.

| criterion | score |
| --- | --- |
| safety | 4 |
| flow | 4 |
| simplicity | 5 |

Pros:
- No prompts for your own work; foreign code still asks

Cons:
- Poisoned storage (already requiring same-origin script) is trusted

## Solution: ask-always — Ask before loading any stored module
Every reload asks for each provider in the stored document.

| criterion | score |
| --- | --- |
| safety | 5 |
| flow | 1 |
| simplicity | 4 |

Pros:
- Nothing runs unasked

Cons:
- Every reload is a consent prompt

## Decision
Trust the app's own stored document; foreign providers keep their once-per-session consent; `?src=` imports into the
stored document, never replacing it.

---
id: ADR-0035
title: Picks deploy lazy pods
status: accepted
date: 2026-11-20
revisit: 
tags: presentation, lifecycle, picker
decision: lazy
---

## Goal
A pick from the picker deploys a pod. Today every pick is eager (built at once). The impact is what starts pods: the
deployment, or the pages that show them.

## Hypothesis
- We believe: picks deploy lazy pods, started by the page that shows them (`getOrCreate`)
- Will result in: nothing running only because some other page lists it
- Measured by: a pod on a never-opened page stays `not started`

## People
- Product Owner — decider
- Claude — author

## Criteria
| id | criterion | weight | description |
| --- | --- | --- | --- |
| intent | Runs what you look at | 4 | Pods start when shown, not just because they exist. |
| behaviour | Pods that need to run | 3 | A timer or socket pod that must always run still can. |
| simplicity | Simplicity | 2 | One rule. |

## Solution: lazy — Picks are lazy
| criterion | score |
| --- | --- |
| intent | 5 |
| behaviour | 3 |
| simplicity | 5 |

Pros:
- Page opening is what starts things, explicitly

Cons:
- A pod that must run unseen needs `eager` set by other means (import or deploy)

## Solution: eager — Picks are eager, as now
| criterion | score |
| --- | --- |
| intent | 2 |
| behaviour | 5 |
| simplicity | 5 |

Pros:
- Unchanged behaviour

Cons:
- Every picked pod runs from the moment it is deployed, shown or not

## Decision
Picks deploy lazy pods; the page that shows one starts it.

---
id: ADR-0036
title: Pages save every change; Save layout keeps a restore point
status: accepted
date: 2026-11-20
revisit: 
tags: presentation, persistence, workspace
parent: ADR-0032
decision: checkpoint
---

## Goal
Pages are deployment data, and the spec says every arrangement change (split, close, drag, template switch, swap,
park) rewrites the page, so a reload never loses work. The workspace dock already has Save layout, Restore and Reset,
which assumed the live arrangement was *not* kept. The impact is what those three commands mean once it is.

## Hypothesis
- We believe: the page always holds the live arrangement; Save layout stores a restore point beside it on the page
- Will result in: no lost work on reload, and the commands people already know keep a useful meaning
- Measured by: move a panel, reload, the move is there; Save, move, Restore returns to the saved arrangement

## People
- Product Owner — decider
- Claude — author

## Criteria
| id | criterion | weight | description |
| --- | --- | --- | --- |
| no-loss | No lost work | 5 | A reload shows what you last had. |
| familiar | Commands keep meaning | 3 | Save, Restore and Reset still do something people expect. |
| simple | Simplicity | 3 | Few states per page. |

## Solution: checkpoint — Live arrangement always saved; Save layout is a restore point
The page's engine key holds the live arrangement (written on every change) and, after Save layout, a saved one.
Restore returns to the saved one; Reset returns to the dock's starting layout, as now.

| criterion | score |
| --- | --- |
| no-loss | 5 |
| familiar | 4 |
| simple | 3 |

Pros:
- Nothing is lost on reload; Save/Restore become an undo point

Cons:
- Two arrangements per page in the engine key

## Solution: drop-save — Live arrangement always saved; Save layout and Restore removed
| criterion | score |
| --- | --- |
| no-loss | 5 |
| familiar | 2 |
| simple | 5 |

Pros:
- One state per page

Cons:
- Removes two commands people use, with no way back to a known arrangement

## Solution: save-only — Keep writing the arrangement only on Save
| criterion | score |
| --- | --- |
| no-loss | 1 |
| familiar | 5 |
| simple | 4 |

Pros:
- Unchanged behaviour

Cons:
- A reload loses unsaved moves, and slots and engine state drift apart (against the spec)

## Decision
Checkpoint: every change writes the live arrangement to the page; Save layout keeps a restore point on the page;
Restore returns to it; Reset to the starting layout.

---
id: ADR-0037
title: Runtime coordinates, and selectors built from coordinates
status: accepted
date: 2026-11-21
revisit: 
tags: core, coordinates, selectors
decision: typed
---

## Goal
Coordinates are nano's identifiers, layered: a namespace, then interfaces and implementations in it, then ports and
pods. `PodCoord` composes an `ImplCoord` but holds its runtime as a string, and `SelectorData` (implements,
implementation, provider, runtime) is all strings. The Platform (pages over the Application) will identify pods by
coordinate and by selector, so the impact is whether those references are type-checked composition or strings.

## Hypothesis
- We believe: a `RuntimeCoord`, used by `PodCoord` and by `SelectorData` alongside the existing coordinate types
- Will result in: references that can't confuse a pod name with a runtime, built on what exists
- Measured by: tsc rejects a string where a runtime coordinate belongs; saved documents and recordings load unchanged

## People
- Product Owner — decider
- Claude — author

## Criteria
| id | criterion | weight | description |
| --- | --- | --- | --- |
| safety | Type-checked references | 5 | Mixing up runtime, pod and implementation is a compile error. |
| compose | Built on existing coordinates | 4 | No restated string forms; coordinates compose. |
| churn | Little churn | 2 | Few call sites change; saved data unchanged. |

## Solution: typed — RuntimeCoord; selectors take coordinates
| criterion | score |
| --- | --- |
| safety | 5 |
| compose | 5 |
| churn | 2 |

Pros:
- One composed, checked form for every reference the Platform makes

Cons:
- About 60 call sites move; selectors are a little more verbose to write

## Solution: strings — Keep strings; the Platform validates
| criterion | score |
| --- | --- |
| safety | 2 |
| compose | 2 |
| churn | 5 |

Pros:
- No core change

Cons:
- Every client re-checks strings; a pod name can stand where a runtime belongs

## Decision
Typed. Ids used as keys and names in data and APIs, and the `runtime` field of events and policy asks, stay strings
(identifiers, not coordinates). `Interface.define` accepts only interface coordinates (`ns.Name`); the slash form
(`acme/db`) is refused. A sandbox module built with an older nano-core that declares a slash-form interface now fails
`described()` with `invalid-input`.

---
id: ADR-0038
title: Pages are a separate Platform layer with its own deployment
status: accepted
date: 2026-11-21
revisit: 
tags: platform, presentation, pages
decision: platform
---

## Goal
Pages (groupings of slots, each slot naming a pod) need a home that other clients (a CLI, an API, another UI) can
share. The first attempts put them in the Application's document (`layout.pages`) with page-specific operations, or
proposed adding them to core's `AppDeployment`. The impact is whether core's single-responsibility concepts grow a
presentation concept, and how many operations clients learn.

## Hypothesis
- We believe: a separate layer (the Platform) owning its own document (the UIDeployment), changed by one `apply`,
  reading the Application to resolve slots (by pod coordinate, selector, or a pod-less view)
- Will result in: core untouched, one write verb, any client sharing pages while keeping its own layout and meta
- Measured by: no core change for pages; the workspace's page edits are all `platform.apply`; a slot resolves across
  runtimes by coordinate or selector

## People
- Product Owner — decider
- Claude — author

## Criteria
| id | criterion | weight | description |
| --- | --- | --- | --- |
| core | Core stays single-purpose | 5 | Application, Runtime and their deployment learn nothing of pages. |
| simple | Few operations | 4 | One document, one apply; no per-operation API. |
| portable | Shared by other clients | 4 | A CLI or another UI reads the same pages and slots. |
| cheap | Arrangement is cheap | 3 | A drag doesn't produce Application events or history. |

## Solution: platform — A separate layer and document
| criterion | score |
| --- | --- |
| core | 5 |
| simple | 5 |
| portable | 5 |
| cheap | 5 |

Pros:
- Like Argo CD over Kubernetes: built on the system, owns its own model
- Dangling references are shown, not refused, so the system and pages stay decoupled

Cons:
- Two documents to persist (a bundle file for Save/Open); the Platform needs the registry to resolve selectors

## Solution: in-app — Pages in AppDeployment, changed by app.apply
| criterion | score |
| --- | --- |
| core | 1 |
| simple | 4 |
| portable | 4 |
| cheap | 2 |

Pros:
- One document and one apply for everything

Cons:
- Core grows a presentation concept; every drag is an Application event unless filtered

## Solution: convention — Pages as an opaque convention in layout, with page operations
| criterion | score |
| --- | --- |
| core | 4 |
| simple | 1 |
| portable | 2 |
| cheap | 4 |

Pros:
- What was built first; core untouched

Cons:
- setPage, removePage, merge, prune, open…: operations multiply; every client re-implements validation

## Decision
Platform. Supersedes ADR-0032 and ADR-0033. Slots: `{ kind: 'pod', pod: PodCoord } | { kind: 'select', select:
SelectorData } | { kind: 'view', view }`; dangling references resolve `missing`; several selector matches show the first;
Save/Open use a bundle `{ app, platform }`; pods change pages through `HostPlatform { document, apply }` with a
version check.
