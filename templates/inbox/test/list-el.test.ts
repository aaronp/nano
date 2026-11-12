// <inbox-list>: the shown messages as buttons; clicking opens. <inbox-reader>: from, subject, date, body, all as text.
import { expect, test } from 'bun:test'
import { Ops, Registries, Runtimes, type Op } from '@pritzlaff/nano-core'
import { provide } from '@pritzlaff/nano-elements'
import { define, List, Reader } from '../src'

define()
const rt = Runtimes.create(Registries.create('page'))
provide(document, rt.registry)
type El = HTMLElement & { updateComplete: Promise<boolean> }
const settle = async (el: El) => { for (let i = 0; i < 3; i++) { await new Promise(r => setTimeout(r, 0)); await el.updateComplete } }
const call = (name: string, op: Op, arg: unknown = null) => rt.call({ registry: 'page', instance: 'test' }, name, Ops.key(op), arg) as Promise<any>

test('<inbox-list> renders rows as buttons; clicking opens', async () => {
  document.body.innerHTML = '<inbox-list name="list"></inbox-list><inbox-reader name="reader"></inbox-reader>'
  const el = document.querySelector('inbox-list') as El, reader = document.querySelector('inbox-reader') as El
  rt.registry.subscribe({ source: 'list', op: Ops.key(List.ops.opened), listener: 'reader', target: Ops.key(Reader.ops.read) })
  await settle(el)
  const rows = () => [...el.shadowRoot!.querySelectorAll('button')] as HTMLButtonElement[]
  expect(rows().length).toBe(3)
  expect(rows()[0]!.textContent).toContain('Welcome to the app starter')
  rows()[1]!.click(); await settle(el); await settle(reader)
  expect((await call('reader', Reader.ops.message)).value.id).toBe('m2')
  expect(reader.shadowRoot!.textContent).toContain('Weekly report is ready')
})

test('<inbox-reader> renders from, subject, date, body', async () => {
  document.body.innerHTML = '<inbox-reader name="reader2"></inbox-reader>'
  const el = document.querySelector('inbox-reader') as El
  await settle(el)
  expect(el.shadowRoot!.textContent).toContain('Nothing selected')
  await call('reader2', Reader.ops.read, { id: 'q', folder: 'inbox', from: 'Ada', subject: 'Hi there', date: 'Mon', body: 'Line one' })
  await settle(el)
  const t = el.shadowRoot!.textContent!
  for (const s of ['Ada', 'Hi there', 'Mon', 'Line one']) expect(t).toContain(s)
})

test('HTML in subject and body renders as text', async () => {
  document.body.innerHTML = '<inbox-list name="list3"></inbox-list><inbox-reader name="reader3"></inbox-reader>'
  const l = document.querySelector('inbox-list') as El, el = document.querySelector('inbox-reader') as El
  const m = { id: 'x', folder: 'inbox', from: '<i>f</i>', subject: '<b>bold</b>', date: 'd', body: '<img src=x onerror=alert(1)>' }
  await call('list3', List.ops.setMessages, [m]); await call('reader3', Reader.ops.read, m)
  await settle(l); await settle(el)
  for (const e of [l, el]) { expect(e.shadowRoot!.querySelector('b,img,i')).toBeNull() }
  expect(l.shadowRoot!.textContent).toContain('<b>bold</b>')
  expect(el.shadowRoot!.textContent).toContain('<img src=x onerror=alert(1)>')
})
