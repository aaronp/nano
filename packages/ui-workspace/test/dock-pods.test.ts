// <workspace-dock>'s template mode with the real host: an implementation picked into a position is stored with its pod
// once made, and an add from outside with no room waits for that pod rather than being dropped.
import { GlobalRegistrator } from '@happy-dom/global-registrator'
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: new URL('../../../', import.meta.url).href })
import { afterEach, expect, mock, test } from 'bun:test'
import type { PanelState } from '../src/lib/layout-templates.ts'

let choice: PanelState | null = null   // the picker, stubbed
mock.module('../src/components/picker.ts', () => ({ pick: async () => choice }))
const { defineViews } = await import('@pritzlaff/nano-ui')
const { start } = await import('../src/host.ts')
await import('../src/components/workspace-dock.ts')
const { implementationTemplates } = await import('../src/dock/panels.ts')
const { createBus, provideBus } = await import('../src/lib/bus.ts')
const { templateState } = await import('../src/lib/layout-templates.ts')
defineViews()

type Dock = HTMLElement & { addWidget(id: string, name?: string): void; setTemplate(id: string): boolean; template: string }
const until = async (ok: () => boolean) => { for (let i = 0; i < 200 && !ok(); i++) await new Promise(r => setTimeout(r, 5)); expect(ok()).toBe(true) }
afterEach(() => { document.body.innerHTML = ''; localStorage.clear() })

type H = Extract<Awaited<ReturnType<typeof start>>, { ok: true }>['value']
/** A dock on a host; `late`, the host is given after it connects, as main.ts does on a reload. */
async function mount(given?: H, late = false) {
  const r = given ? { ok: true as const, value: given } : await start()
  if (!r.ok) throw new Error(r.fail.reason)
  const dock = document.createElement('workspace-dock') as Dock & { host?: H }
  Object.assign(dock, { id: 'ws' }, !late && { host: r.value })
  dock.setAttribute('storage-key', 't.pods'); dock.setAttribute('open', 'plain')
  dock.innerHTML = '<template data-widget="plain" data-title="Plain"><div>plain</div></template>'
  dock.prepend(...implementationTemplates(r.value, document))
  const bus = createBus(), page = document.createElement('div')
  provideBus(page, bus); page.append(dock); document.body.append(page)
  if (late) dock.host = r.value
  return { dock, bus, host: r.value, input: implementationTemplates(r.value, document).find(t => t.dataset['implementation'] === 'nano.ui/input')!.dataset['widget']! }
}
const stored = () => templateState(localStorage, 't.pods').get()!.order

test('an implementation picked into a position is stored with its pod once made', async () => {
  const { dock, input } = await mount()
  dock.setTemplate('two-cols')
  choice = { widget: input }
  dock.querySelector<HTMLElement>('.tpl-add')!.click()
  await until(() => !!stored()[1]?.name)
  expect(stored()[1]).toEqual({ widget: input, name: 'input1' })
})

test('an add with no room while a pod is being made waits for it, says so, then flips to the dock with it', async () => {
  const { dock, bus, input } = await mount()
  dock.setTemplate('two-cols')
  choice = { widget: input }
  dock.querySelector<HTMLElement>('.tpl-add')!.click()
  for (let i = 0; i < 50 && dock.querySelector('.tpl-add'); i++) await Promise.resolve()   // filled, its pod not yet made
  expect(stored()[1]).toEqual({ widget: input })
  dock.addWidget('plain')
  expect(dock.template).toBe('two-cols')
  expect(bus.history().filter(m => m.topic === 'dock:status').at(-1)!.payload).toEqual({ message: 'Adding Plain once the new pod is made.' })
  await until(() => dock.template === 'dock')
  expect(dock.querySelectorAll('.dock-panel').length).toBe(3)
})

test('a reload in a template, its host given after the dock connects, keeps the pods named and makes none', async () => {
  const { dock, host, input } = await mount()
  dock.setTemplate('two-cols')
  choice = { widget: input }
  dock.querySelector<HTMLElement>('.tpl-add')!.click()
  await until(() => !!stored()[1]?.name)
  const before = JSON.stringify(stored()), pods = Object.keys(host.data().pods).length
  document.body.innerHTML = ''
  const { dock: again } = await mount(host, true)
  await new Promise(r => setTimeout(r, 50))
  expect(again.template).toBe('two-cols')
  expect(JSON.stringify(stored())).toBe(before)
  expect(Object.keys(host.data().pods).length).toBe(pods)
  expect(again.querySelectorAll('.tpl-pos')[1]!.querySelector('.dock-panel')!.childElementCount).toBe(1)   // its pod's view, made with the host
})
