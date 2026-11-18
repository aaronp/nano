# The time machine — design (recorder phase 2)

Date: 2026-11-18. Builds on the headless recorder (`2026-11-18-message-recorder-design.md`), the clock capability and
the random capability. It replaces that spec's "Timeline and views" section, which is phase 2.

## Intent

Event-driven observability for any nano app:
- The app is recorded from its start.
- A **time machine** moves a cursor over the recording, by hand or on a scaled ticker.
- Views subscribe to it and redraw. They are decoupled and react the same whatever moves time.

A **Raft case study** comes after this. It is a teaching example of nano observability (a ring of servers, messages in
flight, ledgers), not another production Raft. It gets its own spec.

## Decided (user, 2026-11-18)

- **The tools are plain workspace web components and modules, not nano pods.** They send no nano messages, so they
  can never be recorded.
  - No recursion.
  - The observed app is never touched.
- **State at a time t comes from two sources:**
  1. **Folding the history** (the default): cheap, read-only, no re-running. It works for state that reaches the
     history as messages, such as a KV store's puts and deletes from its configured start, published events, and
     messages in flight.
  2. **A shadow app** (exact, costlier): a private `Application` built from the recorded clean deployment and
     replayed to t at fast pace with no recorder. It is for state that lives only inside a pod's closure. The caller
     reads it and closes it.
- **Re-execution (reset and replay of the live app) is kept for resuming live from a past point.** Scrubbing never
  uses it.
- **Guidance for apps that want instant scrubbing** (Raft follows it): keep important state in a store pod, and
  publish changes as events.
- **Mechanisms, not guarantees.** Pods may have side effects, and replay states its assumptions; it doesn't promise.

## Parts

### A. Recording from the start (host)

- The host starts `record(app, store, { clean: true })` before any import or apply, into a `memoryStore()`.
- `Host` exposes it as `host.history` (the `MessageStore`). It is a workspace-internal member.
- Reset (formerly "Clear") restarts every pod, empties the store and starts a fresh clean recording. See "Decided after the builder check".

### B. The time machine (a workspace module, headless)

- **`timeMachine(store, opts)`** returns an object with:
  - `cursor`: a time in the recording's `at` units;
  - `mode`: `'live' | 'paused' | 'playing'`;
  - `speed`: one of 1/30, 1/10, 1/4, 1/2, 1 or 2;
  - methods to `seek(t)`, `step(±1)`, `play()`, `pause()`, `live()` and `setSpeed(s)`;
  - `subscribe(fn)`, which hears a **frame** on every change.
- **A frame** is `{ t, inFlight: { message, progress }[], recent: Message[], at: Message | undefined }`:
  - `inFlight` lists each message whose visual window covers `t`, with its progress from 0 to 1;
  - `recent` holds the last N messages up to `t` (the table's rows);
  - `at` is the message nearest the cursor.
- **Visual travel time** is 600 ms at speed 1, scaled by speed, and starts at the message's `at`. The `delivered` time
  never matters, because real deliveries take microseconds.
- **Modes:**
  - **Live:** the cursor follows the newest entry, and new entries emit frames.
  - **Playing:** the cursor moves at `speed` × real time on `requestAnimationFrame` (an injectable ticker) and switches
    to Live when it catches up.
  - **Paused:** recording continues, and the cursor stays put.
- **Driving a simulated clock:** when the observed app has a pod providing `ClockControl`, Live and Playing at the
  newest time drive it.
  - Each tick calls `advance(real elapsed × speed)`, then waits for quiet before the next tick. It reuses replay's
    in-flight counting, shared from a workspace-internal module.
  - Pause stops advancing.
  - This gives the observed app raft.github.io's pause and 1/30×.

### C. Folding helpers (pure)

- **`foldAt(store, t, { initial, step, filter? })`** returns the state after folding the paired messages with
  `at ≤ t`. It is generic, and the domain supplies `step`.
- **The KV reducer lives with the KV example** (`examples/kv`): `kvStep(pod)` folds the `put`/`delete` calls to `pod`
  from its configured entries. The workspace stays free of example code.

### D. The shadow app

- **`shadowAt(store, registry, t)`:**
  1. Creates an `Application` from the recording's clean deployment.
  2. Replays it to the last entry at or before `t` with `pace: 'fast'` and no recorder.
  3. Returns the app, which the caller closes.
- It refuses, as replay does, when the clean start is gone.
- It is not cached in this phase. Checkpoints come later if needed.

### E. Views (subscribers)

These are the first subscribers, from the recorder spec's phase 2.
- **The time-machine bar `<c-time-machine>`:**
  - play/pause, step back and forward;
  - a slider over the recording's span;
  - speed, Live, and Clear.
  - It shows on the Desk page and the Messages page, and both share one time machine.
- **The Messages table (`#/messages`, nav Connections | Desk | Messages):**
  - searchable;
  - follows the cursor;
  - a row click pauses the timeline there and selects that message.
- **Desk dots:** a frame's `inFlight` are drawn on the Desk's cords, using the call-cord and pipe matching rules
  already decided in the recorder spec's "Calls made by Claude" 1 to 3.
- **Message detail:** the full input and result, timing or denial, and the cause chain (clickable).

## Goals

- The app is recorded from creation. Scrubbing, stepping, playing at a speed and returning to Live all work on the
  Desk and the Messages table together.
- A sim-clock app can be paused and slowed live through the time machine.
- `foldAt` with `kvStep` gives a KV store's contents at any t. `shadowAt` gives a full app at any t.

## Non-goals

- The Ring view and the Raft example, each with its own spec next.
- Persisting recordings: IndexedDB comes later, behind the store contract.
- Checkpoints for `shadowAt`.
- Branching history: resuming live from the past is possible with replay but has no UI yet.

## Constraints

- Files at most 150 lines.
- New exports are workspace-internal, except `kvStep` in the KV example.
- Tests: headless for B, C and D, with injected ticker and clock; happy-dom for E; and a real-browser check of the
  Typing example.

## Decided after the builder check

**By the user, 2026-11-18:**
- **Clear means reset and clear.**
  - It restarts every pod and starts a fresh clean recording, so live state and the recording always agree.
  - The bar labels it "Reset".
- **The in-memory history defaults to 100,000 entries.**
  - When the clean start has dropped off, the bar shows "history too long to rebuild state".
  - Folding of messages still works, while state-rebuilding (`shadowAt`, resume) is unavailable.

**By Claude:**
1. **New entries:**
   - `record()` resolves to `{ stop, listen(fn) }`, where `listen` hears each appended entry. It is
     workspace-internal, and the `MessageStore` interface is unchanged.
   - The time machine keeps an in-memory index of paired messages, filled from `range()` at start and from `listen`
     after. Frames are computed synchronously from it.
2. **The cursor is a time** (`at`, wall-clock ms).
   - `step(±1)` moves to the previous or next message, with ties broken by seq.
   - "At or before t" means `at ≤ t`, in seq order.
   - Playing skips any idle gap longer than 1 s, so it jumps to the next message. The slider is plain time.
3. **The clock driver:**
   - It drives only when exactly one pod in the deployment has an implementation that provides `ClockControl`. Its
     runtime comes from `lookup(d).placedIn`.
   - With none or several, there is no driving, and the bar says why.
   - The clock is looked up again on every `applied`.
   - Ticks are capped at 20 a second, each waiting for quiet.
4. **The shadow app:**
   - `shadowAt` takes a `create(deployment)` factory from the host, using the host's registry and isolation, rather
     than a registry.
   - The shadow deployment leaves out the host's own pod (`ui`) and skips host inputs addressed to it.
5. **Folding:**
   - `step` receives each paired message with its outcome. `kvStep` folds only `put`/`delete` calls whose outcome
     succeeded.
   - `foldAt` also hands `step` the deployment entries, so `kvStep` resets a store to its config when an apply changes
     that store's config or implementation.
6. **Desk dots** go in a new `desk/` file, with a geometry export from `cords.ts`. Both are workspace-internal, so
   there are no `design.md` entries.

## Left to the builder

- File layout under `src/recorder/` and `src/time-machine/`, and the frame's `recent` length (default 200).
- Bar styling, which follows the Desk's palette.
