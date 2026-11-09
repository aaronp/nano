// A panel's content: its placed elements put their components in the dock's system, not the page's.
import { GlobalRegistrator } from '@happy-dom/global-registrator'
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
import { expect, test } from 'bun:test'

// imported after the DOM exists (static imports would load lit first, without one)
const { Components, Registries, Runtimes } = await import('@pritzlaff/nano-core')
const { provide } = await import('@pritzlaff/nano-elements')
const { catalog, defineBundle } = await import('@composable/bundle')
const { definePlatform, platform } = await import('@composable/platform')
const { handRegistry } = await import('../src/lib/panel-content.ts')
const tick = () => new Promise(r => setTimeout(r, 0))

test('a placed element in a panel makes its component in the dock\'s registry; other model views keep the page\'s', async () => {
  const host = Runtimes.create(Registries.create('host')), lab = Runtimes.create(Registries.create('lab'))
  host.registry.add('platform', Components.instantiate(platform(host, catalog)))
  provide(document, host.registry)
  // panelContent imports the template into the page (browsers upgrade the elements then; happy-dom can't), so this
  // starts from upgraded elements, not yet on the page, and hands them the registry as panelContent does
  defineBundle(); definePlatform()
  const panel = document.createElement('div'), range = document.createElement('c-range')
  range.setAttribute('name', 'lr'); range.setAttribute('keep', '')
  panel.append(range, document.createElement('c-platform'))
  handRegistry(panel, lab.registry)
  document.body.replaceChildren(panel)
  for (let i = 0; i < 3; i++) await tick()
  expect(lab.registry.get('lr')).toBeDefined()
  expect(host.registry.get('lr')).toBeUndefined()
  expect((document.querySelector('c-platform') as HTMLElement & { registry?: unknown }).registry).toBe(host.registry)   // the platform lives in host
})
