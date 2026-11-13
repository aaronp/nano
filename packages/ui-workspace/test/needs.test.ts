// Needs in the host: the people example loads with nothing to ask; a new form asks, one need at a time, and is marked.
import { GlobalRegistrator } from '@happy-dom/global-registrator'
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import type { NanoApp } from '@pritzlaff/nano-app'
import type { Snapshot } from '@pritzlaff/nano-core'

// imported after the DOM exists (static imports would load lit first, without one)
const { applyApp, ApplicationOps: P, unboundOf } = await import('@pritzlaff/nano-app')
const { provide } = await import('@pritzlaff/nano-elements')
const { catalog: people, definePeople } = await import('@composable/people')
const { known } = await import('../src/app/known')
const { busy, whileApplying } = await import('../src/app/boot')
const { bootNeeds } = await import('../src/boot-needs')
const { appHost, memoryStores, tick } = await import('./fixtures/app-host')

const peopleApp = JSON.parse(readFileSync(new URL('../../people/people.nano.json', import.meta.url), 'utf8')) as NanoApp
const setup = () => {
  const h = appHost(), s = memoryStores()
  for (const [k, e] of Object.entries(people)) h.catalog[k] = { ...e, modes: ['host'], trust: 'trusted' }
  const stop = bootNeeds(document, h.host, { busy, importPackage: async () => {} })
  return { ...h, ...s, stop }
}
const dlg = () => document.querySelector('dialog')
const settle = async () => { for (let i = 0; i < 5; i++) await tick() }

test('the people example applies with no notes, nothing unbound, and no chooser', async () => {
  const a = setup()
  const notes = await whileApplying(() => applyApp(peopleApp, 'replace', { host: a.host, stores: a.stores, catalog: a.catalog, known, consentCode: () => true, importPackage: async () => ({}) }))
  await settle()
  expect(notes).toEqual([])
  const snaps = (await a.call('application', P.systems)).value as Snapshot[]
  expect(snaps.flatMap(unboundOf)).toEqual([])
  expect(dlg()).toBeNull()
  // nothing asks while a document is applied, even for a need left unbound
  await whileApplying(async () => { await a.call('application', P.createComponent, { kind: 'person-form', name: 'f2', system: 'app' }); await settle() })
  await settle()
  expect(dlg()).toBeNull()
  a.stop()
}, 10_000)

test('a new form asks for each need in turn; cancelled, its element is dimmed and says what it needs', async () => {
  const a = setup()
  definePeople()
  provide(document, a.host.registry)
  document.body.insertAdjacentHTML('beforeend', '<c-person-form name="f1"></c-person-form>')
  const el = document.body.lastElementChild!
  await settle()
  expect(dlg()?.getAttribute('aria-label')).toBe('Choose bff')
  expect([...dlg()!.querySelectorAll('[data-make]')].map(b => b.getAttribute('data-make'))).toEqual(['people-bff'])
  ;(dlg()!.querySelector('[data-cancel]') as HTMLElement).click(); await settle()
  expect(dlg()?.getAttribute('aria-label')).toBe('Choose rules')
  ;(dlg()!.querySelector('[data-cancel]') as HTMLElement).click(); await settle()
  expect(dlg()).toBeNull()
  expect(el.getAttribute('data-unbound')).toBe('bff,rules')
  expect(el.hasAttribute('data-needs')).toBe(true)
  expect(el.previousElementSibling?.textContent).toBe('Needs bff, rules — Choose…')
  // Choose… asks again; make one binds it, and the made bff asks for its own need
  ;(el.previousElementSibling as HTMLElement).click(); await settle()
  ;(dlg()!.querySelector('[data-make="people-bff"]') as HTMLElement).click(); await settle()
  expect(a.host.registry.binding('f1', 'bff')).toEqual({ registry: 'host', instance: 'people-bff-1' })
  const asked: string[] = []
  for (let i = 0; i < 3 && dlg(); i++) { asked.push(dlg()!.getAttribute('aria-label')!); (dlg()!.querySelector('[data-cancel]') as HTMLElement).click(); await settle() }
  expect(asked).toEqual(['Choose rules', 'Choose persons'])
  expect(el.getAttribute('data-unbound')).toBe('rules')
  el.remove(); a.stop()
}, 10_000)
