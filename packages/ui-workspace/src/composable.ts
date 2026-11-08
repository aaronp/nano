/**
 * The adapter between this host and @composable components. Nothing else in the starter knows about them, and
 * they know nothing about the starter:
 *   - one System for the page, provided on the document, so any composable view (in markup, or cloned into a
 *     dock panel) creates and registers its component there, and unregisters it when it is removed;
 *   - our theme tokens (--c-*) are mapped onto this starter's in app.css (CSS only);
 *   - our notifications are mirrored onto the starter's bus as `composable:<op>`, so its widgets (bus-log,
 *     status-line) show them.
 * <connection-designer> joins the same System, so it sees (and wires) every composable instance.
 * Imported before the views are defined, so the provider exists when markup upgrades.
 */
import { Systems } from '@composable/sdk'
import { provideSystem } from '@composable/ui'
import { defineElements } from '@composable/widgets/views'
import { defineDesigner } from '@composable/connection-designer'
import { requestBus } from './lib/bus.ts'

/** The page's System. Other Systems (sandboxes, a workspace of its own) are just more `Systems.create()`. */
export const scope = Systems.create({ id: 'page', onError: (e, info) => console.error('composable:', e, info) })
provideSystem(document, scope)
defineElements()
defineDesigner()

void customElements.whenDefined('app-shell').then(() => {
  const shell = document.querySelector('app-shell')
  if (!shell) return
  const bus = requestBus(shell as HTMLElement)
  scope.observe(t => { if (t.kind === 'notify') bus.publish(`composable:${t.op.split('/').pop()}`, t.data, t.from) })
})
