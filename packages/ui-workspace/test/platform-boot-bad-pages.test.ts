// Stored pages that fail to parse: the Platform still boots with Main (not an empty document), so File › New works.
import { expect, test } from 'bun:test'
import { tick } from './host-deploy-setup.ts'

test('unparseable stored pages: the Platform has Main, a status says so, and File › New does not throw', async () => {
  const html = await Bun.file(new URL('../public/index.html', import.meta.url)).text()
  document.body.innerHTML = html.slice(html.indexOf('>', html.indexOf('<body')) + 1, html.lastIndexOf('<script type="module">'))
  localStorage.setItem('nano-workspace.platform', JSON.stringify({ pages: { 'bad id': { slots: {} } } }))
  const errors: unknown[] = []
  addEventListener('error', e => errors.push((e as ErrorEvent).error)); addEventListener('unhandledrejection', e => errors.push((e as PromiseRejectionEvent).reason))
  await import('../src/main.ts')
  const { platform } = await import('../src/boot-host.ts')
  if (!platform) throw new Error('the host did not start')
  expect(Object.keys(platform.document().doc.pages)).toEqual(['workspace'])
  expect(platform.document().doc.pages['workspace']!.meta).toEqual({ title: 'Workspace', order: 0 })
  await tick(50)
  expect([...document.querySelectorAll('[data-nano-status]')].map(e => e.textContent).join()).toContain('saved pages did not load')
  document.dispatchEvent(new CustomEvent('file:new'))
  await tick(50)
  expect(errors).toEqual([])
  expect(Object.keys(platform.document().doc.pages)).toEqual(['workspace'])
})
