# Clock Capability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put time under nano's control as a capability pod (`Clock`/`ClockControl`, a real and a simulated clock), move
the debounce onto a wired clock, and make `replay(…, { pace: 'fast' })` exact on a simulated-clock app.

**Architecture:**
- **nano.ui gains the interfaces and two implementations.** Pods that need time declare an optional `clock: Clock`
  dependency and fall back to real time.
- **The host drives a simulated clock** with `advance`. Those calls are recorded host inputs, so the time machine
  replays time exactly.
- **Fast replay waits for quiet** between inputs, because core doesn't await `on` listeners (D104).
- **No nano-core change.**

**Tech Stack:** TypeScript, bun test (`--isolate`), nano-core, nano-ui.

**Spec:** `docs/superpowers/specs/2026-11-18-clock-capability-design.md`. Read its "Calls made by Claude" section.

## Global Constraints

- **Size:** files at most 150 lines.
- **No core change:** no nano-core change at all.
- **New nano.ui exports:** `Clock`, `ClockControl`, `clock` and `simClock`. They are nano.ui's, so they don't go in the
  nano-core table, but `design.md`'s examples line mentions the clock.
- **Tests:**
  - `cd packages/nano && bun test --isolate`
  - `cd packages/ui && bun test --isolate`
  - `cd packages/ui-workspace && bun test --isolate`
  - `cd examples && bun test --isolate`
  - `bunx tsc --noEmit` at the root
- **Commits:** on the current branch (`dev-raft`), one per task, each ending with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **No hidden time:** a pod with a clock wired never also uses `setTimeout` or `Date.now`.
- **No breaking change:** a debounce without a clock behaves exactly as today. Its existing tests pass unchanged.

## Review Focus

1. **Two timers due at the same instant** fire in the order they were started (Task 1).
2. **`cancel` racing `advance`:** a timer cancelled before the `advance` that would fire it never fires (Task 1).
3. **A debounce that loses its clock** in an apply works on its next build with real time. It doesn't throw on push
   (Task 2).
4. **Fast replay with a pod that never settles** (a `log` that hangs): the quiet wait is bounded by core's call timeout
   and doesn't hang replay forever (Task 3).
5. **A sim-clock app replayed at `pace: 'original'`** stays exact too, so pace makes no difference with a sim clock
   (Task 3).

---

### Task 1: `Clock`, `ClockControl`, the real clock and the simulated clock

**Files:**
- Modify:
  - `packages/ui/src/interfaces.ts`: add `Clock` and `ClockControl` (with their schemas `Num`, `TimerId`, `After` and
    `Fired`).
  - `packages/ui/src/provider.ts`: add `clock` and `simClock` to `uiProvider`.
  - `packages/ui/src/index.ts`: export `Clock`, `ClockControl`, `clock` and `simClock`.
- Create:
  - `packages/ui/src/pods/clock.ts`: `nano.ui/clock`.
  - `packages/ui/src/pods/sim-clock.ts`: `nano.ui/sim-clock`.
- Test: `packages/ui/test/clock.test.ts`.

**Interfaces:**
- Produces:
  ```ts
  export const Clock = ns.interface('Clock', {
    now: Op.action(Nothing, Num), after: Op.action(After, TimerId), cancel: Op.action(TimerId, Nothing), fired: Op.event(Fired),
  })   // After = { ms: integer ≥ 0, tag?: string }; TimerId = integer ≥ 1; Fired = { id: TimerId, tag?: string, at: number }
  export const ClockControl = ns.interface('ClockControl', { advance: Op.action(Num, Nothing), set: Op.action(Num, Nothing) })
  export const clock: Implementation      // 'nano.ui/clock': Date.now / setTimeout; fired published when due
  export const simClock: Implementation   // 'nano.ui/sim-clock', config { start?: number } (default 0): time moves only by advance/set
  ```
- **Sim clock rules (from the spec):**
  - Timers fire in due order, and ties fire in the order they were started.
  - `advance(ms)` moves time forward, firing every timer due within the new time, one at a time, and awaits each
    `ctx.publish`.
  - `after(0)` is due at the next `advance`, including `advance(0)`.
  - `set(t)` with `t < now` fails with `invalid-input`. `set(t)` forward fires what falls due, as `advance` does.
  - `cancel` of an unknown or already-fired id succeeds.
  - A restart resets it to `config.start`.

- [ ] **Step 1: Write the failing tests.** Use an app with `sim: Pod.eager(simClock)` and a `log` pod with a pipe
  `sim.fired → log.log`, read through `log.entries`.
  - `advance fires due timers in due order, ties by start order`:
    1. `after({ms:30,tag:'c'})`, `after({ms:10,tag:'a'})` and `after({ms:10,tag:'b'})`.
    2. `advance(30)`.
    3. The logged tags are `['a','b','c']`, with `at` values `[10,10,30]`.
  - `nothing fires before its time`: `after({ms:10})`, then `advance(9)` logs nothing, then `advance(1)` logs one.
  - `cancel before the advance means it never fires`.
  - `after(0) fires on advance(0)`.
  - `now follows advance and set`: `now` is 0, then 25 after `advance(25)`. `set(100)` makes it 100, and `set(50)`
    fails with `invalid-input`.
  - `config start sets the initial time`: `simClock` with `{ start: 1000 }` gives `now` = 1000.
  - `the real clock fires after real time`: `clock`'s `after({ms:5})` logs one `fired` within 50 ms.
- [ ] **Step 2:** Run `cd packages/ui && bun test --isolate test/clock.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. A sorted array of `{ id, due, seq, tag }` is fine for the sim clock.
- [ ] **Step 4:** Run the ui suite and `tsc`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(ui): Clock and ClockControl, a real clock and a simulated one that moves only when advanced`.

### Task 2: The debounce on a wired clock, and the Typing example's clock

**Files:**
- Modify:
  - `packages/ui/src/pods/debounce.ts`: add `dependencies: { clock: Clock }`, and use the wired clock when
    `ctx.one(Clock)` is ok at build.
  - `examples/typing/nano.json`: add `"clock": { "implementation": "nano.ui/clock", "eager": true }` in `main`, and a
    call edge `{ "kind": "call", "from": "debounce", "to": "clock" }`.
  - `design.md`: in the examples line, mention that Typing's debounce runs on a clock pod.
- Test: `packages/ui/test/pods.test.ts`, with tests added.

**Interfaces:**
- Consumes: Task 1's `Clock`, `simClock` and `ClockControl`.
- Produces: the debounce's behaviour is unchanged without a clock. With a clock:
  - quiet and max-wait timers are `after({ ms, tag: 'quiet' | 'max' })`;
  - a push cancels the pending quiet timer;
  - it flushes on its own timer's `fired`, heard through `ctx.one(Clock).value.on(Clock.ops.fired, …)` and kept only
    for its own ids.

- [ ] **Step 1: Write the failing tests.** Use a debounce with config `{ quietMs: 100, maxWaitMs: 500 }`, a `simClock`
  pod and a call edge `wait → sim`.
  - `on a sim clock, nothing flushes until the clock is advanced`:
    1. push `a` and `b`.
    2. Wait 50 ms of real time. `all` is empty.
    3. `advance(100)`, then let it settle. `all` is `[['a','b']]`.
  - `pushes keep resetting quiet; max wait still flushes`: push every `advance(60)` for 10 rounds. Batches flush by the
    500 ms max wait in sim time.
  - `no clock: unchanged`: the existing debounce tests pass as they are.
  - `the Typing example still works with its clock pod`: `examples/typing/typing.test.ts` passes, updated only if the
    fixture needs the edge.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement. Keep `debounce.ts` under 150 lines; a small helper inside it is fine.
- [ ] **Step 4:** Run all four suites and `tsc`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(ui): the debounce keeps time by a wired clock (real time without one); Typing wires a clock pod`.

### Task 3: Exact fast replay on a simulated clock

**Files:**
- Modify: `packages/ui-workspace/src/recorder/replay.ts`, adding `pace?: 'original' | 'fast'` to `replay`'s opts
  (default `'original'`).
- Modify: `packages/ui-workspace/test/recorder/typing.ts`, adding a `typingSim()` fixture: Typing with
  `clock: nano.ui/sim-clock`.
- Test: `packages/ui-workspace/test/recorder/replay-clock.test.ts` (new).

**Interfaces:**
- Consumes: Tasks 1 and 2, and the existing `record`, `replay`, `pair`, `diverge` and `roots`.
- Produces: `replay(app, store, { …, pace: 'fast' })`.
  - It doesn't sleep between inputs.
  - Before each input it waits until no message is in flight: every `sent` seen on `app.listen` since replay began has
    a `delivered` or `denied`. Then it yields one macrotask (`setTimeout(0)`).
  - It is bounded: if quiet hasn't come within core's call timeout plus 1 s, it goes on and counts that input as
    failed.

- [ ] **Step 1: Write the failing tests** on `typingSim()`, recording with `record(app, store, { clean: true })`.
  - `typing on a sim clock, replayed fast, is exact`:
    1. `change('h')`, `change('hi')`.
    2. `app.call('main','clock').advance(1000)`.
    3. `change('hey')`, then `advance(1000)`.
    4. The log is `['HI','HEY']`. Stop.
    5. Replay into a second store with `{ pace: 'fast' }`.
    6. The log is `['HI','HEY']`, and `diverge(pair(first range), pair(second range))` is null.
  - `fast replay is quick`: the replay above takes under 200 ms of real time, though the recording spanned two
    `advance(1000)`s.
  - `the same recording replayed at original pace is exact too`.
  - `quiet is bounded`: a deployment whose log pod is replaced by a test provider that never resolves `log`. Fast
    replay finishes with `failed ≥ 1` within the call timeout plus slack. Use a short `timeoutMs` in
    `Application.create` options for the test.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement. Count `sent` against outcomes in a listener attached for the replay's lifetime and removed
  at the end.
- [ ] **Step 4:** Run all four suites and `tsc`, and run the new test 5 times. Expected: PASS every time.
- [ ] **Step 5:** Commit `feat(recorder): replay fast — exact on a simulated clock, waiting for quiet between inputs`.
