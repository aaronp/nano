/** Leader election (Raft §5.2): the election alarm, RequestVote and its reply, and stepping down on a newer term. */
import { lastIndex, lastTerm, majority, retry, type Draft, type Node, type Rpc } from './types.ts'

/** A fresh election alarm: `electionMin` plus a random share of the spread, so nodes rarely time out together. */
export const alarm = (t: Node['timing'], now: number, draw: () => number) =>
  now + t.electionMin + draw() * (t.electionMax - t.electionMin)

/** A newer term seen in any RPC: adopt it, forget the vote, and follow (Figure 2, "Rules for Servers"). */
export function stepDown(d: Draft, term: number) {
  const { n } = d
  if (n.role === 'leader') n.electionAlarm = alarm(n.timing, d.now, d.draw)   // a leader's alarm was stale
  n.p = { ...n.p, currentTerm: term, votedFor: null }
  n.role = 'follower'
  n.leader = null
}

/** The alarm went off (or `time-out`): a new term, a vote for itself, and ask everyone else on the next tick. */
export function startElection(d: Draft) {
  const { n } = d
  n.p = { ...n.p, currentTerm: n.p.currentTerm + 1, votedFor: n.id }
  n.role = 'candidate'
  n.leader = null
  n.electionAlarm = alarm(n.timing, d.now, d.draw)
  for (const peer of Object.values(n.progress)) Object.assign(peer, { granted: false, rpcDue: 0 })
}

/** A candidate sends RequestVote to each peer it is due to ask. */
export function askForVotes(d: Draft) {
  const { n } = d
  for (const to of n.peers) {
    const peer = n.progress[to]
    if (peer.rpcDue > d.now) continue
    peer.rpcDue = d.now + retry(n)
    d.out.push({ kind: 'send', to, rpc: { kind: 'vote', term: n.p.currentTerm, lastIndex: lastIndex(n.p), lastTerm: lastTerm(n.p) } })
  }
}

/** RequestVote: grant at most one vote per term, and only to a candidate whose log is at least as up to date. */
export function onVote(d: Draft, from: string, rpc: Extract<Rpc, { kind: 'vote' }>) {
  const { n } = d
  const upToDate = rpc.lastTerm > lastTerm(n.p) || (rpc.lastTerm === lastTerm(n.p) && rpc.lastIndex >= lastIndex(n.p))
  const granted = rpc.term === n.p.currentTerm && (n.p.votedFor ?? from) === from && upToDate
  if (granted) {
    if (n.p.votedFor !== from) n.p = { ...n.p, votedFor: from }
    n.electionAlarm = alarm(n.timing, d.now, d.draw)
  }
  d.out.push({ kind: 'send', to: from, rpc: { kind: 'vote-reply', term: n.p.currentTerm, granted } })
}

/** A vote reply in this term: note it, and lead once a majority (counting itself) has granted. */
export function onVoteReply(d: Draft, from: string, rpc: Extract<Rpc, { kind: 'vote-reply' }>) {
  const { n } = d
  if (n.role !== 'candidate' || rpc.term !== n.p.currentTerm) return
  const peer = n.progress[from]
  peer.granted = rpc.granted
  peer.rpcDue = n.electionAlarm   // answered: don't ask again this term
  if (1 + n.peers.filter(x => n.progress[x].granted).length >= majority(n)) becomeLeader(d)
}

/** A new leader assumes every follower is up to date, and sends heartbeats on the next tick. */
function becomeLeader(d: Draft) {
  const { n } = d
  n.role = 'leader'
  n.leader = n.id
  for (const peer of Object.values(n.progress)) Object.assign(peer, { next: lastIndex(n.p) + 1, match: 0, rpcDue: 0, heartbeatDue: 0 })
}
