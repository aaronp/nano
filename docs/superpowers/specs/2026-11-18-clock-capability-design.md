# The clock as a capability — design

Date: 2026-11-18. Follows the headless message recorder (`2026-11-18-message-recorder-design.md`), and comes before
the Raft case study.

## Intent

The time machine replays exactly only at the original pace, because pods use time on their own. The debounce, for
example, calls `setTimeout` directly. The user wants time under nano's control: pause, slow down (raft.github.io's 1/30×),
step, and scrub with exact replay at any speed.

## Approach (user chose B, 2026-11-18)

- **A. `ctx.clock` in nano-core.** Rejected. It is a new core concept and takes the last free member on `NanoContext`.
  Clock control would happen outside messages, so it would need a new kind of recorded event to replay.
- **B. The clock is a capability pod (chosen).** A `Clock` interface is provided by a pod, and pods that need time
  declare a `clock` dependency. There is no core change. Every timer and tick is a message, so it is recorded, shown on
  the wire and replayed. The host drives a simulated clock by calling it, and those calls are host inputs the time
  machine already re-runs. Replay therefore becomes exact at any speed.

## Interfaces (nano.ui, alongside Input, Debounce, Map and Log)

- **`Clock`:** what a pod uses.
  - `now: action(Nothing, Num)`: the clock's current time in ms.
  - `after: action({ ms, tag? }, TimerId)`: starts a timer and returns its id at once. When it is due, the clock
    publishes `fired`.
  - `cancel: action(TimerId, Nothing)`: cancelling an unknown or already-fired id does nothing.
  - `fired: event({ id, tag?, at })`: one per due timer, in due order. Timers due at the same time fire in the order
    they were started. `at` is the clock time it fired at.
- **`ClockControl`:** what the host uses. Only the simulated clock provides it.
  - `advance: action(Num, Nothing)`: moves time forward by ms and fires everything that falls due in that span, in order.
  - `set: action(Num, Nothing)`: sets the current time (forward only).
- **Implementations:**
  - **`nano.ui/clock` (real):** provides `Clock` from `Date.now` and `setTimeout`. This is the default when a pod needs
    time.
  - **`nano.ui/sim-clock` (simulated):** provides `Clock` and `ClockControl`. Its time starts at 0 (or its config's
    `start`) and moves only on `advance`/`set`. It never uses a real timer.
- **Pause and speed belong to whoever drives `advance`.** In the workspace that is the timeline (phase 2 of the
  recorder): playing at 1/30× means advancing by `real elapsed / 30` each frame, and paused means not advancing.
  - Because the driver is the host, every `advance` is a recorded root.
  - Replaying those roots reproduces time exactly, whatever the replay pace.
  - Replay of a sim-clock app may run as fast as possible. That becomes a `replay` option (`pace: 'original' | 'fast'`),
    and phase 2 uses it.

## Pods that use time

- **Dependency:** a pod that needs time declares the dependency `clock: Clock`, used through `ctx.deps.clock` and
  `ctx.one(Clock)`. It hears `fired` with `selection.on(Clock.ops.fired, …)` and keeps only its own timer ids.
- **No clock wired:** when `ctx.one(Clock)` isn't ok, the pod uses real time, as today. Existing deployments keep
  working unchanged.
- **The debounce changes first:** quiet and max-wait timers go through the clock when one is wired, with cancel on
  each push.
- **The Typing example:** gains a `clock` pod (`nano.ui/sim-clock` is not right for a live demo, so it uses
  `nano.ui/clock`) and a call edge `debounce → clock`. The example keeps behaving as now.
- **The test that proves it:** the same Typing app with a `sim-clock`, a recording, and a replay with `pace: 'fast'`.
  `diverge` must be null. This is the test that failed by design in the recorder phase.

## Goals

- `Clock` and `ClockControl` interfaces, a real clock, and a simulated clock in nano.ui.
- The debounce uses a wired clock and falls back to real time.
- `replay(…, { pace: 'fast' })` on a sim-clock app is exact.
- A test showing the sim clock's ordering (due order, ties by start order, cancel, `set` forward only).

## Non-goals

- The workspace timeline driving `advance`. That is recorder phase 2.
- The Raft example.
- Any nano-core change.
- Clock skew per pod or per runtime. One clock pod can serve a whole app, and Raft can give each server its own clock
  later if it needs skew.

## Anti-goals

- **No hidden time.** A pod with a clock wired never also uses `setTimeout` or `Date.now`.
- **No breaking change** to apps without a clock.

## Constraints

- Files at most 150 lines.
- nano.ui's exports grow by `Clock`, `ClockControl`, `clock` and `simClock`. They are nano.ui's, not nano-core's, so
  they don't go in `design.md`'s nano-core table. The examples list in `design.md` mentions the clock.
- Tests: the four suites and `tsc`.

## Calls made by Claude (from the builder check)

1. **Fast replay waits for quiet.** Core doesn't wait end to end: an action's caller doesn't wait for its pipes, and
   `publish` waits for pipes but not for `on` listeners (D104, still open).
   - `replay(…, { pace: 'fast' })` therefore waits, before each next host input, until no recorded message is in
     flight. It counts `sent` against `delivered`/`denied` on `app.listen`, then yields one macrotask.
   - Original-pace replay is unchanged.
2. **The sim clock fires in order and waits for each `publish`.** It fires timers one at a time in due order within an
   `advance`. The `on` listeners (`fired` reaching the debounce) aren't awaited by core, so fast replay relies on
   quiet (1) for them.
3. **The `clock` dependency is optional.** An unwired declared dependency doesn't fail `assemble` or `apply`; only call
   edges are checked. The debounce declares `clock: Clock`. Without a clock, `ctx.one(Clock)` isn't ok and it uses
   real time. Its edge to a clock is a plain call edge `debounce → clock`, with no pipe needed.
4. **The debounce chooses its clock when it is built.** Adding or removing a clock takes effect on its next build: a
   restart, or an apply that changes it. Choosing on every push would complicate it for no gain.
5. **Sim clock rules:**
   - **Restart:** a restart resets it to `config.start`, 0 by default, so a clean start means time 0.
   - **Backwards:** `set` to an earlier time fails with `invalid-input` rather than doing nothing.
   - **`after`:** `ms` is an integer ≥ 0. `after(0)` is due at the next `advance`, including `advance(0)`, which is
     allowed: it fires whatever is due now.
   - **`cancel`:** cancelling an unknown or fired id succeeds and does nothing.

## Left to the builder

- `TimerId`'s shape (a string or number schema).
- The sim clock's data structure (a sorted array is fine at this scale).
