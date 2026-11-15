/** The host page: theme first, then the views, the host and its shell; `?src=<url>` imports that nano.json on load. */
import './boot-theme.ts'
import { defineViews } from '@pritzlaff/nano-ui'
import { toast } from '@pritzlaff/nano-elements'
import { start, type Host } from './host.ts'
import './shell.ts'

defineViews()
const host = await start()
if (!host.ok) toast(host.fail.reason, { variant: 'bad', duration: 0 })
else {
  ;(document.querySelector('workspace-shell') as HTMLElement & { host?: Host }).host = host.value
  const src = new URLSearchParams(location.search).get('src')
  if (src) await host.value.importUrl(src)   // a failure is shown as a toast
}
