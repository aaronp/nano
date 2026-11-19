# Seeded randomness as a capability — short design

Date: 2026-11-18. It follows the clock capability (`2026-11-18-clock-capability-design.md`) and has the same shape. The
user approved it in conversation.

## Intent

Randomness, like time, must be under nano's control so recordings replay exactly. Raft's election timeouts are the
first user.

## Approach

- **A capability pod.** A pod that needs randomness declares an optional `random: Random` dependency.
  - Every draw is a message, so it is recorded, shown on the wire and replayed.
  - No nano-core change.
- **Rejected: `ctx.random` in core.** It is a new core concept, and its draws wouldn't be messages.

## Design

- **Interface:** `Random { next: action(Nothing, Num) }` returns a float in [0, 1). Pods scale it themselves. More ops
  wait until a pod needs them.
- **Two implementations:**
  - **`nano.ui/random`:** uses `Math.random`, for live apps.
  - **`nano.ui/seeded-random`:** config `{ seed?: integer }`, default 1, using mulberry32.
    - The same seed gives the same sequence.
    - A restart resets it to the seed, which is what replay's clean reset needs.
    - To reseed, apply a new config.
- **Order:** draws are answered in arrival order. On a simulated clock that order is reproduced, so each pod's sequence
  is the same on every replay.
- **Pods using randomness:** a pod with no random wired uses `Math.random`. A pod with one wired never calls
  `Math.random`.
- **Exports:** nano.ui's exports grow by `Random`, `random` and `seededRandom`.
- **Consumers:** none in this step. Raft is the first.

## Tests

- The same seed gives the same sequence, and different seeds differ.
- A restart repeats the sequence from the start.
- Every value is in [0, 1).
- Exact replay:
  1. Use a small test pod that, on each sim-clock `fired`, draws and logs.
  2. Record it.
  3. Replay it with `pace: 'fast'`.
  4. `diverge` is null.

## Constraints

- Files at most 150 lines.
- The four suites and `tsc` pass.
