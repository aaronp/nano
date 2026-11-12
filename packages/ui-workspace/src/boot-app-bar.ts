/**
 * The app bar on the page: <nano-app-bar> shows what the app gateway's appBar names; this drives the gateway.
 * A page change clears focus and sets the page's default (a workspace's controls, made in host on first visit, or
 * nothing); a dock's `dock:focus` sets focus. Components put their own controls up through the gateway themselves.
 */
import { Components, Ops, type Op } from '@pritzlaff/nano-core'
import { runtimeOf } from '@composable/platform'
import { AppGateway, type Focus } from '@composable/shell'
import { catalog, host } from './composable.ts'
import { defineAppBar, type AppBarEl } from './components/app-bar.ts'
import { controlsId, WorkspaceControls } from './components/workspace-controls.ts'
import { requestBus } from './lib/bus.ts'

const call = async (id: string, op: Op, arg: unknown = null) => {
  const r = await host.call({ registry: 'host', instance: 'app-bar' }, id, Ops.key(op), arg)
  if ('error' in r) console.error('app bar:', r.error)
}
const app = (op: Op, arg: unknown) => call('app', op, arg)

/** Clears focus and sets the shown page's default controls: its dock's, or none. */
async function show(route: Element | null) {
  await app(AppGateway.ops.setFocus, null)
  const dock = route?.querySelector('workspace-dock')
  if (!dock) return app(AppGateway.ops.setAppBarDefault, null)
  const id = controlsId(dock.id)
  if (!host.registry.get(id)) host.registry.add(id, Components.instantiate(WorkspaceControls), { kind: 'app', name: 'ui-workspace' })
  await call(id, WorkspaceControls.ops.attach, dock.id)
  await app(AppGateway.ops.setAppBarDefault, { system: 'host', instance: id })
}
let queue = Promise.resolve()
const sync = (route: Element | null) => { queue = queue.then(() => show(route)) }   // in order: a later page wins

defineAppBar()
const bar = document.querySelector<AppBarEl>('nano-app-bar')
if (bar) {
  bar.resolve = ({ system, instance }) => {
    const registry = system === 'host' ? host.registry : runtimeOf(host.registry, system)?.registry
    const c = registry?.get(instance)?.component
    if (!registry || !c) return undefined
    const tag = Object.values(catalog).find(e => e.component.id.ns === c.id.ns && e.component.id.name === c.id.name)?.tag
      ?? (c === WorkspaceControls ? 'nano-workspace-controls' : undefined)
    return tag ? { tag, registry } : undefined
  }
  requestBus(bar).subscribe('route:changed', m =>
    sync(document.querySelector(`app-shell > app-route[path="${(m.payload as { path: string }).path}"]`)))
  sync(document.querySelector('app-shell > app-route:not([hidden])'))   // the page shown now, if the shell routed already
}
document.addEventListener('dock:focus', e => { void app(AppGateway.ops.setFocus, (e as CustomEvent<Focus>).detail) })
