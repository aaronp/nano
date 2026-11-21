// Review Focus 4: the app bar's view picker writes `host.views`; the Ring filter and the Desk read
// `host.layout.workspace`; File › Save writes the HostDocument (the Desk's arrangement in it), and opening that file
// brings its views and layout back.
import { expect, test } from 'bun:test'
import { tick } from './host-deploy-setup.ts'

test('views, the Ring filter, the Desk and Save/Open on host', async () => {
  const html = await Bun.file(new URL('../public/index.html', import.meta.url)).text()
  document.body.innerHTML = html.slice(html.indexOf('>', html.indexOf('<body')) + 1, html.lastIndexOf('<script type="module">'))
  const at = URL.parse('./bundle/nano-ui.js', location.href)!.href
  const desk = { runtimes: { main: { x: 3, y: 4 } } }
  localStorage.setItem('nano-host.document', JSON.stringify({ app: { pods: { log1: { implementation: 'nano.ui/log', eager: false } }, runtimes: { main: { pods: ['log1'], subscriptions: [] } }, modules: { 'nano.ui': at } },
    outline: { roots: ['workspace'], pages: { workspace: { title: 'Main', slots: {} } } }, host: { layout: { workspace: { ring: { show: ['nano.ui/log'] }, desk }, react: { k: 1 } } } }))
  const blobs = new Map<string, Blob>(), make = URL.createObjectURL.bind(URL), domFetch = globalThis.fetch
  let saved: Blob | undefined
  URL.createObjectURL = (b: Blob) => { const u = make(b); blobs.set(u, b); return u }
  globalThis.fetch = (async (u: string, ...rest: unknown[]) => blobs.has(u) ? new Response(blobs.get(u)) : u.endsWith('examples/saved/nano.json') ? new Response(saved) : (domFetch as Function)(u, ...rest)) as never
  HTMLAnchorElement.prototype.click = function () {}
  await import('../src/main.ts')
  const { host } = await import('../src/boot-host.ts')
  const h = host!
  // the Ring filter: read from host.layout.workspace.ring
  const ring = document.querySelector('nano-ring') as unknown as { show(pod: string, impl: string): boolean }
  expect(ring.show('log1', 'nano.ui/log')).toBe(true)
  expect(ring.show('x', 'other/x')).toBe(false)
  // the Desk: its arrangement read from host.layout.workspace.desk
  const d = document.querySelector('c-desk') as unknown as { layout(): unknown }
  for (let i = 0; i < 50 && JSON.stringify(d.layout()) === '{}'; i++) await tick(10)
  expect(JSON.stringify(d.layout())).toContain('"x":3')
  // the view picker: the override in host.views, saved
  document.dispatchEvent(new CustomEvent('nano-open', { detail: { pod: 'log1' } }))
  const select = document.querySelector('nano-app-bar')!.querySelector<HTMLElement & { value: string }>('nano-select[label="View"]')!
  select.value = 'nano-pod-view'; select.dispatchEvent(new Event('change'))
  await tick(20)
  expect(h.document().host?.views).toEqual({ log1: 'nano-pod-view' })
  expect(JSON.parse(localStorage.getItem('nano-host.document')!).host.views).toEqual({ log1: 'nano-pod-view' })
  // Save: the HostDocument, the Desk's arrangement under host.layout.workspace.desk
  const before = blobs.size
  document.dispatchEvent(new CustomEvent('file:save'))
  saved = [...blobs.values()][before]!
  const file = JSON.parse(await saved.text())
  expect(Object.keys(file)).toEqual(['app', 'outline', 'host'])
  expect(file.host.views).toEqual({ log1: 'nano-pod-view' })
  expect(file.host.layout.workspace.ring).toEqual({ show: ['nano.ui/log'] })
  expect(file.host.layout.workspace.desk).toBeDefined()
  expect(file.app.views).toBeUndefined()
  // New clears the workspace's views and layout (another client's kept); opening the saved file brings them back
  document.dispatchEvent(new CustomEvent('file:new'))
  await tick(50)
  expect(h.document().host?.layout).toEqual({ react: { k: 1 } })
  const applied = new Promise<void>(r => h.app.listen(e => { if (e.type === 'applied') r() }))
  document.dispatchEvent(new CustomEvent('file:example', { detail: { name: 'saved' } }))
  await applied; await tick(20)
  expect(h.document().host?.views).toEqual({ log1: 'nano-pod-view' })
  expect((h.document().host?.layout as { workspace: { ring: unknown } }).workspace.ring).toEqual({ show: ['nano.ui/log'] })
})
