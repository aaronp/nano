// Stored pages that fail to parse: the Outline still boots with Main (not an empty document), so File › New works.
import { expect, test } from 'bun:test'
import { tick } from './host-deploy-setup.ts'

test('unparseable stored pages: the Outline has Main, a status says so, and File › New does not throw', async () => {
  const html = await Bun.file(new URL('../public/index.html', import.meta.url)).text()
  document.body.innerHTML = html.slice(html.indexOf('>', html.indexOf('<body')) + 1, html.lastIndexOf('<script type="module">'))
  localStorage.setItem('nano-workspace.outline', JSON.stringify({ pages: { 'bad id': { slots: {} } } }))
  const errors: unknown[] = []
  addEventListener('error', e => errors.push((e as ErrorEvent).error)); addEventListener('unhandledrejection', e => errors.push((e as PromiseRejectionEvent).reason))
  await import('../src/main.ts')
  const { outline } = await import('../src/boot-host.ts')
  if (!outline) throw new Error('the host did not start')
  expect(Object.keys(outline.document().doc.pages)).toEqual(['workspace'])
  expect(outline.document().doc.pages['workspace']).toMatchObject({ title: 'Workspace' })
  await tick(50)
  expect([...document.querySelectorAll('[data-nano-status]')].map(e => e.textContent).join()).toContain('saved pages did not load')
  document.dispatchEvent(new CustomEvent('file:new'))
  await tick(50)
  expect(errors).toEqual([])
  expect(Object.keys(outline.document().doc.pages)).toEqual(['workspace'])
})
