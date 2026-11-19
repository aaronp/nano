// File › Examples › Raft: listed, and its nano.json places cluster, messaging and clock in runtime raft, cluster auto-connected to deploy.
import { expect, test } from 'bun:test'
import { Registry, type AppDeployment } from '@pritzlaff/nano-core'
import uiProvider from '@pritzlaff/nano-ui'
import raft from '../../../examples/raft/index.ts'
import { EXAMPLES } from '../src/components/file-menu.ts'
import { autoConnect } from '../src/auto-connect.ts'
import { deployPod, hostProvider } from '../src/host-deploy.ts'

test('File › Examples lists Raft, and its nano.json places cluster, messaging and clock in runtime raft, cluster auto-connected to deploy', async () => {
  expect(EXAMPLES.map(([n]) => n)).toContain('raft')
  const file: AppDeployment = await Bun.file(new URL('../../../examples/raft/nano.json', import.meta.url)).json()
  expect(file.runtimes['raft']!.pods).toEqual(expect.arrayContaining(['cluster', 'raft-messaging', 'raft-clock']))
  expect((file.layout as { slots: { pod: string }[] }).slots.map(s => s.pod)).toContain('cluster')
  expect((file.layout as { ring: { show: string[] } }).ring.show).toEqual(['example.raft/node', 'example.raft/messaging'])
  const registry = Registry.create()
  for (const p of [uiProvider, hostProvider(() => { throw new Error('unused') }), raft]) registry.add(p)
  const d: AppDeployment = { ...file, pods: { deploy: deployPod, ...file.pods }, runtimes: { ...file.runtimes, main: { pods: ['deploy'], subscriptions: [] } } }
  const { deployment, notes } = autoConnect(d, registry, ['cluster'])
  expect(notes).toEqual([expect.stringContaining('connected cluster → deploy')])
  expect(deployment.runtimes['main']!.subscriptions).toContainEqual({ kind: 'call', from: 'cluster', to: 'deploy' })
})
