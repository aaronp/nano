// Shared setup of the import-dialog tests: registers happy-dom (page http://host.test), a template file and `open`.
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { AppDeployment } from '@pritzlaff/nano-core'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: 'http://host.test/' })
const { openImportDialog } = await import('../src/components/import-dialog.ts')   // after happy-dom: it listens on document
export const template = (): AppDeployment => ({
  pods: {
    timer: { implementation: 'acme.template/timer', eager: false },
    picker: { implementation: 'acme.template/picker', eager: false },
    store: { implementation: 'acme.template/store', eager: false, isolation: 'isolated-sandbox' },
  },
  runtimes: { main: { pods: ['timer', 'picker', 'store'], subscriptions: [] } },
  modules: { 'acme.template': './index.js' },
})

export type Chosen = { edit(d: AppDeployment): AppDeployment }
export function open(url: string, known = (_: string) => false, file = template) {
  const calls: { url: string; chosen?: Chosen }[] = []
  const d = openImportDialog(document, {
    fetchJson: async () => file(), known,
    importUrl: async (u: string, chosen?: Chosen) => { calls.push({ url: u, ...(chosen && { chosen }) }); return { ok: true } },
  })
  const q = <T extends Element>(s: string) => d.querySelector(s) as T
  const fetched = async () => {
    q<HTMLInputElement>('input[name="url"]').value = url
    q<HTMLFormElement>('form').dispatchEvent(new Event('submit', { cancelable: true }))
    for (let i = 0; i < 5; i++) await Promise.resolve()
  }
  const isolations = () => [...d.querySelectorAll('[data-pod]:has(input:checked)')]   // the ticked pods'
    .map(li => `${li.getAttribute('data-pod')} ${li.querySelector('[data-isolation]')!.textContent}`)
  const importButton = () => q<HTMLButtonElement>('[data-import]')
  const choose = (v: string) => { const r = q<HTMLInputElement>(`input[name="trust"][value="${v}"]`); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })) }
  return { d, q, calls, fetched, isolations, importButton, choose }
}
