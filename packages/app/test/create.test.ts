import { expect, test } from 'bun:test'
import { Ops } from '@pritzlaff/nano-core'
import { catalog as bundle } from '@composable/bundle'
import { ApplicationOps as P } from '../src/application'
import { createApplication } from '../src/create'
import type { AppCatalog } from '../src/catalog'

const ask = (host: any, op: any, arg: unknown) => host.call({ registry: 'host', instance: 'test' }, 'application', Ops.key(op), arg)

test('createApplication registers app and application in host', () => {
  const { host, catalog } = createApplication({ catalogs: [bundle as AppCatalog] })
  expect(host.registry.id).toBe('host')
  expect(host.registry.get('app')).toBeTruthy()
  expect(host.registry.get('application')).toBeTruthy()
  expect(Object.keys(catalog)).toEqual(Object.keys(bundle))
})

test('the default deploy makes a component in its system', async () => {
  const { host } = createApplication({ catalogs: [bundle as AppCatalog] })
  expect(await ask(host, P.createComponent, { kind: 'log', name: 'l1', system: 'host' })).toEqual({ value: undefined })
  expect(host.registry.get('l1')).toBeTruthy()
  expect((await ask(host, P.createComponent, { kind: 'log', name: 'l2', system: 'host', mode: 'sandbox' })).error).toContain("can't be deployed as sandbox")
})

test('catalog is one object that later additions grow', async () => {
  const { host, catalog } = createApplication({ catalogs: [{ log: bundle.log as any }] })
  catalog.range = bundle.range as any
  expect(await ask(host, P.createComponent, { kind: 'range', name: 'r1', system: 'host' })).toEqual({ value: undefined })
})
