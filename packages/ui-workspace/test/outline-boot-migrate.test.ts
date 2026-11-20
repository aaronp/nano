// First boot with nothing stored: the old saved pages migrate, and a pod panel's pod (made by the old docks as they
// mounted) is placed lazy in `main` under its name, so its slot survives the next `applied`; a panel whose widget
// names no implementation is dropped, with a status. The old keys go with the first save, so it happens once.
import { expect, test } from 'bun:test'
import { tick } from './host-deploy-setup.ts'

test('a migrated pod panel\'s pod is placed lazy and its slot kept; one with no implementation is dropped', async () => {
  const panel = (widget: string, name: string) => ({ type: 'component', componentState: { widget, name } })
  localStorage.setItem('workspace-starter.saved-workspaces', JSON.stringify([{ path: '/t', title: 'T', icon: 'star' }]))
  localStorage.setItem('workspace-starter.layout.saved./t', JSON.stringify({ root: { type: 'row', content: [panel('nano-ui-log', 'log7'), panel('gone-widget', 'ghost1')] } }))
  const { host, outline } = await import('../src/boot-host.ts')
  if (!host || !outline) throw new Error('the host did not start')
  expect(host.data().pods['log7']).toEqual({ implementation: 'nano.ui/log', eager: false })
  expect(host.data().runtimes['main']!.pods).toContain('log7')
  expect(host.app.runtime('main').status('log7')).toEqual({ ok: true, value: 'not started' })
  expect(JSON.parse(JSON.stringify(outline.resolve('t')))).toEqual({ log7: { kind: 'pod', pods: ['nano.ui/log@main/log7'] } })
  expect(document.querySelector('[data-nano-status]')).not.toBeNull()
  expect(await host.apply(host.data())).toMatchObject({ ok: true })
  expect(outline.resolve('t')['log7']!.kind).toBe('pod')
  expect(JSON.parse(JSON.stringify(outline.document().doc.pages['t']))).toEqual({ title: 'T', slots: { log7: { kind: 'pod', pod: 'nano.ui/log@main/log7' } }, layout: { workspace: { root: { type: 'row', content: [{ type: 'component', componentState: { widget: 'nano-ui-log', name: 'log7' } }, { type: 'component', componentState: { widget: 'gone-widget', name: 'ghost1' } }] } } }, meta: { workspace: { icon: 'star' } } })
  expect(localStorage.getItem('workspace-starter.saved-workspaces')).not.toBeNull()
  await tick(400)
  expect(JSON.parse(localStorage.getItem('nano-workspace.outline')!).pages.t.slots).toEqual({ log7: { kind: 'pod', pod: 'nano.ui/log@main/log7' } })
  expect(localStorage.getItem('workspace-starter.saved-workspaces')).toBeNull()
  expect(localStorage.getItem('workspace-starter.layout.saved./t')).toBeNull()
})
