/**
 * The confirmation before an import loads providers from another origin (port of the old imports-confirm): each
 * provider with its URL and origin, and each of its pods with its isolation; a pod that would run with this page's full
 * access (`host`, or `sandbox`, whose frame shares the page's origin) is flagged. A modal `<dialog>`, so it sits in the
 * top layer, above the sandbox frames. Import is true; Cancel, Escape or closing it false.
 *
 *   if (!await confirmImports(foreign)) return failure('invalid-input', 'import cancelled')
 */
import type { Foreign } from './import.ts'

/** An element with `text` as text, never HTML. */
export const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', ...kids: Node[]) => {
  const e = document.createElement(tag)
  e.textContent = text   // untrusted text: never HTML
  e.append(...kids)
  return e
}

/** A foreign provider: its origin and URL, each pod with its isolation, full access flagged. Also the Import dialog's notice. */
export const row = (f: Foreign) => el('li', '', el('code', f.coord), document.createTextNode(` from ${f.origin} `), el('small', f.url),
  el('ul', '', ...f.pods.map(p => el('li', '', el('code', p.name), document.createTextNode(` ${p.isolation}`),
    ...(p.fullAccess ? [el('br'), el('strong', 'runs with this workspace’s full access')] : [el('small', ': isolated in its own frame')])))))

export function confirmImports(list: Foreign[]): Promise<boolean> {
  return new Promise(resolve => {
    const d = el('dialog', '', el('h2', 'Import from another origin?'),
      el('p', 'These providers come from another site. A pod in an isolated-sandbox runs apart from this page; any other runs with its full access.'),
      el('ul', '', ...list.map(row)))
    d.setAttribute('aria-label', 'Confirm the import')
    let answer = false
    const button = (label: string, yes: boolean) => {
      const b = el('button', label)
      b.type = 'button'
      b.addEventListener('click', () => { answer = yes; d.close() })
      return b
    }
    d.append(el('div', '', button('Cancel', false), button('Import', true)))
    d.addEventListener('close', () => { d.remove(); resolve(answer) })
    document.body.append(d)
    d.showModal()
  })
}
