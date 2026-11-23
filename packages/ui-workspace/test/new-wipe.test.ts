// File › New's second half: a boot that finds the wipe flag clears the stored document and its old forms before it
// reads them (whatever the old page wrote while unloading), keeps the theme, and starts with Main alone.
import { expect, test } from 'bun:test'
import './host-deploy-setup.ts'   // the DOM

test('a boot after File › New starts empty: the stored document and old keys gone, the theme kept', async () => {
  const html = await Bun.file(new URL('../public/index.html', import.meta.url)).text()
  document.body.innerHTML = html.slice(html.indexOf('>', html.indexOf('<body')) + 1, html.lastIndexOf('<script type="module">'))
  localStorage.setItem('nano-host.document', JSON.stringify({ app: { pods: {}, runtimes: {} }, outline: { roots: ['workspace', 'two'], pages: { workspace: { title: 'Main', slots: {} }, two: { title: 'Two', slots: {} } } }, host: { views: { a: 'x' }, layout: { react: { k: 1 } } } }))
  localStorage.setItem('nano-workspace.outline', JSON.stringify({ roots: ['old'], pages: { old: { slots: {} } } }))
  localStorage.setItem('workspace-starter.theme', 'nano:dark')
  sessionStorage.setItem('nano-host.wipe', '1')
  const { host, outline } = await import('../src/boot-host.ts')
  expect(sessionStorage.getItem('nano-host.wipe')).toBeNull()
  expect(localStorage.getItem('nano-workspace.outline')).toBeNull()
  expect(localStorage.getItem('workspace-starter.theme')).toBe('nano:dark')
  expect(outline!.document().doc.roots).toEqual(['workspace'])
  expect(host!.document().host?.views ?? {}).toEqual({})
  expect(host!.document().host?.layout?.['react']).toBeUndefined()
})
