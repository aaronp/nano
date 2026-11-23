// The sandbox refuses a `pattern` or `format` in a described schema (ADR-0034): the Raft example, imported sandboxed, must pass.
import { expect, test } from 'bun:test'
import { describeProvider, checkMsg } from '../src/sandbox/protocol.ts'
import raft from '../../../examples/raft/index.ts'

test('given the Raft provider, then its description passes the sandbox protocol check', () => {
  expect(checkMsg({ type: 'described', providers: [describeProvider(raft, {})] })).toMatchObject({ type: 'described' })
})
