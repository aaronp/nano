/**
 * `workspace.host/ui`: this host's HostUI. `alert` shows a toast, `approve` asks in a `<dialog>` (Approve is true,
 * Deny or closing it false), `setAppBar` sets the title (the page's and the app shell's).
 *
 *   registry.add(hostProvider); Pod.eager(hostUi)   // the pod `ui` in runtime `main`
 */
import { Coord, Implementation, provide, success } from '@pritzlaff/nano-core'
import { HostUI } from '@pritzlaff/nano-ui'
import { toast } from '@pritzlaff/nano-elements'

const ns = Coord.namespace('workspace.host')

function approve({ title, detail }: { title: string; detail?: string }): Promise<boolean> {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog')
    const heading = Object.assign(document.createElement('h3'), { textContent: title })
    const text = Object.assign(document.createElement('p'), { textContent: detail ?? '' })
    const button = (label: string, answer: boolean) => {
      const b = Object.assign(document.createElement('button'), { type: 'button', textContent: label })
      b.autofocus = !answer   // Deny: Enter on an unexpected prompt must not approve
      b.addEventListener('click', () => done(answer))
      return b
    }
    let settled = false
    const done = (answer: boolean) => {
      if (settled) return
      settled = true
      if (dialog.open) dialog.close()
      dialog.remove()
      resolve(answer)
    }
    dialog.addEventListener('close', () => done(false))
    dialog.append(heading, text, button('Approve', true), button('Deny', false))
    document.body.append(dialog)
    dialog.showModal()
  })
}

export const hostUi = Implementation.define(ns.implementationId('ui'), {
  provides: [HostUI],
  make: () => [provide(HostUI, {
    alert: async text => { toast(String(text)); return success(null) },
    approve: async a => success(await approve(a as { title: string; detail?: string })),
    setAppBar: async text => {
      document.title = String(text)
      const title = document.querySelector('app-shell > [slot="title"]')
      if (title) title.textContent = String(text)
      return success(null)
    },
  })],
})

export const hostProvider = ns.provider([hostUi])
