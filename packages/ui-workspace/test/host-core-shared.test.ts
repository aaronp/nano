// Review Focus 1: both hosts read and write `nano-host.document`. A document another host (the React host, on the host
// core) wrote boots here with its pages and pods, Main added first; a page made here is in that one key at once, and
// the other host booting from it shows it.
import { expect, test } from 'bun:test'
import uiProvider from '@pritzlaff/nano-ui'
import { Host } from '@pritzlaff/nano-host'
import { addPage } from '@pritzlaff/nano-host'
import { tick } from './host-deploy-setup.ts'

const KEY = 'nano-host.document'

test('a page made in the other host shows here; one made here shows there', async () => {
  const doc = { app: { pods: { log1: { implementation: 'nano.ui/log', eager: false } }, runtimes: { main: { pods: ['log1'], subscriptions: [] } } },
    outline: { roots: ['react'], pages: { react: { title: 'From React', slots: { log1: { kind: 'pod', pod: 'nano.ui/log@main/log1' } }, layout: { react: { columns: 2 } } } } }, host: { views: { log1: 'nano-pod-view' } } }
  localStorage.setItem(KEY, JSON.stringify(doc))
  const { host, outline } = await import('../src/boot-host.ts')
  if (!host || !outline) throw new Error('the host did not start')
  expect(outline.document().doc.roots).toEqual(['workspace', 'react'])   // Main, a workspace rule, first
  expect(JSON.parse(JSON.stringify(outline.document().doc.pages['react']))).toEqual(doc.outline.pages.react)
  expect(host.document().host?.views).toEqual({ log1: 'nano-pod-view' })
  expect(Object.keys(host.app.deployment().pods)).toEqual(['ui', 'deploy', 'outline', 'log1'])
  expect(outline.apply(addPage(outline.document().doc, 'Made here')!)).toMatchObject({ ok: true })
  const stored = JSON.parse(localStorage.getItem(KEY)!)
  expect(stored.outline.roots).toEqual(['workspace', 'react', 'made-here'])
  expect(Object.keys(stored.app.pods)).toEqual(['log1'])   // the host pods never saved
  for (const k of ['nano-workspace.document', 'nano-workspace.outline']) expect(localStorage.getItem(k)).toBeNull()
  await tick(10)
  const other = await Host.boot(localStorage, { base: location.href, providers: [uiProvider] })
  if (!other.ok) throw new Error(other.fail.reason)
  expect(other.value.outline.document().doc.pages['made-here']).toEqual({ slots: {}, title: 'Made here' })
})
