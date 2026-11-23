// The explorer's `nano-delete` { runtime }: the workspace asks first (naming the pods that go and those that stay), then removes the runtime.
import { expect, test } from 'bun:test'
import { tick } from './host-deploy-setup.ts'

const click = (label: string) => [...document.querySelectorAll('dialog button')].find(b => b.textContent === label)!.dispatchEvent(new Event('click'))
const del = (runtime: string) => document.dispatchEvent(new CustomEvent('nano-delete', { detail: { runtime }, bubbles: true, composed: true }))

test('nano-delete asks first; Cancel keeps all, Delete drops the runtime and its own pods; main shows a reason and asks nothing', async () => {
  const html = await Bun.file(new URL('../public/index.html', import.meta.url)).text()
  document.body.innerHTML = html.slice(html.indexOf('>', html.indexOf('<body')) + 1, html.lastIndexOf('<script type="module">'))
  const at = URL.parse('./bundle/nano-ui.js', location.href)!.href, input = { implementation: 'nano.ui/input', eager: false }
  localStorage.setItem('nano-workspace.document', JSON.stringify({ pods: { a: input, shared: input }, runtimes: { main: { pods: ['shared'], subscriptions: [] }, edge: { pods: ['a', 'shared'], subscriptions: [] } }, modules: { 'nano.ui': at }, views: {} }))
  localStorage.setItem('nano-workspace.outline', JSON.stringify({ roots: ['workspace'], pages: { workspace: { title: 'Main', slots: {} } } }))
  await import('../src/main.ts')
  const { host } = await import('../src/boot-host.ts')
  const h = host!
  del('edge'); await tick(20)
  const text = document.querySelector('dialog')!.textContent!
  expect(text).toContain('Delete runtime edge? Its pods a go with it. shared stay: placed elsewhere.')
  click('Cancel'); await tick(20)
  expect(Object.keys(h.data().runtimes)).toContain('edge')
  del('edge'); await tick(20); click('Delete'); await tick(50)
  expect(Object.keys(h.data().runtimes)).not.toContain('edge')
  expect(Object.keys(h.data().pods)).not.toContain('a')
  expect(Object.keys(h.data().pods)).toContain('shared')
  del('main'); await tick(20)
  expect(document.querySelector('dialog')).toBeNull()
  const toaster = document.querySelector('nano-toaster') as HTMLElement & { toasts: { title: string }[] }
  expect(toaster.toasts.map(t => t.title).join()).toContain("places the host's own pods")
})
