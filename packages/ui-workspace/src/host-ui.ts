/**
 * `workspace.host/ui`: this host's HostUI. `alert` shows a toast, `approve` asks in a `<dialog>` (Approve is true,
 * Deny or closing it false), `setAppBar` sets the title (the page's and the app shell's).
 *
 *   Pod.eager(hostUi)   // the pod `ui` in runtime `main`; hostProvider (host-deploy.ts) provides it
 */
import { Coord, Implementation, provide, success } from '@pritzlaff/nano-core'
import { HostUI } from '@pritzlaff/nano-ui'
import { toast } from '@pritzlaff/nano-elements'
import { ask, esc } from './components/name-dialog.ts'

const ns = Coord.namespace('workspace.host')

/** A title made of clauses ("Create runtimes x; places y; a → b") reads as a short heading and a list of its clauses. */
function body(title: string, detail?: string): string {
  const [head, ...rest] = title.split('; ')
  return `<h2>${esc(rest.length ? 'Approve this change?' : head)}</h2>${rest.length ? `<ul>${[head, ...rest].map(c => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}${detail ? `<p>${esc(detail)}</p>` : ''}`
}

/** The workspace's own dialog shell (`ask`, themed by `.import-dialog`); Deny is focused, so Enter never approves. */
function approve({ title, detail }: { title: string; detail?: string }): Promise<boolean> {
  return ask<boolean>(document, 'Approve', `${body(title, detail)}<div class="actions">
    <button type="button" data-cancel autofocus>Deny</button><button type="button" class="primary" data-ok>Approve</button></div>`,
    (d, done) => { d.querySelector<HTMLButtonElement>('[data-cancel]')!.autofocus = true; d.querySelector('[data-ok]')!.addEventListener('click', () => done(true)) }, false)
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
