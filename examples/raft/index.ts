// The Raft example's module: its provider (default export) and its views, by implementation (Task 8).
import { Coord } from '@pritzlaff/nano-core'
import { cluster } from './cluster.ts'
import { ledger } from './ledger.ts'
import { messaging } from './messaging.ts'
import { node } from './node.ts'

export default Coord.namespace('example.raft').provider([messaging, node, ledger, cluster])
export const views: Record<string, string> = {}
