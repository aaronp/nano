// The pod `outline` is built at boot (boot-host.ts), so a subscriber to HostOutline's `changed` hears a page edit
// without anything having called the pod.
import { expect, test } from 'bun:test'
import { HostOutline } from '@pritzlaff/nano-outline'
import { tick } from './host-deploy-setup.ts'

test('a subscriber to `changed`, the pod never called, hears a page edit', async () => {
  const { host, outline } = await import('../src/boot-host.ts')
  if (!host || !outline) throw new Error('the host did not start')
  const heard: unknown[] = []
  host.app.runtime('main').subscribe(HostOutline.ops.changed, e => { heard.push(e) })
  await tick(20)
  const d = outline.document().doc
  expect(outline.apply({ roots: [...d.roots, 'notes'], pages: { ...d.pages, notes: { slots: {} } } })).toMatchObject({ ok: true })
  await tick(20)
  expect(heard).toEqual([{ output: { added: ['notes'], removed: [], changed: [], moved: [] } }])
})
