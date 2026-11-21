// Review Focus 2: a workspace with only old keys boots into the same pages, pods, views, Desk and Ring filter; after
// that good save they are under `nano-host.document` (views in `host.views`, the Desk and Ring filter under
// `host.layout.workspace`), and the old keys are gone.
import { expect, test } from 'bun:test'
import { Pod } from '@pritzlaff/nano-core'
import { tick } from './host-deploy-setup.ts'

const { log } = await import('@pritzlaff/nano-ui')

test('old keys only: the same pages, pods, views, Desk and Ring filter; then only the one key', async () => {
  const at = URL.parse('./bundle/nano-ui.js', location.href)!.href
  const desk = { runtimes: { main: { x: 1, y: 2 } } }, ring = { show: ['nano.ui/log'] }
  const app = { pods: { log1: Pod.lazy(log) }, runtimes: { main: { pods: ['log1'], subscriptions: [] } }, modules: { 'nano.ui': at }, views: { log1: 'nano-pod-view' },
    layout: { ring, desk, pages: [{ id: 'workspace', title: 'Main', slots: [{ id: 'a', runtime: 'main', pod: 'log1' }] }] } }
  localStorage.setItem('nano-workspace.document', JSON.stringify(app))
  localStorage.setItem('workspace-starter.layout', JSON.stringify({ root: { type: 'row', content: [] } }))   // Main's old dock
  const { host, outline } = await import('../src/boot-host.ts')
  if (!host || !outline) throw new Error('the host did not start')
  expect(JSON.parse(JSON.stringify(outline.document().doc))).toEqual({ roots: ['workspace'], pages: {
    workspace: { title: 'Main', slots: { a: { kind: 'pod', pod: 'nano.ui/log@main/log1' } }, layout: { workspace: { root: { type: 'row', content: [] } } } } } })
  expect(Object.keys(host.app.deployment().pods)).toEqual(['ui', 'deploy', 'outline', 'log1'])
  expect(host.document().host).toEqual({ views: { log1: 'nano-pod-view' }, layout: { workspace: { ring, desk } } })
  await tick(10)
  const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter(k => /^nano-|^workspace-starter\.(layout|saved)/.test(k!))   // the theme's key is not the document's
  expect(keys).toEqual(['nano-host.document'])
  const stored = JSON.parse(localStorage.getItem('nano-host.document')!)
  expect(stored.host).toEqual({ views: { log1: 'nano-pod-view' }, layout: { workspace: { ring, desk } } })
  expect(stored.app.modules).toEqual({ 'nano.ui': at })
})
