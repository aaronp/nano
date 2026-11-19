# Message Recorder (headless) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record a running nano app's messages into a swappable store, and rebuild its state by resetting and re-sending
the root messages at their original pace. A divergence check proves the replay matched.

**Architecture:**
- **Core:** `sent` carries its input. That is the only change in nano-core.
- **Workspace (`packages/ui-workspace/src/recorder/`):**
  - an **append-only log** of entries (each AppEvent snapshotted, plus deployment entries), written to an async
    `MessageStore`;
  - **pure readers** that pair messages and pick out the roots;
  - **`replay`**, which applies the starting deployment, restarts every pod, and re-sends the roots at their recorded
    offsets.

  Append-only is deliberate: IndexedDB and batching remote stores only ever append.

**Tech Stack:** TypeScript, bun test (`--isolate`), nano-core, nano-ui (for the Typing example in tests).

**Spec:** `docs/superpowers/specs/2026-11-18-message-recorder-design.md`. Phase 1 is these sections: "Core change",
"Store interface", "Time machine", "The recorder", and the record-format parts of "Calls made by Claude" (4, 6). Views
are phase 2, not this plan. So is starting the recorder with the host: nothing reads a recording until the views exist.

## Global Constraints

- **Size and exports:**
  - Source files may not pass 150 lines.
  - nano-core gains no export. Its `sent` event gains an optional `input`, and `design.md` says so where `sent` is
    described.
- **Tests:**
  - `cd packages/nano && bun test --isolate`
  - `cd packages/ui-workspace && bun test --isolate`
  - `cd packages/ui && bun test --isolate`
  - `cd examples && bun test --isolate`
  - `bunx tsc --noEmit` at the root
- **Commits:** on `dev`, one per task, each ending with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Values in entries** are snapshotted as safe JSON text at record time:
  - cycles become `"[cycle]"`, a BigInt becomes `"123n"`, and functions become `"[function]"`;
  - each value is capped at 65536 characters, with a `…truncated` suffix past the cap.
- **`memoryStore` default `max`:** 10000 entries.
- **Roots:** `sent` with `from === 'host'`, `kind === 'call'` and no `cause`.

## Review Focus

1. **A root whose input was truncated (over 64 KB) can't be re-sent faithfully.** `replay` must refuse with a clear
   reason rather than send the cut text (Task 4).
2. **The store has dropped the start of the range.** `replay` refuses with `not-found` and says the recording no longer
   holds it (Task 4).
3. **An `apply` mid-recording.** Replay from after it uses the later deployment, not the first one (Task 4).
4. **Undefined and odd values.** An `input` of `undefined`, a value containing a function, a cycle or a BigInt, each
   snapshotted without throwing (Task 2).
5. **Outcomes after their `sent` was dropped,** and denied messages. Pairing never throws and leaves no half-paired
   message (Task 2).

---

### Task 1: Core: `sent` carries its input

**Files:**
- Modify:
  - `packages/nano/src/application/stream.ts:20`: add `input?: unknown` to the `sent` variant.
  - `packages/nano/src/application/messages.ts:115`: emit `input`.
  - `design.md`: in the Watch list or the `AppEvent` description, note that `sent` carries `input` for call, pipe and
    `on` messages.
  - `packages/nano/src/application/connection.ts:15` is unchanged: subscribe and unsubscribe carry none.
- Test: `packages/nano/test/sent-input.test.ts` (new).

**Interfaces:**
- Produces: `Extract<AppEvent, { type: 'sent' }>['input']`, the message's input as given to the handler.

- [ ] **Step 1: Write the failing tests** with a two-pod app (any test fixture in `packages/nano/test`, for example the
  one in `pods-runtimes.test.ts`):
  - `a host call's sent carries its input`: `app.call(rt, pod).op({ a: 1 })` gives a `sent` whose `input` equals
    `{ a: 1 }`.
  - `a pipe's sent carries the piped value`: the `sent` of kind `pipe` has `input` equal to the published value.
  - `a subscribe's sent carries no input`: `'input' in e` is false.
- [ ] **Step 2:** Run `cd packages/nano && bun test --isolate test/sent-input.test.ts`. Expected: FAIL, because `input`
  is undefined.
- [ ] **Step 3:** Implement. Add `...(input !== undefined && { input })` beside `cause` in `send`.
- [ ] **Step 4:** Run the nano suite (expect all to pass, including `structure.test.ts`), then `bunx tsc --noEmit`.
- [ ] **Step 5:** Commit `feat(core): a sent event carries its input`.

### Task 2: Entries, snapshots, pairing, and the store interface with a memory store

**Files:**
- Create:
  - `packages/ui-workspace/src/recorder/entry.ts`: the types, `snap` and `pair`.
  - `packages/ui-workspace/src/recorder/memory-store.ts`.
- Test:
  - `packages/ui-workspace/test/recorder/store-contract.ts`: the shared contract, a function and not a test file.
  - `packages/ui-workspace/test/recorder/memory-store.test.ts`.
  - `packages/ui-workspace/test/recorder/entry.test.ts`.

**Interfaces:**
- Produces:
  ```ts
  /** A recorded thing: an app event (values snapshotted as JSON text), or the deployment in force from here on. */
  export type Recorded =
    | (Exclude<AppEvent, { type: 'sent' | 'delivered' }>)
    | (Omit<Extract<AppEvent, { type: 'sent' }>, 'input'> & { input?: string })
    | { type: 'delivered'; id: string; ok: boolean; result: string; ms: number }   // result: the value, or the Fail, as JSON text
    | { type: 'deployment'; deployment: AppDeployment }
  export type Entry = { seq: number; at: number; event: Recorded }   // at: performance.now() when recorded
  export const CAP = 65536
  export function snap(v: unknown): string                           // safe JSON text, capped (Global Constraints)
  export function truncated(text: string): boolean                    // ends with the …truncated marker
  /** A message: its sent, and its outcome once known. */
  export type Message = { seq: number; at: number; sent: Extract<Recorded, { type: 'sent' }>; outcome?: Extract<Recorded, { type: 'delivered' }> | Extract<Recorded, { type: 'denied' }> }
  export function pair(entries: Entry[]): Message[]                  // in sent order; an outcome without its sent is skipped
  export interface MessageStore {
    append(e: Entry): void                 // not awaited; a batching store buffers
    flush(): Promise<void>                 // what is buffered is stored
    range(from?: number, to?: number): Promise<Entry[]>   // by seq, inclusive, in seq order
    search(text: string, limit?: number): Promise<Entry[]> // case-insensitive over the entry's JSON text; newest last
    oldest(): Promise<number | undefined>  // the smallest seq still held
    size(): Promise<number>
    clear(): Promise<void>
  }
  export function memoryStore(opts?: { max?: number }): MessageStore   // max 10000; drops the oldest when full
  export function storeContract(make: (max: number) => MessageStore): void   // registers bun tests; in test/recorder/store-contract.ts
  ```

- [ ] **Step 1: Write the failing tests.**
  - **`storeContract(make)`** registers these:
    - `appends come back in seq order from range`;
    - `range(3, 5) is inclusive`;
    - `search finds by pod name and by value text, case-insensitively`;
    - `when full, the oldest is dropped and oldest() moves on` (`make(3)`, append 5 → `oldest()` is 3 and `size()` is 3);
    - `clear empties it`;
    - `flush resolves`.
  - **`memory-store.test.ts`** calls `storeContract(max => memoryStore({ max }))`.
  - **`entry.test.ts`** checks:
    - `snap` of `undefined`, `{ f() {} }`, a cyclic object and `10n`: each returns a string without throwing, giving
      `'undefined'`, `'{"f":"[function]"}'`, a string containing `[cycle]`, and `'"10n"'`;
    - `snap` of a 70000-character string gives a string of length at most `CAP + 12`, and `truncated` is true;
    - `pair` pairs a sent with its delivered, keeps one in flight as having no outcome, keeps a denied one, and skips
      a delivered whose sent isn't there.
- [ ] **Step 2:** Run `cd packages/ui-workspace && bun test --isolate test/recorder`. Expected: FAIL, because the
  modules are missing.
- [ ] **Step 3:** Implement `entry.ts` and `memory-store.ts`. The memory store is an array, and `search` matches
  `JSON.stringify(entry.event)`.
- [ ] **Step 4:** Run the workspace suite and `tsc`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(recorder): entries with snapshotted values, pairing, and a swappable async store (memory first, a contract for the rest)`.

### Task 3: The recorder

**Files:**
- Create: `packages/ui-workspace/src/recorder/record.ts`.
- Test: `packages/ui-workspace/test/recorder/record.test.ts`.

**Interfaces:**
- Consumes: Task 2's `Entry`, `snap` and `MessageStore`. Uses `app.listen` and `app.deployment()`.
- Produces:
  ```ts
  /**
   * Records `app` into `store` from now: first a deployment entry (the app's current deployment), then every event,
   * snapshotted, with another deployment entry after each `applied`. seq starts after the store's last entry.
   */
  export function record(app: Application, store: MessageStore, now?: () => number): Promise<() => void>   // resolves to stop
  ```

- [ ] **Step 1: Write the failing tests.** Use the Typing example (`examples/typing/nano.json`, assembled with
  `nano.ui`) with the debounce quickened to `{ quietMs: 20, maxWaitMs: 200 }`, as in `examples/typing/typing.test.ts`.
  - `the first entry is the deployment in force`: `range()[0].event.type === 'deployment'`.
  - `typing h then hi records two root sends with their input, and the flush they caused`: `pair` gives host→input
    `change` messages with `input` `'"h"'` and `'"hi"'`, and a `pipe` from `debounce` whose `cause` chain leads back
    to them; all are delivered.
  - `an apply adds a deployment entry after the applied event`.
  - `after stop, nothing more is recorded`.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement. The listener must never throw into the app; catch and ignore.
- [ ] **Step 4:** Run the workspace suite and `tsc`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(recorder): record an app into a store — its deployment, then every event, snapshotted`.

### Task 4: The time machine: roots, replay, divergence

**Files:**
- Create: `packages/ui-workspace/src/recorder/replay.ts`.
- Test: `packages/ui-workspace/test/recorder/replay.test.ts`.

**Interfaces:**
- Consumes: Tasks 2 and 3.
- Produces:
  ```ts
  export function roots(messages: Message[]): Message[]   // sent.from === 'host', kind 'call', no cause
  /** Resets `app` to the deployment in force at `from` and re-sends the roots in [from, to] at their recorded offsets. */
  export function replay(app: Application, store: MessageStore, opts?: { from?: number; to?: number; sleep?: (ms: number) => Promise<void> }): Promise<NanoResult<{ sent: number }>>
  /** The first message that differs between two runs (kind, from, to, port, input, outcome ok and result; ids, times and causes ignored), or null. */
  export function diverge(recorded: Message[], replayed: Message[]): { index: number; recorded?: Message; replayed?: Message } | null
  ```
- **Replay steps:**
  1. Find the latest deployment entry with `seq` at or before `from`, where `from` defaults to `oldest()`.
     - **None held, or `oldest() > from`:** `failure('not-found', 'the recording no longer holds the start of that range')`.
  2. Apply that deployment, then `restart` every pod in it.
  3. For each root in range, wait until `root.at - firstRoot.at` has passed since the first root was re-sent, then call
     `app.runtime(sent.runtime).call(sent.to)[opName](JSON.parse(sent.input))`. `opName` is the last `/` segment of
     `sent.port`.
     - **A root whose input was truncated:** `failure('invalid-input', 'message <seq>: its input was truncated when recorded')`, before anything is sent.
  4. Return `success({ sent: n })`.
- **`sleep`** defaults to `setTimeout`. Tests pass the real one: original pace is the point.

- [ ] **Step 1: Write the failing tests** (Typing example, quick config as in Task 3).
  - **`replaying a recording rebuilds the log and the same messages come out`:**
    1. Record. Type `h`, `hi`, wait 60 ms, type `hey`, wait 60 ms.
    2. The log entries are `['HI', 'HEY']`.
    3. Stop.
    4. Record a second store, `replay(app, first)`, and wait 80 ms.
    5. The log entries are `['HI', 'HEY']` again: restarted, then rebuilt, not doubled.
    6. `diverge(pair(first), pair(second))` is null, comparing message entries only. Deployment and lifecycle entries
       are ignored by `pair`.
  - **`replay too fast diverges, and diverge says where`:**
    1. Replay with `sleep: async () => {}`.
    2. `diverge` is not null.
    3. Its `recorded` is the first `pipe` from `debounce` (the HI flush), because when every root arrives at once the
       debounce batches differently.
  - **`replay refuses when the store dropped the start`:** a `memoryStore({ max: 3 })` recording of the run gives
    `replay` an `ok: false` result with `type` `'not-found'`.
  - **`replay from after an apply uses the later deployment`:**
    1. Record, apply a deployment whose map code is `return x + "!"`, then type `a`.
    2. Replay from the second deployment entry's `seq`.
    3. The log shows `a!`.
  - **`a truncated root input is refused`:** append a root whose input text is `truncated` to a store, then `replay` it
    (`ok: false`, `type` `'invalid-input'`).
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement `replay.ts`.
- [ ] **Step 4:** Run all four suites and `tsc`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(recorder): a time machine — reset to the recorded deployment, re-send the roots at their pace, and say where a replay diverged`.
