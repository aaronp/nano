# Message recorder and replay — design

Date: 2026-11-18. First of two projects. The second is a Raft case study with a raft.github.io-style view, which builds
on this one and gets its own spec.

## Intent

Make a running nano app observable:
- **Record** every message as it travels.
- **Replay** the recording: pause, step, scrub back and forth, and change the replay speed.
- **See messages on the wire** on the Desk as dots moving along the cords, and click one to inspect it.
- **Search** the same recording in a table.

The user chose replay of a recording (option A). The app keeps running live, and only the views move back in time.
Rewinding the app itself, on a clock nano controls (raft.github.io's pause and 1/30× speed), is deferred to the Raft
project.

## Approach (user chose 1)

1. **Workspace recorder fed by core's event stream (chosen).** One small core change: `sent` carries the input. A pure
   recorder module in the workspace. One shared timeline drives the Desk overlay and a Messages table.
2. **Recording in nano-core (`app.record()`).** Rejected: it adds a new core concept that only the workspace uses today.
3. **A recorder pod.** Rejected: a pod only sees its own messages.

## Core change (approved by the user, 2026-11-18)

- **`AppEvent` `sent` gains `input?: unknown`:** the message's input, the same value core already passes to the policy as
  `Ask.data` (`application/messages.ts` `send`).
  - It is set wherever a `sent` with data is emitted.
  - `subscribe`/`unsubscribe` messages carry none.
  - Update `design.md` where `sent` is described.
- **Nothing else changes in core.** `delivered` already carries `result` and `ms`, and `denied` carries `reason`.

## Phases (user, 2026-11-18)

- **Phase 1 is headless, built first:** the core change, the record format, the store interface with a memory store, the
  recorder, and the time machine, all proved by headless tests. These are the sections from here to "Timeline and
  views".
- **Phase 2 is the views:** the timeline, the Desk overlay, the Messages table and the detail, built on phase 1.

## Store interface (user: the storage must be swappable)

- **One interface:** the recorder writes to a `MessageStore`, never to an array. Every store implements it: the in-memory
  ring (phase 1), IndexedDB, and a batching remote store (later).
- **Asynchronous from the start:**
  - `append(item)` doesn't wait for durable storage. A batching store may buffer, and `flush()` awaits what is
    buffered. `flush()` rejects when buffered writes failed.
  - `range(from?, to?, limit?)` returns the items in seq order, inclusive, at most `limit` of them counted from the
    `from` end.
  - `search(text, limit?)` matches the item's JSON text (deployment items too) and returns at most the newest `limit`
    matches, oldest first. `oldest()`, `size()` and `clear()` cover the rest.
  - Items carry a monotonically increasing sequence number `seq`, so ranges and cursors don't depend on clock
    resolution.
  - **One writer per store:** the recorder assigns seqs, so two tabs writing one store is out of scope.
- **Phase 1 ships `memoryStore({ max })`:** 10,000 by default, dropping the oldest when full.
- **A shared contract test** (`storeContract(make)`) exercises the interface: ordering, range, search, clear, the cap,
  and flush. Every future store must pass it, which is what makes storage swappable in practice.

## Time machine (user: reset and replay to rebuild state)

The system passes events and the starting state is known, so state can be rebuilt by replaying.

- **Starting state:** the recording holds the deployment at the start, and again after every `applied`, as items of
  their own (`kind: 'deployment'`).
- **Roots:** the messages nothing in the app caused, meaning `sent` with `from: 'host'`, `kind: 'call'` and no `cause`.
  Typing into the input is one of these.
  - Only roots are re-sent.
  - Everything they caused (pipes, calls, flushes) happens again by itself.
  - Re-sending the caused messages too would duplicate them.
- **`replay(app, recording, { from?, to? })`:**
  1. **Reset:** apply the deployment in force at `from` (the starting one by default) and restart every pod, so each
     gets a fresh closure.
  2. **Re-send:** send each root in the range again, through `app.runtime(runtime).call(to)` with its recorded input,
     at its original relative time.
  3. **Result:** what came back. When the store no longer holds the start of the range, replay refuses and says so,
     rather than rebuilding a wrong state.
- **Divergence check:** `diverge(recorded, replayed)` compares the messages of the two runs and reports the first one
  that differs. "Differs" means kind, from, to, port, or input or outcome as JSON text; ids and times are ignored.
- **Faithful only at the original pace (user accepted, 2026-11-18):** pods that act on their own clock (the debounce's
  timer, random numbers, the network) reproduce their behaviour only when the roots arrive at their original times.
  Faster replay becomes exact with the controlled clock in the Raft project. This design's store and roots don't change
  for it.
- **Pod-originated roots are not re-sent:** a pod's own timer or source, with no cause and not from the host, is left to
  regenerate itself.

## The recorder (workspace, pure)

- **`src/recorder/`:** `record(app, store, { clean?, now? })` listens to `app.listen`, writes to the store, and returns
  a stop function.
  - It listens first, then reads the store's last seq, holding what arrives meanwhile, so nothing is missed.
  - Its first entry is the deployment in force, marked `clean: true` only when `clean` says the app's pods hold no
    state yet (the host starts the recorder at app creation with `clean: true`). That entry is a **clean start**, the
    only point replay starts from.
- **Each recorded message** pairs its `sent` with its outcome by `id`:
  - from the `sent`: `id`, `at` (`Date.now()` when recorded, or the injected `now`; wall-clock time survives reloads,
    unlike `performance.now()`), `runtime`, `kind`, `from`, `to`, `port`, `correlation`, `cause?`, `input?`;
  - from the outcome: `{ result, ms }` when delivered, `{ denied: reason }` when denied, or nothing while it is in flight.
- **Lifecycle events** (`built`, `closed`, `restarted`, `applied`, `failure`, `warning`) are recorded too, as markers on
  the timeline. They are not messages.
- **What it offers:** the items in order, the items between two times, a text search, and a way to listen for changes.
  - Search matches pod, port, runtime, kind, and the input or result as JSON text.
- **When it starts:** with the host, so the recording covers the app from the start, including imports and applies.
- **Reset:** a **Clear** button empties the recording.

## Timeline and views

- **One timeline per page**, shared by the Desk and the Messages table. It has two modes:
  - **Live:** the cursor follows now, and new messages appear as they happen.
  - **Paused:** the cursor stays where it is. Recording continues, and the scrubber's range keeps growing.
- **Controls:**
  - play/pause (Live ↔ Paused);
  - step back and forward one message;
  - a time slider over the recording's span;
  - a replay speed (1/10×, 1/4×, 1/2×, 1×, 2×);
  - "back to live";
  - Clear.

  Playing from a paused point replays forward at the chosen speed until it catches up, then switches to Live.
- **Desk overlay:**
  - Each message near the cursor is a dot travelling along its cord, from the sender's jack to the receiver's.
  - Messages take microseconds, so each one is drawn over a fixed **visual travel time** of 600 ms at 1×, scaled by the
    replay speed, centred on its `at`.
  - The dot carries a short label of its input value, as Connections' packets do.
  - Clicking a dot pauses and selects that message.
  - **Which cord** a message travels:
    - a **pipe** message: the pipe whose wire id starts with `runtime|from|to|port|` (`port` is the target's), as
      Connections' `tracePacket` does;
    - a **call**: the call cord for `runtime|from|to`;
    - messages to or from the host, or with no drawn cord: no dot (they still appear in the table).
- **Messages table:** a third tab on the Desk page, **Connections | Desk | Messages**.
  - Columns: time, kind, from → to, port, input (short), outcome (result short, `denied: …`, or "in flight"), and ms.
  - A search box filters rows with the recorder's search.
  - The row at the cursor is highlighted, and the table keeps it in view while Live.
  - Clicking a row pauses the timeline there and selects that message.
- **Message detail:**
  - What it shows: everything recorded for the selected message (full input and result as JSON, timing, denial
    reason), and its cause chain, so a click walks to the message that caused it and to the ones it caused.
  - Where it appears: as a side panel on the Desk and Messages tabs.
  - This is the first "detail component". The shared detail drawer from the roadmap later absorbs it.

## Goals

- Every message the app sends between pods, and every host call, is recorded with its input and outcome.
- Pausing, stepping and scrubbing work on the Desk and the table together.
- Clicking a dot or a row shows that message in full.
- Search finds messages by pod, port or value.

## Non-goals

- Rewinding or pausing the app itself (simulated clock): that belongs to the Raft project.
- Saving or exporting a recording.
- Recording across page reloads.
- Connections' packets showing values. The new `input` field makes this a one-line follow-up, but it is not part of
  this work.
- The shared Filter and detail drawer from the roadmap.

## Anti-goals

- **No change to how the app runs.** Recording only listens. A slow or broken view never slows or breaks message
  delivery: `app.listen` already swallows listener errors.
- **No unbounded memory:** the 10,000-message cap.
- **No second message model.** Recorded messages are the stream's own events, paired. Cords come from the Desk's model,
  and nothing restates the deployment.

## Constraints

- **Size and exports:** source files at most 150 lines. `design.md` is updated for the `sent` change.
- **Tests:** the four suites from CLAUDE.md and `tsc`. The recorder is pure and unit-tested. The views are tested with
  happy-dom.
- **Browser check:** with the Typing example in a real browser.
- **Performance:** the Desk overlay draws only messages within the visual window around the cursor, never the whole
  recording. Search is a linear scan over at most 10,000 items, which is fine.

## Calls made by Claude (from the builder check, for the user to check)

1. **A call dot's cord:**
   - **The callee's jack:** the call cord whose callee jack matches the message's `port`.
   - **The caller's jack:** the caller's op is found as `observed-calls.ts` does, from the `cause` message. Where that
     resolves, the dot travels that op-level cord. Otherwise it goes from the caller column's side, the same fallback
     `callCords` uses.
   - The overlay needs the cord geometry, not only the SVG, so `desk/cords.ts` exposes a small geometry lookup beside
     `renderCords`.
2. **Messages with no dot:** `on`, `subscribe` and `unsubscribe` messages get no dot. They appear only in the table.
3. **Cords come from the current Desk model:**
   - A message whose pod, pipe or runtime is gone, or is hidden by the view filter, gets no dot.
   - It still appears in the table.
   - Replay doesn't redraw past deployments.
4. **Input and result are snapshotted at record time** into safe JSON text: cycles, BigInt and functions are survivable,
   and each value is capped at 64 KB with a "…truncated" marker.
   - A handler that mutates its input later can't change the record.
   - Search scans that text.
   - Memory is bounded by count × cap.
5. **Messages is its own route, `#/messages`.**
   - Its nav reads Connections | Desk | Messages, the same as the Desk page's.
   - The timeline is one module-level object both pages import, so pausing on one is paused on the other.
   - Connections is untouched.
6. **When the recording is full:**
   - A late outcome for a dropped `sent` is ignored.
   - A cursor or selection on a dropped item moves to the oldest item kept.

## Left to the builder

- File layout under `src/recorder/` and `src/desk/`, and the timeline's state shape.
- Dot styling, which reuses the Desk's pipe and call colours.
- The exact replay loop (`requestAnimationFrame`).
