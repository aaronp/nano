// Stored pages that fail to parse: the workspace runs in memory with Main (not an empty document), the stored pages
// kept as they were; File › New, asked, clears them at the next boot.
import { expect, test } from 'bun:test'
import { tick } from './host-deploy-setup.ts'

test('unparseable stored pages: the Outline has Main, a status says so, and File › New asks, then reloads to clear them', async () => {
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
  expect([...document.querySelectorAll('[data-nano-status]')].map(e => e.textContent).join()).toContain('stored outline')   // why: the stored pages
  let reloads = 0
  ;(location as unknown as { reload(): void }).reload = () => { reloads++ }
  const answer = async (label: string) => {
    document.dispatchEvent(new CustomEvent('file:new'))
    await tick(5)
    const d = document.querySelector('dialog[aria-label="New workspace"]')!
    ;[...d.querySelectorAll('button')].find(b => b.textContent === label)!.click()
    await tick(320)
  }
  await answer('Start new')
  expect(errors).toEqual([])
  expect(sessionStorage.getItem('nano-host.wipe')).toBe('1')   // the next boot clears the kept pages
  expect(reloads).toBe(1)
})
