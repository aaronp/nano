/** The page's entry: nano-ui's elements defined, the host booted from storage, the app rendered (or why it did not boot). */
import { createRoot } from 'react-dom/client'
import { defineViews } from '@pritzlaff/nano-ui'
import { boot } from './boot.ts'
import { App } from './app.tsx'

defineViews()
const root = createRoot(document.getElementById('root')!)
let rerender = () => {}
const storage = (() => { try { return localStorage } catch { return undefined } })()
const h = storage ? await boot(storage, undefined, location.href, () => rerender()) : undefined
if (!h?.ok) root.render(<p className="status bad" role="alert">The host did not start: {h ? h.fail.reason : 'storage is not available'}</p>)
else { rerender = () => root.render(<App h={h.value} />); rerender() }
