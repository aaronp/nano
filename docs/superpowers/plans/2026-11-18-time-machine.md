# Time Machine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record any nano app from its start and move a reusable time machine over the recording. Views subscribe to its
frames, and state at any time is available by folding or from a shadow app. Strong tests prove that replay is
consistent.

**Architecture:**
- **Reusable parts live in nano-ui** (`packages/ui/src/observe/`): the recorder (moved from the workspace), the
  time-machine core, the folding helpers, the shadow app and the `<nano-time-machine>` bar. Any host or example can use
  them.
- **The workspace keeps its own parts:** recording from host start, Reset, the Messages page and the Desk dots.
- **No nano-core change.**

**Tech Stack:** TypeScript, Lit, bun test (`--isolate`), happy-dom, nano-core.

**Spec:** `docs/superpowers/specs/2026-11-18-time-machine-design.md`, binding, including the section "Decided after
the builder check". Also see the recorder spec, the clock spec and the random spec in `docs/superpowers/specs/2026-11-18-*`.

## Global Constraints

- **Size:** files may not pass 150 lines.
- **No core changes:** nano-core gains nothing.
- **Exports:** nano-ui's exports grow by the `observe` API named in each task. Those names belong to nano-ui, not
  nano-core, so they don't go in `design.md`'s core table. The examples line mentions observability.
- **Tests:**
  - `cd packages/nano && bun test --isolate`
  - `cd packages/ui && bun test --isolate`
  - `cd packages/ui-workspace && bun test --isolate`
  - `cd examples && bun test --isolate`
  - `bunx tsc --noEmit`
- **Commits:** on the current branch (`dev-raft`), one or more per task, each ending with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **History default:** 100000 entries in memory.
- **Visual travel time:** 600 ms at speed 1.
- **Speeds:** 1/30, 1/10, 1/4, 1/2, 1 and 2.
- **Playing:** skips idle gaps over 1000 ms.
- **The clock driver:** ticks at most 20 times a second, waiting for quiet before each tick.
- **Reset:** restarts every pod and starts a fresh clean recording.

## Review Focus

1. **Folding and the shadow app agree.** At every message boundary of a recorded run, `foldAt(kvStep)` equals the
   shadow app's KV contents. This property holds across five seeds (Task 3).
2. **Replay is the same at every speed.** A sim-clock run replayed at `fast` and at `original` gives identical
   messages, and the same holds after a Reset mid-session (Task 3 and Task 5).
3. **Applies mid-recording.** An apply that changes a KV store's config resets its fold at that point, and the shadow
   app agrees (Task 3).
4. **History too long.** Once the clean start has been evicted, `shadowAt` and Reset report it clearly, while frames
   and folding still work (Task 3 and Task 5).
5. **Many messages at the same instant.** `step` visits each one in seq order, and frames list them all (Task 2).

---

### Task 1: Move the recorder into nano-ui (`observe/`)

**Files:**
- Move: `packages/ui-workspace/src/recorder/*` → `packages/ui/src/observe/`, together with its tests:
  `packages/ui-workspace/test/recorder/*` → `packages/ui/test/observe/`.
  - The Typing fixture loads `examples/typing/nano.json`. Fix that relative path.
- Modify: `packages/ui/src/index.ts` to export `record`, `replay`, `diverge`, `roots`, `pair`, `snap`, `truncated`,
  `memoryStore`, and the types `Entry`, `Recorded`, `Message` and `MessageStore`.
  - `storeContract` stays a test helper. Export it from a test-support path, or keep it under `test/`.
- Modify: `record()` resolves to `{ stop, listen(fn) }` (spec, decided item 1). Update its callers and tests.
- Modify: `memoryStore` default `max` becomes 100000.
- Test: the moved tests pass as they are, plus `listen hears each appended entry, in order`.

- [ ] **Step 1:** Write the `listen` test and the default-max test (100000). Run them; they FAIL.
- [ ] **Step 2:** Move the files, fix the imports, and add the exports and `listen`.
- [ ] **Step 3:** Run all four suites and `tsc`; all PASS. `grep -rn "src/recorder" packages` finds nothing.
- [ ] **Step 4:** Commit `refactor(observe): the recorder moves to nano-ui; record() gives stop and listen; 100k default`.

### Task 2: The time machine core (headless)

**Files:**
- Create: `packages/ui/src/observe/time-machine.ts`, plus a small `index` or `frames` helper if needed.
- Test: `packages/ui/test/observe/time-machine.test.ts`.

**Interfaces:**
```ts
export type Frame = { t: number; inFlight: { message: Message; progress: number }[]; recent: Message[]; at?: Message }
export type Ticker = { now(): number; frame(fn: () => void): () => void }   // default: performance/Date + requestAnimationFrame
export function timeMachine(source: { store: MessageStore; listen: (fn: (e: Entry) => void) => () => void }, opts?: { ticker?: Ticker; recent?: number; travelMs?: number }): Promise<TimeMachine>
export interface TimeMachine {
  readonly cursor: number; readonly mode: 'live' | 'paused' | 'playing'; readonly speed: number; readonly span: { from: number; to: number }
  seek(t: number): void; step(dir: 1 | -1): void; play(): void; pause(): void; live(): void; setSpeed(s: number): void
  subscribe(fn: (f: Frame) => void): () => void; close(): void
}
```
- **Frames:**
  - `inFlight` holds messages whose window `[at, at + travelMs / speed]` covers `t`.
  - `progress` is `(t - at) / (travelMs / speed)`.
  - `recent` holds the last `recent` messages (default 200) with `at ≤ t`, in seq order.
  - `at` is the newest message with `at ≤ t`.

- [ ] **Step 1: Write the failing tests.** Use an injected fake ticker and a `memoryStore` filled by `record` on a
  Typing-sim app, or by appending entries directly:
  - `live follows new entries and emits a frame each`.
  - `seek(t) gives the messages in flight with progress`: a message at 1000, seek(1300) at speed 1 gives progress 0.5.
  - `step visits messages sharing an at in seq order`.
  - `playing moves at speed × real time and jumps idle gaps over 1 s`.
  - `playing catches up and becomes live`.
  - `pause stays put while recording continues; span grows`.
  - `close stops listening and ticking`.
- [ ] **Step 2:** Run the tests; they FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the ui suite and `tsc`; all PASS.
- [ ] **Step 5:** Commit `feat(observe): a time machine — a cursor over the recording, frames of what's in flight`.

### Task 3: State at time t: folding, the shadow app, and the consistency tests

**Files:**
- Create: `packages/ui/src/observe/fold.ts` (`foldAt`) and `packages/ui/src/observe/shadow.ts` (`shadowAt`).
- Create: `examples/kv/fold.ts` (`kvStep`), and export it from the KV example.
- Test:
  - `packages/ui/test/observe/fold.test.ts`
  - `packages/ui/test/observe/shadow.test.ts`
  - `examples/kv/fold.test.ts`, which holds the consistency property.

**Interfaces:**
```ts
export function foldAt<S>(store: MessageStore, t: number, r: { initial: S; step(s: S, m: Message): S; deployment?(s: S, d: AppDeployment): S }): Promise<S>
export function shadowAt(store: MessageStore, t: number, create: (d: AppDeployment) => Promise<NanoResult<Application>>, opts?: { host?: string }): Promise<NanoResult<Application>>
// examples/kv: kvStep(pod) → { initial, step, deployment } over the KeyValueStore's put/delete calls to `pod` (succeeded only), reset from config on a deployment change
```
- **The shadow app:**
  - It leaves out pod `opts.host` (default `'ui'`) and host inputs addressed to it.
  - It replays to the last entry with `at ≤ t` at `pace: 'fast'`, with no recorder.
  - It refuses with `not-found` when the clean start is gone.
- **The KV example store** gains an optional config `{ entries?: Entry[] }`: initial state loaded from config. This is
  the "storage loadable from initial state" the user asked for. It lives in the example, so there is no new concept.

- [ ] **Step 1: Write the failing tests.**
  - **`foldAt` over a log pod:** it counts only successful messages.
  - **`kvStep` resets on an apply that changes the store's config.**
  - **`shadowAt` refuses when the clean start is gone.**
  - **`shadowAt` excludes the `ui` pod.**
  - **The consistency property (`examples/kv/fold.test.ts`).** For seeds 1 to 5:
    1. Build a sim-clock app with a seeded random. Its writer pod, on each `fired`, puts or deletes a random key in a
       KV store started from config `{ entries }`, then re-arms.
    2. Record 30 `advance(10)` calls, settling after each.
    3. At every message boundary `t`, `foldAt(kvStep)` must deep-equal `(await shadowAt(t)).call(kv).list({ prefix: [] })`.
  - **Replay at every speed:** the same run replayed at `fast` and at `original` gives `diverge` null against the
    recording, comparing from the first host input.
- [ ] **Step 2:** Run the tests; they FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the consistency test 3 times. Then run all four suites and `tsc`; all PASS.
- [ ] **Step 5:** Commit `feat(observe): state at any time — fold the history or rebuild a shadow app; consistency proven across seeds`.

### Task 4: The clock driver

**Files:**
- Create: `packages/ui/src/observe/clock-driver.ts`.
- Modify: `replay.ts`, sharing its in-flight counting through a small internal module.
- Test: `packages/ui/test/observe/clock-driver.test.ts`.

**Interfaces:**
```ts
export function clockDriver(app: Application, registry: Registry, tm: TimeMachine, opts?: { maxHz?: number }): { readonly driving: string | null; readonly reason?: string; close(): void }
```
- **Which clock:** it drives the one pod whose implementation provides `ClockControl` (found through the registry),
  and looks again on `applied`. With none or several, `driving` is null and `reason` says why.
- **When it ticks:** while `tm` is live or playing at the newest time.
  - **Each tick:** it calls `advance(elapsed real ms × speed)`, then waits for quiet.
  - **Rate:** at most `maxHz` ticks a second (default 20).
  - **Pause:** pausing stops the ticks.

- [ ] **Step 1: Write the failing tests** with a fake ticker:
  - `drives the sole sim clock at speed × real time`: at 1/30, 3000 ms of real time advances 100 ms.
  - `pause stops advancing`.
  - `two sim clocks: no driving, reason given`.
  - `ticks are capped at 20 a second`.
- [ ] **Step 2:** Run the tests; they FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the ui suite and `tsc`; all PASS.
- [ ] **Step 5:** Commit `feat(observe): a clock driver — the time machine paces a simulated clock live`.

### Task 5: The workspace: recording from the start, `history`, Reset, and the bar

**Files:**
- Modify:
  - `packages/ui-workspace/src/host.ts`: start `record(app, store, { clean: true })` before any import, and expose
    `history: { store, listen }` and `reset()`.
  - `src/main.ts`: create one time machine and one clock driver for the page.
- Create: `packages/ui/src/observe/bar.ts`, the reusable `<nano-time-machine>` element. It shows play/pause, step,
  the slider over the span, speed, Live and Reset, plus "history too long to rebuild state" and the driver's reason.
- Test:
  - `packages/ui/test/observe/bar.test.ts` (happy-dom).
  - `packages/ui-workspace/test/history.test.ts`.

- [ ] **Step 1: Write the failing tests.**
  - **History from the start:** a fresh host's history begins with a clean deployment entry, and importing Typing
    records its apply.
  - **Reset:**
    1. Type into Typing, then Reset.
    2. Every pod is restarted, and the log is empty.
    3. The history is a single clean deployment entry.
  - **History too long:** with `memoryStore({ max: 20 })`, the bar shows "history too long to rebuild state".
  - **The bar drives the time machine:** clicking play, pause, step, a speed or Live changes `tm`, and moving the
    slider seeks.
- [ ] **Step 2:** Run the tests; they FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run all four suites and `tsc`; all PASS.
- [ ] **Step 5:** Commit `feat(workspace): record from the start; one time machine and Reset in a reusable bar`.

### Task 6: The Messages page and message detail

**Files:**
- Create: `packages/ui-workspace/src/messages/` for the table and the detail.
- Modify: `public/index.html` to add the `#/messages` route, with the nav reading "Connections | Desk | Messages".
- Modify: `boot-wiring.ts` to treat `/messages` as `/desk`.
- Test: `packages/ui-workspace/test/messages.test.ts`.

- [ ] **Step 1: Write the failing tests.**
  - **Following the cursor:** rows follow the cursor, and the row at the cursor is highlighted.
  - **Search:** filters rows by pod, port or value.
  - **Row click:** pauses the timeline there and opens the detail.
  - **Detail:** shows input, result, ms and the cause chain. Clicking a cause seeks to it.
- [ ] **Step 2:** Run the tests; they FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the workspace suite and `tsc`; all PASS.
- [ ] **Step 5:** Commit `feat(workspace): the Messages page follows the time machine; message detail with its cause chain`.

### Task 7: Desk dots, then a browser check

**Files:**
- Create: `packages/ui-workspace/src/desk/dots.ts`, which draws a frame's `inFlight` as dots on cords.
- Modify: `desk/cords.ts` to export the cord geometry, and `desk.ts` to subscribe to the page's time machine.
- Test: `packages/ui-workspace/test/desk/dots.test.ts`.

- [ ] **Step 1: Write the failing tests.**
  - A pipe message at progress 0.5 draws a dot halfway along its pipe's cord.
  - A call travels caller to callee, per the recorder spec's rules.
  - A host message draws no dot.
  - Clicking a dot pauses the timeline and opens the detail.
- [ ] **Step 2:** Run the tests; they FAIL.
- [ ] **Step 3:** Implement. Keep `desk.ts` within 150 lines.
- [ ] **Step 4:** Run all four suites and `tsc`; all PASS.
- [ ] **Step 5:** Commit `feat(desk): messages travel the cords as the time machine moves`.
- [ ] **Step 6:** Controller step: a real-browser check with Typing on a sim clock. Pause, play at 1/10, scrub, and
  click a dot.
