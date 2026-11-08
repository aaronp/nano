/**
 * The adapter between this host and @composable components. Nothing else in the starter knows about them, and
 * they know nothing about the starter:
 *   - one scope for the page, provided on the document, so any composable view (in markup, or cloned into a
 *     dock panel) places its component there and leaves when it is removed;
 *   - our theme tokens (--c-*) are mapped onto this starter's in app.css (CSS only);
 *   - our publications are mirrored onto the starter's bus as `composable:<op>`, so its widgets (bus-log,
 *     status-line) show them.
 * <connection-designer> joins the same scope as a host tool, so it sees (and wires) every composable instance.
 * Imported before the views are defined, so the provider exists when markup upgrades.
 */
import { Scopes } from '@composable/sdk'
import { provideScope } from '@composable/ui'
import { defineElements } from '@composable/widgets/views'
import { defineDesigner } from '@composable/connection-designer'
import { requestBus } from './lib/bus.ts'

export const scope = Scopes.create({ onError: (e, info) => console.error('composable:', e, info) })
provideScope(document, scope)
defineElements()
defineDesigner()

void customElements.whenDefined('app-shell').then(() => {
  const shell = document.querySelector('app-shell')
  if (!shell) return
  const bus = requestBus(shell as HTMLElement)
  scope.observe(t => { if (t.kind === 'publish') bus.publish(`composable:${t.op.split('/').pop()}`, t.data, t.from) })
})
