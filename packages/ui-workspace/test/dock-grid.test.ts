// <workspace-dock> with the real picker grid (nothing stubbed): an empty dock shows it inline, and a pick fills the dock.
import { expect, test } from 'bun:test'
const { mount, tick } = await import('./dock-setup.ts')

test('the empty dock shows the real grid inline; picking a tile fills it', async () => {
  const { dock } = await mount()
  const empty = dock.querySelector<HTMLElement>('.dock-empty')!
  expect(empty.querySelector('[role="radiogroup"]')).not.toBeNull()
  empty.querySelector<HTMLElement>('[data-widget="plain"]')!.click(); await tick(); await tick()
  expect(dock.querySelectorAll('.dock-panel').length).toBe(1)
  expect(empty.hidden).toBe(true)
  expect(empty.querySelector('[data-widget="plain"]')).not.toBeNull()   // offered again for when it is empty
})
