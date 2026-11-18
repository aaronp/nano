/**
 * The time machine: a cursor (a time, in the recording's `at` ms) over a recording, emitting a frame of what's in flight
 * there on every change. Live follows the newest entry; playing moves at speed × real time, skipping idle gaps; paused
 * stays put while recording goes on.
 *
 *   const tm = await timeMachine({ store, listen })   // listen: from record()
 *   tm.subscribe(f => draw(f.inFlight)); tm.seek(t); tm.play()
 */
import type { Entry, Message, MessageStore } from './entry.ts'

export type Frame = { t: number; inFlight: { message: Message; progress: number }[]; recent: Message[]; at?: Message }
/** `frame(fn)` runs `fn` once, at the next frame, and returns its cancel. */
export type Ticker = { now(): number; frame(fn: () => void): () => void }
export interface TimeMachine {
  readonly cursor: number; readonly mode: 'live' | 'paused' | 'playing'; readonly speed: number; readonly span: { from: number; to: number }
  seek(t: number): void; step(dir: 1 | -1): void; play(): void; pause(): void; live(): void; setSpeed(s: number): void
  subscribe(fn: (f: Frame) => void): () => void; close(): void
}

const IDLE = 1000
const raf: Ticker = { now: () => performance.now(), frame: fn => { const id = requestAnimationFrame(fn); return () => cancelAnimationFrame(id) } }

/**
 * Catches up with `store.range()` and then hears `listen`, missing nothing. A message's window is
 * `[at, at + travelMs / speed]` (`travelMs` 600); `recent` keeps the last `recent` (200) messages with `at ≤ t`.
 * Messages are ordered by `at`, ties by seq; a step moves to the next or previous one.
 */
export async function timeMachine(
  source: { store: MessageStore; listen: (fn: (e: Entry) => void) => () => void },
  opts: { ticker?: Ticker; recent?: number; travelMs?: number } = {},
): Promise<TimeMachine> {
  const ticker = opts.ticker ?? raf, keep = opts.recent ?? 200, travelMs = opts.travelMs ?? 600
  const msgs: Message[] = []
  const byId = new Map<string, Message>()
  const span = { from: 0, to: 0 }
  let empty = true, lastSeq = 0
  let mode: TimeMachine['mode'] = 'live', speed = 1, cursor = 0
  let pinned: number | undefined   // the message a step landed on, among those sharing its at
  let cancel: (() => void) | undefined, last = 0
  const subs = new Set<(f: Frame) => void>()

  /** How many messages have `at ≤ t`. */
  const upTo = (t: number) => { let lo = 0, hi = msgs.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (msgs[mid]!.at <= t) lo = mid + 1; else hi = mid } return lo }
  const travel = () => travelMs / speed
  const inFlightAt = (t: number) => {
    const out: Frame['inFlight'] = []
    for (let i = upTo(t) - 1; i >= 0 && msgs[i]!.at >= t - travel(); i--) out.unshift({ message: msgs[i]!, progress: (t - msgs[i]!.at) / travel() })
    return out
  }
  const frame = (): Frame => {
    const end = pinned !== undefined ? pinned + 1 : upTo(cursor)
    return { t: cursor, inFlight: inFlightAt(cursor), recent: msgs.slice(Math.max(0, end - keep), end), ...(end ? { at: msgs[end - 1] } : {}) }
  }
  const emit = () => { const f = frame(); for (const fn of subs) try { fn(f) } catch { /* a subscriber never breaks the cursor */ } }

  const add = (e: Entry) => {
    if (e.seq <= lastSeq) return
    lastSeq = e.seq
    if (empty) { span.from = e.at; empty = false }
    span.to = Math.max(span.to, e.at)
    const ev = e.event
    if (ev.type === 'sent') {
      const m: Message = { seq: e.seq, at: e.at, sent: ev }
      byId.set(ev.id, m)
      msgs.splice(upTo(e.at), 0, m)   // after every message with at ≤ its at: their seqs are lower
    } else if (ev.type === 'delivered' || ev.type === 'denied') { const m = byId.get(ev.id); if (m) m.outcome = ev }
  }
  const stopTicking = () => { cancel?.(); cancel = undefined }
  const goLive = () => { stopTicking(); mode = 'live'; pinned = undefined; cursor = span.to; emit() }

  const tick = () => {
    cancel = undefined
    const now = ticker.now()
    let c = cursor + (now - last) * speed
    last = now
    const target = msgs[upTo(cursor)]?.at ?? span.to   // the next message, or the newest entry
    if (inFlightAt(c).length === 0 && target - c > IDLE) c = target
    if (c >= span.to) return goLive()
    cursor = c; pinned = undefined
    emit()
    cancel = ticker.frame(tick)
  }

  // Subscribe first, hold what arrives while range() is read, then add both; seqs de-dupe.
  let held: Entry[] | undefined = []
  const unlisten = source.listen(e => {
    if (held) { held.push(e); return }
    add(e)
    if (mode === 'live') { cursor = span.to; emit() }
  })
  try { for (const e of await source.store.range()) add(e) } catch (err) { unlisten(); throw err }
  for (const e of held) add(e)
  held = undefined
  cursor = span.to

  return {
    get cursor() { return cursor }, get mode() { return mode }, get speed() { return speed }, get span() { return { ...span } },
    seek(t) { stopTicking(); mode = 'paused'; pinned = undefined; cursor = t; emit() },
    step(dir) {
      stopTicking(); mode = 'paused'
      const i = (pinned ?? upTo(cursor) - 1) + dir
      if (i >= 0 && i < msgs.length) { pinned = i; cursor = msgs[i]!.at }
      emit()
    },
    play() {
      if (mode === 'playing') return
      if (cursor >= span.to) return goLive()
      mode = 'playing'; last = ticker.now(); cancel = ticker.frame(tick)
    },
    pause() { stopTicking(); mode = 'paused'; emit() },
    live: goLive,
    setSpeed(s) { speed = s; emit() },
    subscribe(fn) { subs.add(fn); return () => { subs.delete(fn) } },
    close() { stopTicking(); unlisten(); subs.clear() },
  }
}
