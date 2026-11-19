/**
 * One Raft node as a pure function: `step(node, input, now, draw)` gives the next node and the effects for its host
 * to perform. `now` is the only time and `draw` (in [0, 1)) the only randomness, so a run replays exactly.
 */
import { alarm, askForVotes, onVote, onVoteReply, startElection, stepDown } from './election.ts'
import { onAppend, onAppendReply, replicate } from './replication.ts'
import { lastIndex, type Draft, type Effect, type Input, type Node, type Persistent, type Rpc } from './types.ts'

const timing: Node['timing'] = { electionMin: 150, electionMax: 300, heartbeat: 50 }

/** A follower that knows no leader, with its election alarm armed. */
export function initial(id: string, peers: string[], p: Persistent, now: number, draw: () => number, t = timing): Node {
  return { id, peers, p, role: 'follower', commitIndex: 0, leader: null, electionAlarm: alarm(t, now, draw), stopped: false,
    progress: Object.fromEntries(peers.map(x => [x, { next: 1, match: 0, granted: false, rpcDue: 0, heartbeatDue: 0 }])), timing: t }
}

export function step(node: Node, input: Input, now: number, draw: () => number): { node: Node; effects: Effect[] } {
  // The draft is a private copy, so the code below may change it in place; `p` itself is only ever replaced.
  const progress = Object.fromEntries(Object.entries(node.progress).map(([id, peer]) => [id, { ...peer }]))
  const d: Draft = { n: { ...node, progress }, now, draw, out: [] }
  act(d, input)
  // Raft makes term, vote and log durable before it answers anyone: the persist goes ahead of every send.
  if (d.n.p !== (input.kind === 'restart' ? input.p : node.p)) d.out.unshift({ kind: 'persist', p: d.n.p })
  return { node: d.n, effects: d.out }
}

function act(d: Draft, input: Input) {
  const { n } = d
  if (n.stopped) {   // a stopped node ignores everything until `resume`, and turns requests away
    if (input.kind === 'resume') n.stopped = false
    if (input.kind === 'request') d.out.push({ kind: 'refused', reason: 'stopped' })
    return
  }
  switch (input.kind) {
    case 'tick': return tick(d)
    case 'time-out': return startElection(d)
    case 'stop': n.stopped = true; return
    case 'resume': return
    case 'restart': d.n = initial(n.id, n.peers, input.p, d.now, d.draw, n.timing); return
    case 'request': return request(d, input.value)
    case 'receive': return receive(d, input.from, input.rpc)
  }
}

/** Due work: the election alarm, then whatever RPCs (votes, appends, heartbeats) are due. */
function tick(d: Draft) {
  if (d.n.role !== 'leader' && d.now >= d.n.electionAlarm) startElection(d)
  if (d.n.role === 'candidate') askForVotes(d)
  if (d.n.role === 'leader') replicate(d)
}

/** A leader appends the value and replicates it on the next tick; anyone else refuses, naming the leader if known. */
function request(d: Draft, value: unknown) {
  const { n } = d
  if (n.role === 'leader') {
    n.p = { ...n.p, log: [...n.p.log, { index: lastIndex(n.p) + 1, term: n.p.currentTerm, value, at: d.now }] }
  } else if (n.leader) d.out.push({ kind: 'refused', reason: 'not leader', leader: n.leader })
  else d.out.push({ kind: 'refused', reason: 'no leader known' })
}

function receive(d: Draft, from: string, rpc: Rpc) {
  if (rpc.term > d.n.p.currentTerm) stepDown(d, rpc.term)
  switch (rpc.kind) {
    case 'vote': return onVote(d, from, rpc)
    case 'vote-reply': return onVoteReply(d, from, rpc)
    case 'append': return onAppend(d, from, rpc)
    case 'append-reply': return onAppendReply(d, from, rpc)
  }
}
