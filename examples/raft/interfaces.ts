/**
 * The Raft example's contracts, in `example.raft`: the shared messaging every node talks through, a node, its ledger
 * (Raft's stable storage) and the cluster that deploys nodes through the host. Each node runs in its own runtime, and
 * its id is that runtime's name.
 *
 *   ctx.one(Messaging)          // a node's: send({ to: 'example-2', message: { kind: 'vote', …, from: 'example-1' } })
 *   app.call('example-1', 'example-1-raft').request('x')   // a leader takes it; anyone else is invalid-input
 */
import { Type, type TSchema } from 'typebox'
import { Coord, Schema, Op } from '@pritzlaff/nano-core'
import { Any, Nothing } from '@pritzlaff/nano-ui'

const ns = Coord.namespace('example.raft')
const Int = Type.Integer({ minimum: 0 })

const LogEntry = Type.Object({ index: Int, term: Int, value: Type.Unknown(), at: Type.Number() })
const Persistent = Schema.define(Type.Object({
  currentTerm: Int, votedFor: Type.Union([Type.String(), Type.Null()]), log: Type.Array(LogEntry),
}), 'Persistent')
/** An RPC with who sent it (the core's `Rpc & { from }`). */
const rpc = <K extends string, F extends Record<string, TSchema>>(kind: K, fields: F) =>
  Type.Object({ kind: Type.Literal(kind), term: Int, from: Type.String(), ...fields })
const Message = Schema.define(Type.Union([
  rpc('vote', { lastIndex: Int, lastTerm: Int }),
  rpc('vote-reply', { granted: Type.Boolean() }),
  rpc('append', { prevIndex: Int, prevTerm: Int, entries: Type.Array(LogEntry), commit: Int }),
  rpc('append-reply', { success: Type.Boolean(), match: Int }),
]), 'RaftMessage')
const Envelope = Schema.define(Type.Object({ to: Type.String(), message: Message }), 'Envelope')

const Peer = Type.Object({ next: Int, match: Int, granted: Type.Boolean(), rpcDue: Type.Number(), heartbeatDue: Type.Number() })
/** The core's `Node`, as the node publishes it. */
const NodeStatus = Schema.define(Type.Object({
  id: Type.String(), peers: Type.Array(Type.String()), p: Persistent,
  role: Type.Union([Type.Literal('follower'), Type.Literal('candidate'), Type.Literal('leader')]),
  commitIndex: Int, leader: Type.Union([Type.String(), Type.Null()]), electionAlarm: Type.Number(), stopped: Type.Boolean(),
  progress: Type.Record(Type.String(), Peer),
  timing: Type.Object({ electionMin: Int, electionMax: Int, heartbeat: Int }),
}), 'NodeStatus')

const ClusterSpec = Schema.define(Type.Object({
  name: Type.String({ pattern: '^[a-z][a-z0-9-]*$' }), size: Type.Union([Type.Literal(3), Type.Literal(5)]), seed: Type.Integer(),
  heartbeatMs: Type.Optional(Type.Integer({ minimum: 10, maximum: 60000 })),
}), 'ClusterSpec')
const ClusterName = Schema.define(Type.Object({ name: Type.String() }), 'ClusterName')
const Names = Schema.define(Type.Array(Type.String()), 'Names')

/** `send` returns at once; the message reaches `to`'s `RaftNode.receive` after a latency on the clock. */
export const Messaging = ns.interface('Messaging', { send: Op.action(Envelope, Nothing) })

/** The actions of raft.github.io, plus `receive` for messaging; `changed` after each step that changes the status. */
export const RaftNode = ns.interface('RaftNode', {
  receive: Op.action(Message, Nothing),
  request: Op.action(Any, Nothing),
  timeOut: Op.action(Nothing, Nothing),
  stop: Op.action(Nothing, Nothing),
  resume: Op.action(Nothing, Nothing),
  restart: Op.action(Nothing, Nothing),
  status: Op.action(Nothing, NodeStatus),
  changed: Op.event(NodeStatus),
})

/** What Raft keeps on stable storage; `written` follows each write. */
export const Ledger = ns.interface('Ledger', {
  read: Op.action(Nothing, Persistent),
  write: Op.action(Persistent, Nothing),
  written: Op.event(Persistent),
})

/** Creates and removes whole clusters, through the host's `HostDeploy`. */
export const Cluster = ns.interface('Cluster', {
  create: Op.action(ClusterSpec, Nothing),
  remove: Op.action(ClusterName, Nothing),
  list: Op.action(Nothing, Names),
})
