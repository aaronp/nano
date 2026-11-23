// Storage the page may not use (localStorage throws): the host and its pages boot in memory, page changes work, and
// the first save says, once, that nothing is being saved.
import { expect, test } from 'bun:test'
import { flat } from './flat.ts'
import { tick } from './host-deploy-setup.ts'

test('blocked storage: the app and its pages run in memory, and a status says they are not saved', async () => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new DOMException('The operation is insecure.', 'SecurityError') } })
  const { host, outline } = await import('../src/boot-host.ts')
  if (!host || !outline) throw new Error('the host did not start')
  expect(Object.keys(outline.document().doc.pages)).toEqual(['workspace'])
  expect(outline.apply(flat({ ...outline.document().doc.pages, notes: { slots: { n: { kind: 'tool', tool: 'notes' } }, meta: { title: 'Notes', order: 1 } } }))).toMatchObject({ ok: true })
  expect(Object.keys(outline.document().doc.pages)).toEqual(['workspace', 'notes'])
  await tick(400)
  expect([...document.querySelectorAll('[data-nano-status]')].map(e => e.textContent).join()).toContain('not being saved')
  expect(document.querySelectorAll('[data-nano-status]').length).toBe(1)
})
