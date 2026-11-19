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
