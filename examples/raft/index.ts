// The Raft example's module: its provider (default export) and its views, by implementation.
import { Coord } from '@pritzlaff/nano-core'
import { cluster } from './cluster.ts'
import { ledger } from './ledger.ts'
import { messaging } from './messaging.ts'
import { node } from './node.ts'
import './views/glyph.ts'
import './views/ledger-view.ts'
import './views/cluster-view.ts'

export default Coord.namespace('example.raft').provider([messaging, node, ledger, cluster])
export const views: Record<string, string> = { 'example.raft/node': 'raft-node', 'example.raft/ledger': 'raft-ledger', 'example.raft/cluster': 'raft-cluster' }
