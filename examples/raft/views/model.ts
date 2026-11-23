/**
 * What the Raft views draw, as pure functions of a node's status and the clock's `now` (sim ms): the glyph, the
 * detail panel and the ledger table. The elements render these and call ops; no logic lives in them.
 */
import type { Node, Persistent, Role } from '../core/types.ts'

type Peers = 'pending' | 'granted' | 'idle'
const signed = (t: number, now: number) => { const d = t - now; return `${d >= 0 ? '+' : '-'}${Math.abs(d).toFixed(1)} ms` }

/**
 * A peer's dot. `granted` is the vote. `pending` is an RPC in flight, read from the core's `rpcDue`: a send sets it
 * to `now + retry` (in the future) and an answer clears it (leader: 0) or parks it at `electionAlarm` (candidate,
 * "answered: don't ask again this term"). So pending = not granted, `rpcDue` still ahead, and not parked at the alarm.
 * Followers send nothing; the glyph of a stopped node shows no pending dots.
 */
function dot(s: Node, id: string, now: number): Peers {
  const p = s.progress[id]!
  if (s.role === 'candidate' && p.granted) return 'granted'
  const sent = p.rpcDue > now && !(s.role === 'candidate' && p.rpcDue === s.electionAlarm)
  return s.role !== 'follower' && !s.stopped && sent ? 'pending' : 'idle'
}

/** `arc`: the election time left, 1 at a fresh timeout (`electionMax`) down to 0 at the alarm; a leader has none. */
export function glyphModel(s: Node, now: number): { term: number; role: Role; stopped: boolean; arc: number; peers: { id: string; state: Peers }[] } {
  const left = s.role === 'leader' ? 0 : (s.electionAlarm - now) / s.timing.electionMax
  return { term: s.p.currentTerm, role: s.role, stopped: s.stopped, arc: Math.min(1, Math.max(0, left)),
    peers: s.peers.map(id => ({ id, state: dot(s, id, now) })) }
}

/** The detail panel: the node's fields, then one row per peer; times are signed ms from `now`, one decimal. */
export function detailModel(s: Node, now: number): { rows: [string, string][]; peers: { peer: string; next: number; match: number; granted: boolean; rpcDue: string; heartbeatDue: string }[] } {
  return {
    rows: [['state', s.stopped ? 'stopped' : s.role], ['currentTerm', String(s.p.currentTerm)], ['votedFor', s.p.votedFor ?? '—'],
      ['commitIndex', String(s.commitIndex)], ['election alarm', signed(s.electionAlarm, now)]],
    peers: s.peers.map(peer => { const p = s.progress[peer]!
      return { peer, next: p.next, match: p.match, granted: p.granted, rpcDue: signed(p.rpcDue, now), heartbeatDue: signed(p.heartbeatDue, now) } }),
  }
}

/** The ledger view: currentTerm and votedFor, then a row per log entry, committed once its index is at or below `commitIndex`. */
export const ledgerModel = (p: Persistent, commitIndex: number) => ({ currentTerm: p.currentTerm, votedFor: p.votedFor, rows: p.log.map(e => ({
  index: e.index, term: e.term, value: typeof e.value === 'string' ? e.value : JSON.stringify(e.value), at: e.at.toFixed(1), committed: e.index <= commitIndex,
})) })

/** The log grid: a row per node, a column per log index (at least 10); a cell is its entry's term and whether it is committed, or null. */
export function gridModel(rows: { id: string; p: Persistent; commitIndex: number }[]): { columns: number; rows: { id: string; cells: ({ term: number; committed: boolean } | null)[] }[] } {
  const columns = Math.max(10, ...rows.map(r => r.p.log.length))
  return { columns, rows: rows.map(r => ({ id: r.id, cells: Array.from({ length: columns }, (_, i) => { const e = r.p.log[i]; return e ? { term: e.term, committed: e.index <= r.commitIndex } : null }) })) }
}

/**
 * The sim clock's pace as a view sees it, from each `fired` (its sim `at`, the real `wall` ms it arrived): `rate` sim ms
 * per real ms, measured over windows of at least 500 real ms (1 until the first); a gap over 2 s (a pause) starts a new
 * window and keeps the rate. A view's guess of now is `sim + (wall now - wall) * rate`, put right by the next `fired`.
 */
export function paced(p: { sim: number; wall: number; rate: number; from: { sim: number; wall: number } } | undefined, sim: number, wall: number) {
  if (!p || wall - p.wall > 2000) return { sim, wall, rate: p?.rate ?? 1, from: { sim, wall } }
  const span = wall - p.from.wall, ok = span >= 500 && sim >= p.from.sim
  return { sim, wall, rate: ok ? (sim - p.from.sim) / span : p.rate, from: ok ? { sim, wall } : p.from }
}
