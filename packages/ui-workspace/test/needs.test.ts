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
const { shownInstance } = await import('../src/lib/dock-layout')
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
  // the reading is taken when the instance is added: settling after the apply is over still asks nothing
  await whileApplying(() => a.call('application', P.createComponent, { kind: 'person-form', name: 'f2', system: 'app' }))
  await settle()
  expect(dlg()).toBeNull()
  a.stop()
}, 10_000)

/** Clicks `sel` in the open dialog, then lets the next one open; returns the label of the dialog clicked in. */
const answer = async (sel: string) => {
  const d = dlg()!, label = d.getAttribute('aria-label')!
  const b = d.querySelector(sel) as HTMLElement | null
  if (!b) throw new Error(`${label}: no ${sel} in ${d.innerHTML}`)
  b.click(); await settle()
  return label
}

test('a new form asks for each need; cancelled it is disabled; making one asks for its own needs first', async () => {
  const a = setup()
  definePeople()
  provide(document, a.host.registry)
  // shaped like a dock panel: the element is the container's first child
  document.body.insertAdjacentHTML('beforeend', '<div class="lm_content"><c-person-form name="f1"></c-person-form></div>')
  const panel = document.body.lastElementChild!, el = panel.firstElementChild!
  await settle()
  expect(dlg()?.getAttribute('aria-label')).toBe('Choose bff')
  expect([...dlg()!.querySelectorAll('[data-make]')].map(b => b.getAttribute('data-make'))).toEqual(['people-bff'])
  expect([await answer('[data-cancel]'), await answer('[data-cancel]')]).toEqual(['Choose bff', 'Choose rules'])
  expect(dlg()).toBeNull()
  expect(el.getAttribute('data-unbound')).toBe('bff,rules')
  expect(el.hasAttribute('inert')).toBe(true)
  expect(el.hasAttribute('data-needs')).toBe(true)
  const button = el.nextElementSibling as HTMLButtonElement
  expect(button.textContent).toBe('Needs bff, rules — Choose…')
  expect(button.closest('[inert]')).toBeNull()
  // the overlay doesn't hide the panel's instance from the dock
  expect(shownInstance(panel.firstElementChild as never)).toBe('f1')
  // Choose…: make a bff; its own need is asked next, before the form's rules; cancelling it leaves the form's bff unbound
  button.click(); await settle()
  expect([await answer('[data-make="people-bff"]'), await answer('[data-cancel]'), await answer('[data-cancel]')]).toEqual(['Choose bff', 'Choose persons', 'Choose rules'])
  expect(dlg()).toBeNull()
  expect(a.host.registry.get('people-bff-1')).toBeDefined()
  expect(a.host.registry.binding('f1', 'bff')).toBeUndefined()
  expect(el.getAttribute('data-unbound')).toBe('bff,rules')
  // a made provider with no needs binds at once
  button.click(); await settle()
  expect([await answer('[data-cancel]'), await answer('[data-make="person-rules"]')]).toEqual(['Choose bff', 'Choose rules'])
  expect(a.host.registry.binding('f1', 'rules')).toEqual({ registry: 'host', instance: 'person-rules-1' })
  expect(el.getAttribute('data-unbound')).toBe('bff')
  a.stop()
  expect(el.hasAttribute('data-unbound') || el.hasAttribute('inert') || !!el.nextElementSibling).toBe(false)
  panel.remove()
}, 10_000)

test('Dependencies drills into a bound target, where Replace… makes a provider depth first and binds it', async () => {
  const a = setup()
  await whileApplying(async () => {
    await a.call('application', P.createComponent, { kind: 'people-bff', name: 'b', system: 'host' })
    await a.call('application', P.createComponent, { kind: 'person-form', name: 'f', system: 'host' })
    await a.call('application', P.bindNeed, { ref: 'instance:host/f', need: 'bff', to: 'instance:host/b' })
  })
  await settle()
  expect(dlg()).toBeNull()
  document.dispatchEvent(new CustomEvent('dock:dependencies', { detail: { system: 'host', instance: 'f' } })); await settle()
  expect(dlg()?.querySelector('th:last-child')?.textContent).toBe('Replace')
  const asked = [await answer('[data-open="instance:host/b"]'), await answer('[data-replace="persons"]'), await answer('[data-make="person-service"]'),
    await answer('[data-make="people-db"]'), await answer('[data-make="person-rules"]')]
  expect(asked).toEqual(['Dependencies', 'Dependencies', 'Choose persons', 'Choose db', 'Choose rules'])
  expect(dlg()).toBeNull()
  expect(a.host.registry.binding('b', 'persons')).toEqual({ registry: 'host', instance: 'person-service-1' })
  expect(a.host.registry.binding('person-service-1', 'db')).toEqual({ registry: 'host', instance: 'people-db-1' })
  a.stop()
}, 10_000)

test('a binding to a removed provider marks the consumer unbound, and its Dependencies row says missing', async () => {
  const a = setup()
  definePeople()
  provide(document, a.host.registry)
  await whileApplying(async () => {
    await a.call('application', P.createComponent, { kind: 'people-bff', name: 'b', system: 'host' })
    await a.call('application', P.createComponent, { kind: 'person-rules', name: 'r', system: 'host' })
    await a.call('application', P.createComponent, { kind: 'person-form', name: 'f', system: 'host' })
    await a.call('application', P.bindNeed, { ref: 'instance:host/f', need: 'bff', to: 'instance:host/b' })
    await a.call('application', P.bindNeed, { ref: 'instance:host/f', need: 'rules', to: 'instance:host/r' })
  })
  document.body.insertAdjacentHTML('beforeend', '<div class="lm_content"><c-person-form name="f"></c-person-form></div>')
  const panel = document.body.lastElementChild!, el = panel.firstElementChild!
  await settle()
  expect(el.hasAttribute('data-unbound')).toBe(false)
  await a.call('application', P.removeFromSystem, { instance: 'b', system: 'host' }); await settle()
  expect(a.host.registry.binding('f', 'bff')).toEqual({ registry: 'host', instance: 'b' })   // core keeps it
  expect(el.getAttribute('data-unbound')).toBe('bff')
  expect(el.hasAttribute('inert')).toBe(true)
  // its Choose… asks for it
  ;(el.nextElementSibling as HTMLButtonElement).click(); await settle()
  expect(await answer('[data-cancel]')).toBe('Choose bff')
  document.dispatchEvent(new CustomEvent('dock:dependencies', { detail: { system: 'host', instance: 'f' } })); await settle()
  const row = [...dlg()!.querySelectorAll('tbody tr')].find(tr => tr.firstElementChild?.textContent === 'bff')!
  expect(row.textContent).toContain('missing')
  expect(row.querySelector('[data-open]')).toBeNull()
  await answer('[data-cancel]')
  a.stop(); panel.remove()
}, 10_000)
