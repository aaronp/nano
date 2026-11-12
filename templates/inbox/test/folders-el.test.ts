// <inbox-folders>: the folders as buttons, the selected one aria-current; clicking selects.
import { expect, test } from 'bun:test'
import { Ops, Registries, Runtimes, type Op } from '@pritzlaff/nano-core'
import { provide } from '@pritzlaff/nano-elements'
import { define, Folders } from '../src'

define()
const rt = Runtimes.create(Registries.create('page'))
provide(document, rt.registry)
type El = HTMLElement & { updateComplete: Promise<boolean> }
const settle = async (el: El) => { for (let i = 0; i < 3; i++) { await new Promise(r => setTimeout(r, 0)); await el.updateComplete } }
const value = async (op: Op) => ((await rt.call({ registry: 'page', instance: 'test' }, 'folders', Ops.key(op), null)) as any).value

test('<inbox-folders> lists folders as buttons, the selected one aria-current; clicking selects', async () => {
  document.body.innerHTML = '<inbox-folders name="folders"></inbox-folders>'
  const el = document.querySelector('inbox-folders') as El
  await settle(el)
  const buttons = () => [...el.shadowRoot!.querySelectorAll('button')] as HTMLButtonElement[]
  expect(buttons().map(b => b.textContent!.trim())).toEqual(['Inbox', 'Sent', 'Archive'])
  expect(buttons().map(b => b.getAttribute('aria-current'))).toEqual(['true', 'false', 'false'])
  buttons()[1]!.click(); await settle(el)
  expect(await value(Folders.ops.current)).toBe('sent')
  expect(buttons().map(b => b.getAttribute('aria-current'))).toEqual(['false', 'true', 'false'])
})
