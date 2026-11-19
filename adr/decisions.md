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

## People
- Project owner — decider
- Claude — author

## Solution: tools — Plain web components and modules, not pods
The time machine and its views send no nano messages, so they are never recorded: no recursion, and the observed app
is never touched. State at a time t comes from folding the history (cheap) or from a shadow app replayed to t (exact).

## Solution: pods — Observability as nano pods
The tools would be pods in the app. Their own messages would be recorded, so recording them needs a no-op mode.

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

## Solution: constant — Constant window; speed scales cursor motion
The window is a constant `travelMs` (600) of recording time; on screen a message takes `travelMs / speed`. Frames are
a pure function of the cursor.

## Solution: scaled — Scale the window by speed
The window itself changes with speed, so the same cursor gives different frames at different speeds.

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

## Solution: date-now — Tick while in flight, on Date.now
Live mode keeps emitting frames while any message is in flight; the default ticker's `now` is `Date.now`, the clock
that stamps entries.

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

## Solution: six — Only those six
`setSpeed` throws a `RangeError` for anything else.

## Solution: any — Any positive number

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

## Solution: ticker — An optional `ticker` option
`clockDriver(app, registry, tm, { maxHz?, ticker? })`, with the time machine's own `Ticker` type. The only addition to
the planned signature.

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

## Solution: nano-ui — `<nano-time-machine>` in nano-ui
Takes a time machine, emits `reset`, sends no nano messages. Usable by any host.

## Solution: workspace — `<c-time-machine>` in the workspace
As the spec first said; not reusable outside the workspace.

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

## Solution: on-history — `host.history = { store, listen, reset }`
`Host` keeps 10 plain members; the recording code lives in its own module (`src/history.ts`) because `host.ts` was
already at 150 lines. Concurrent Resets join the one in progress.

## Solution: on-host — `host.reset()` beside `host.history`
11 members (first done through a type intersection, which hid it from the structure check).

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

## Solution: internal — Internal plumbing, no design.md entry
The same rule already applied to workspace-internal exports.

## Solution: inline — Inline them
No shared helpers between files; duplication instead.

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

## Solution: recent — Filter the frame's recent rows
The last 200 messages up to the cursor. No new store method; older messages aren't searchable from the table.

## Solution: store — Search the whole store with `store.search`

## Decision
Filter the recent rows. If wrong: switch to `store.search`.

---
id: ADR-0010
title: A Deterministic switch on the time bar
status: proposed
date: 2026-11-19
revisit: 
tags: time-machine, clock
parent: ADR-0001
decision: 
---

## Goal
Keep everyday apps cheap (the clock passes through to `setTimeout`, little traffic) and turn on recorded, exactly
replayable time for troubleshooting, demos and examples. Raised by the project owner.

## Solution: switch — Swap the clock pod's implementation by apply
The switch applies the deployment with the clock pod changed between `nano.ui/clock` and `nano.ui/sim-clock`, and
Resets so a recording never mixes the two. Workspace code only; no interface change.

## Solution: manual — Leave it to the nano.json
Choose the clock implementation per example, as today.

## Decision

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

## Solution: next-due — A "next due" op on ClockControl
The driver advances only to the next due timer. New API.

## Solution: infer — Infer due times from recorded after/cancel/fired traffic
No new concept, but fragile.

## Solution: accept — Accept it; lower the rate, cap the index, hide advance rows

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

## Solution: public — Public in nano-ui
Reusable by any host, the Ring view and the Raft example.

## Solution: internal — Workspace-internal as the spec said

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

## Solution: keep — Keep the export

## Solution: inline — Inline it in kvStep

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

## Solution: accept — Accept for now
No current example calls HostUI from a pod that the shadow rebuilds.

## Solution: stub — Provide a recording-backed HostUI stub in the shadow

## Decision
