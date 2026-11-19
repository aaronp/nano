# Architecture decisions

One entry per decision, newest last. Status: **Proposed** (made by Claude, awaiting review), **Accepted**,
**Superseded by ADR-n** or **Rejected**. "If wrong" is what it costs to reverse.

Source: the time-machine work on `dev-raft` (spec `docs/superpowers/specs/2026-11-18-time-machine-design.md`, plan
`docs/superpowers/plans/2026-11-18-time-machine.md`), 2026-11-18/19.

---

## ADR-001: A message's travel window is constant in recording time

- **Status:** Proposed
- **Context:** The time machine draws each message in flight for a visual "travel time" (600 ms at speed 1). Speed
  could scale either the window or the cursor's motion.
- **Decision:** The window is a constant `travelMs` (600) of recording time. Speed scales only how fast the cursor
  moves, so on screen a message takes `travelMs / speed`.
- **Consequences:** Slow speeds stretch travel naturally; frames are a pure function of the cursor.
- **If wrong:** retune one constant.

## ADR-002: Live mode ticks frames on the recording's clock while anything is in flight

- **Status:** Proposed
- **Context:** In Live mode the cursor follows the newest entry, but dots must keep moving between appends.
- **Decision:** Live mode keeps emitting frames while any message is in flight. The default ticker's `now` is
  `Date.now`, the same clock that stamps entries.
- **If wrong:** nothing to undo.

## ADR-003: The time machine accepts only the six speeds

- **Status:** Proposed
- **Context:** The spec lists speeds 1/30, 1/10, 1/4, 1/2, 1 and 2.
- **Decision:** `setSpeed` accepts only those and throws a `RangeError` otherwise.
- **If wrong:** loosen one check.

## ADR-004: `clockDriver` takes an optional ticker

- **Status:** Proposed
- **Context:** The driver measures elapsed real time; headless tests need to fake it.
- **Decision:** `clockDriver(app, registry, tm, { maxHz?, ticker? })`, where `ticker` is the time machine's own `Ticker`
  type. It is the only addition to the planned signature.
- **If wrong:** drop one option.

## ADR-005: The time bar is `<nano-time-machine>` in nano-ui

- **Status:** Proposed
- **Context:** The spec named a workspace element `<c-time-machine>`; the user then asked for reusable time-machine
  displays.
- **Decision:** The bar lives in nano-ui as `<nano-time-machine>`. It takes a time machine, emits `reset`, and sends no
  nano messages.
- **If wrong:** a rename.

## ADR-006: Reset lives on the history (`host.history.reset()`)

- **Status:** Proposed
- **Context:** Adding `history` and `reset` took `Host` to 11 members, over the 10-member limit (first done through a
  type intersection, which hid it from the structure check).
- **Decision:** `host.history = { store, listen, reset }`; `Host` keeps 10 plain members. The recording code lives in
  its own workspace module (`src/history.ts`), since `host.ts` was already at 150 lines.
- **Consequences:** Reset is "about the recording": it restarts every pod, clears the store and starts a fresh clean
  recording. Concurrent calls join the one in progress.
- **If wrong:** rename back to `host.reset()`.

## ADR-007: Module-level exports that are not on a package index are internal

- **Status:** Proposed
- **Context:** CLAUDE.md treats every new export as a question. Files share helpers (`cleanStart`, `SPEEDS`,
  `inFlight`, `recording`, `cordOf`, `follow`, `causeChain`).
- **Decision:** An export between files that no package index re-exports is internal plumbing and needs no
  `design.md` entry (the same rule already applied to workspace-internal exports).
- **If wrong:** inline them.

## ADR-008: Messages search filters the recent rows in the view

- **Status:** Proposed
- **Context:** The Messages table must be searchable; the store contract has a `search`.
- **Decision:** Search filters the frame's `recent` rows (the last 200 up to the cursor) by pod, port or value. No new
  store method.
- **Consequences:** Older messages aren't searchable from the table.
- **If wrong:** search the whole store with `store.search`.

---

## Open questions (to decide)

- **Q1. A "Deterministic" switch on the time bar** that applies the deployment with the clock pod swapped between
  `nano.ui/clock` (pass-through to `setTimeout`, the default, little traffic) and `nano.ui/sim-clock` (recorded,
  exact replay), Resetting on each switch. Raised by the user, 2026-11-19.
- **Q2. A "next due" op on `ClockControl`,** so the driver advances only when a timer is due. Without it, a live
  sim-clock app records an `advance` every 50 ms (about 40 entries a second), which floods the Messages table and
  evicts the 100,000-entry history's clean start within the hour.
- **Q3. The observe API is public in nano-ui.** The spec said "workspace-internal except `kvStep`"; the plan exported
  `record`, `replay`, `timeMachine`, `foldAt`, `shadowAt`, `clockDriver`, `<nano-time-machine>` and their types, for
  reuse.
- **Q4. `order` exported from `examples/kv/memory.ts`** for `kvStep`. Keep, or inline.
- **Q5. `shadowAt` leaves out the host's `ui` pod.** Pods that call HostUI (`approve`, `alert`) behave differently in
  the shadow than they did live.
