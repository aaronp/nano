# Random Capability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add seeded randomness as a nano.ui capability: a `Random` interface, a real pod and a seeded pod, with
exact replay proven.

**Architecture:** This mirrors the clock capability. Draws are messages to a pod, and a seeded pod restarts to its
seed. There is no nano-core change.

**Tech Stack:** TypeScript, bun test (`--isolate`).

**Spec:** `docs/superpowers/specs/2026-11-18-random-capability-design.md`

## Global Constraints

- **Size:** files at most 150 lines.
- **No core change:** no nano-core change.
- **New exports:** nano.ui's exports grow by `Random`, `random` and `seededRandom`.
- **Tests:** run all four suites and `bunx tsc --noEmit`.
- **Commits:** commit on the current branch (`dev-raft`), one per task, each ending with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Seeded random:**
  - It uses mulberry32.
  - Its config is `{ seed?: integer }`, with a default of 1.
  - Values are in [0, 1).
  - A restart resets it to the seed.

## Review Focus

1. **Seed 0 and negative or large seeds** give a valid, non-degenerate sequence (Task 1).
2. **Concurrent draws** (several `next` calls not awaited) each get a distinct value in call order (Task 1).
3. **A config change by apply** restarts the sequence from the new seed (Task 1).

---

### Task 1: `Random`, `random` and `seededRandom`

**Files:**
- Modify:
  - `packages/ui/src/interfaces.ts`: add `Random`.
  - `packages/ui/src/provider.ts`: register the two pods.
  - `packages/ui/src/index.ts`: export `Random`, `random` and `seededRandom`, and mention them in the doc comment.
  - The ui-workspace built-ins test in `packages/ui-workspace/test/nano-host.test.ts`: its expected list gains `random`
    and `seeded-random`.
- Create: `packages/ui/src/pods/random.ts`, holding both implementations.
- Test: `packages/ui/test/random.test.ts`.

**Interfaces:**
- Produces:
  ```ts
  export const Random = ns.interface('Random', { next: Op.action(Nothing, Num) })
  export const random: Implementation        // 'nano.ui/random': Math.random
  export const seededRandom: Implementation  // 'nano.ui/seeded-random', config { seed?: integer } (default 1); mulberry32
  ```

- [ ] **Step 1: Write the failing tests.**
  - `same seed, same sequence; different seeds differ`: take five draws from seed 42 twice, then compare them with
    five draws from seed 43.
  - `a restart repeats from the start`: draw three values, `app.restart`, then draw three more. The two runs are equal.
  - `values are in [0, 1)`: check 1000 draws.
  - `seed 0 and seed -7 give varied values`: 20 draws contain at least 15 distinct values.
  - `concurrent draws are distinct, in call order`: compare `Promise.all` of five `next` calls with five sequential
    draws on a fresh pod.
  - `apply with a new seed restarts from it`.
  - `the real random returns values in [0, 1)`.
- [ ] **Step 2:** Run `cd packages/ui && bun test --isolate test/random.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run all four suites and `tsc`. Expected: PASS.
- [ ] **Step 5:** Commit with the message `feat(ui): Random — a real and a seeded random pod, a draw per message`.

### Task 2: Exact replay of seeded randomness on a simulated clock

**Files:**
- Test: `packages/ui-workspace/test/recorder/replay-random.test.ts`, which is new. It includes a small test-only
  provider for a pod `jitter`.
  - `jitter` depends on `clock: Clock` and `random: Random`.
  - In its factory it hears `fired`. On each one it draws `next`, publishes the value, and re-arms
    `after({ ms: 10 + Math.floor(r * 40) })`.
  - It starts with `after({ ms: 10 })`.
  - It is wired with call edges to `sim` (`nano.ui/sim-clock`) and `rng` (`nano.ui/seeded-random`, seed 7), and a
    pipe from its event to a `log`.
- Modify: only what the test proves is needed. Expected: nothing in `src`.

- [ ] **Step 1: Write the test** `seeded randomness on a sim clock replays exactly, fast`:
  1. `record(app, store, { clean: true })`.
  2. Run five `advance(100)` calls with `settle()` between them.
  3. The log holds the drawn values, and there is at least one.
  4. Stop recording.
  5. Replay into a second store with `pace: 'fast'`.
  6. The logs are equal, and `diverge(pair(range1), pair(range2))` is null.
- [ ] **Step 2:** Run the test. Expected: PASS if Task 1 and the clock work hold; if it fails, find and fix the cause
  in `src` with its own test.
- [ ] **Step 3:** Run the test five times, then all four suites and `tsc`.
- [ ] **Step 4:** Commit with the message `test(recorder): seeded randomness on a simulated clock replays exactly`.
