/** Log replication (Raft §5.3–5.4): AppendEntries, its consistency check, and the commit index. */
import { alarm } from './election.ts'
import { lastIndex, majority, retry, termAt, type Draft, type LogEntry, type Rpc } from './types.ts'

/**
 * A leader sends AppendEntries to each peer that is behind (and not waiting on an answer) or due a heartbeat.
 * ponytail: sends everything from `next` in one batch; cap the batch if logs grow long.
 */
export function replicate(d: Draft) {
  const { n } = d
  for (const to of n.peers) {
    const peer = n.progress[to]
    const behind = peer.next <= lastIndex(n.p) && peer.rpcDue <= d.now
    if (!behind && peer.heartbeatDue > d.now) continue
    const prevIndex = peer.next - 1
    d.out.push({ kind: 'send', to, rpc: { kind: 'append', term: n.p.currentTerm, prevIndex, prevTerm: termAt(n.p, prevIndex),
      entries: n.p.log.slice(prevIndex), commit: n.commitIndex } })
    peer.rpcDue = d.now + retry(n)
    peer.heartbeatDue = d.now + n.timing.heartbeat
  }
}

/** AppendEntries: follow the sender, check the entry before the new ones matches, then take them. */
export function onAppend(d: Draft, from: string, rpc: Extract<Rpc, { kind: 'append' }>) {
  const { n } = d
  const reply = (success: boolean, match: number) =>
    d.out.push({ kind: 'send', to: from, rpc: { kind: 'append-reply', term: n.p.currentTerm, success, match } })
  if (rpc.term < n.p.currentTerm) return reply(false, 0)
  n.role = 'follower'
  n.leader = from
  n.electionAlarm = alarm(n.timing, d.now, d.draw)
  if (rpc.prevIndex > lastIndex(n.p) || termAt(n.p, rpc.prevIndex) !== rpc.prevTerm) return reply(false, 0)
  const log = merge(n.p.log, rpc.entries)
  if (log !== n.p.log) n.p = { ...n.p, log }
  const match = rpc.prevIndex + rpc.entries.length
  n.commitIndex = Math.max(n.commitIndex, Math.min(rpc.commit, match))
  reply(true, match)
}

/** Figure 2, AppendEntries steps 3–4: an entry that conflicts drops it and all after it; new entries are added. */
function merge(log: LogEntry[], entries: LogEntry[]) {
  for (const e of entries) if (log[e.index - 1]?.term !== e.term) log = [...log.slice(0, e.index - 1), e]
  return log
}

/** The leader learns how far a follower's log matches; on a mismatch it backs up one entry and tries again. */
export function onAppendReply(d: Draft, from: string, rpc: Extract<Rpc, { kind: 'append-reply' }>) {
  const { n } = d
  if (n.role !== 'leader' || rpc.term !== n.p.currentTerm) return
  const peer = n.progress[from]
  if (rpc.success) {
    peer.match = Math.max(peer.match, rpc.match)
    peer.next = peer.match + 1
  } else peer.next = Math.max(1, peer.next - 1)
  peer.rpcDue = 0
  advanceCommit(d)
}

/** Commit the highest entry a majority holds, but only by counting an entry from this term (the paper's Figure 8). */
function advanceCommit(d: Draft) {
  const { n } = d
  for (let i = lastIndex(n.p); i > n.commitIndex && termAt(n.p, i) === n.p.currentTerm; i--) {
    if (1 + n.peers.filter(x => n.progress[x].match >= i).length >= majority(n)) return void (n.commitIndex = i)
  }
}
