/**
 * A Raft node as plain values: the state of Figure 2 of the Raft paper, the RPCs, and what a step asks its host to do.
 * The `Node` is also what the node pod publishes as its status, so views draw straight from it.
 */
export type Role = 'follower' | 'candidate' | 'leader'
/** One log entry; `index` counts from 1, `at` is the leader's time when it took the request. */
export type LogEntry = { index: number; term: number; value: unknown; at: number }
/** What Raft keeps on stable storage (the ledger) before it answers anyone. */
export type Persistent = { currentTerm: number; votedFor: string | null; log: LogEntry[] }
/**
 * What this node knows about one peer. A leader uses `next`/`match`; a candidate uses `granted`.
 * `rpcDue`: when to (re)send an RPC; `heartbeatDue`: when a leader must send an AppendEntries even if empty.
 */
export type Peer = { next: number; match: number; granted: boolean; rpcDue: number; heartbeatDue: number }
/** `electionAlarm`: when a follower or candidate starts an election; a leader ignores it. */
export type Node = { id: string; peers: string[]; p: Persistent; role: Role; commitIndex: number; leader: string | null;
  electionAlarm: number; stopped: boolean; progress: Record<string, Peer>; timing: { electionMin: number; electionMax: number; heartbeat: number } }
export type Rpc =
  | { kind: 'vote'; term: number; lastIndex: number; lastTerm: number }
  | { kind: 'vote-reply'; term: number; granted: boolean }
  | { kind: 'append'; term: number; prevIndex: number; prevTerm: number; entries: LogEntry[]; commit: number }
  | { kind: 'append-reply'; term: number; success: boolean; match: number }
export type Input = { kind: 'tick' } | { kind: 'receive'; from: string; rpc: Rpc } | { kind: 'request'; value: unknown }
  | { kind: 'time-out' } | { kind: 'stop' } | { kind: 'resume' } | { kind: 'restart'; p: Persistent }
export type Effect = { kind: 'send'; to: string; rpc: Rpc } | { kind: 'persist'; p: Persistent }
  | { kind: 'refused'; reason: 'no leader known' | 'stopped' | 'not leader'; leader?: string }

/** One step in progress: the node being changed (a private copy) and the effects so far. */
export type Draft = { n: Node; now: number; draw: () => number; out: Effect[] }

export const lastIndex = (p: Persistent) => p.log.length
export const termAt = (p: Persistent, index: number) => index === 0 ? 0 : p.log[index - 1].term
export const lastTerm = (p: Persistent) => termAt(p, lastIndex(p))
/** A majority of the whole cluster: the peers and this node. */
export const majority = (n: Node) => Math.floor((n.peers.length + 1) / 2) + 1
/** How long to wait for an answer before asking again. */
export const retry = (n: Node) => 2 * n.timing.heartbeat
