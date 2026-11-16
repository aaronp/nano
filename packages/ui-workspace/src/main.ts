/** The host page: theme first, then the views, the host and its shell; `?src=<url>` imports that nano.json on load. */
import './boot-theme.ts'
import { defineViews } from '@pritzlaff/nano-ui'
import { toast } from '@pritzlaff/nano-elements'
import { start, type Host } from './host.ts'
import './shell.ts'
import './dock/dock.ts'
import './shell/app-shell.ts'
import './shell/app-bar.ts'
import './components/theme-picker.ts'
import { forgetLayout } from './shell/settings.ts'
import type { WorkspaceDock } from './dock/dock.ts'

defineViews()
const host = await start()
if (!host.ok) toast(host.fail.reason, { variant: 'bad', duration: 0 })
else {
  for (const tag of ['workspace-shell', 'workspace-app-bar', 'workspace-dock']) (document.querySelector(tag) as HTMLElement & { host?: Host }).host = host.value
  const dock = document.querySelector('workspace-dock') as WorkspaceDock
  document.addEventListener('nano-command', e => dock.command((e as CustomEvent<string>).detail))   // the View menu; File's are not yet
  document.getElementById('reset-layout')!.addEventListener('click', () => void forgetLayout(localStorage, host.value))
  const src = new URLSearchParams(location.search).get('src')
  // Only a URL on this page's origin: a crafted link must not open the import prompt on load.
  if (src && new URL(src, location.href).origin !== location.origin) toast(`${src} is not on this origin`, { variant: 'bad' })
  else if (src) await host.value.importUrl(new URL(src, location.href).href)   // a failure is shown as a toast
}
