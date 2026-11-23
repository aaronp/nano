// Review Focus 3: an eager sandboxed pod in the stored document still runs in a frame once the workspace has booted
// (happy-dom runs no frame script: the frame's side is `serve` on the channel's other port).
import { expect, test } from 'bun:test'
import { tick } from './host-deploy-setup.ts'
import { serve } from '../src/sandbox/serve.ts'

const { log } = await import('@pritzlaff/nano-ui')
const Real = MessageChannel
globalThis.MessageChannel = class extends Real { constructor() { super(); serve(this.port2, async () => log) } }

test('a stored eager isolated-sandbox pod is built in a frame after boot', async () => {
  const at = URL.parse('./bundle/nano-ui.js', location.href)!.href
  localStorage.setItem('nano-host.document', JSON.stringify({ app: { pods: { s1: { implementation: 'nano.ui/log', eager: true, isolation: 'isolated-sandbox' } },
    runtimes: { main: { pods: ['s1'], subscriptions: [] } }, modules: { 'nano.ui': at } }, outline: { roots: [], pages: {} } }))
  const { host } = await import('../src/boot-host.ts')
  if (!host) throw new Error('the host did not start')
  for (let i = 0; i < 100 && host.app.runtime('main').status('s1').ok && (host.app.runtime('main').status('s1') as { value: string }).value !== 'running'; i++) await tick(10)
  expect(host.app.runtime('main').status('s1')).toEqual({ ok: true, value: 'running' })
  expect(document.getElementById('nano-sandbox-layer')?.querySelectorAll('iframe').length).toBe(1)
})
