/** The origin-key case study, headless: its pod run in the page (home-origin is the host's to honour), a fake
 * `navigator.credentials` standing in for the browser; and when its passkeys are refused. */
import { expect, test } from 'bun:test'
import { Application, AppDeployment, Registry, success, type NanoResult } from '@pritzlaff/nano-core'
import uiProvider from '@pritzlaff/nano-ui'
import { AuthDef } from '../auth/contract.ts'
import { setEnv } from '../auth/passkey.ts'
import originKey, { homeSandboxed } from './index.ts'

const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
const file = async () => Bun.file(new URL('./nano.json', import.meta.url)).json() as Promise<AppDeployment>

test('nano.json runs it home-origin, from its own frame page', async () => {
  const d = await file()
  expect(d.pods['originKey']!.isolation).toBe('home-origin')
  expect(d.frames).toEqual({ 'example.originkey': './frame.html' })
})

test('passkeys work in a frame with a real origin; an opaque origin or no credentials refuses', () => {
  const creds = { credentials: {} }
  expect(homeSandboxed({ location: { origin: 'https://keys.test' }, navigator: creds })).toBe(false)   // framed or not
  expect(homeSandboxed({ location: { origin: 'null' }, navigator: creds })).toBe(true)
  expect(homeSandboxed({ location: { origin: 'https://keys.test' }, navigator: {} })).toBe(true)
})

test('authenticate signs in with the passkey and authenticated reaches the log (run here, as the frame would)', async () => {
  const credentials = { get: async () => ({ rawId: new Uint8Array([9]).buffer }) } as unknown as CredentialsContainer
  // the fake's `sandboxed` is the auth example's; origin-key asks homeSandboxed, which sees credentials on globalThis
  Object.defineProperty(globalThis, 'navigator', { value: { credentials }, configurable: true })
  setEnv({ credentials, sandboxed: true, confirm: async () => true })
  const registry = Registry.create(); must(registry.add(uiProvider)); must(registry.add(originKey))
  const { isolation: _, ...pod } = (await file()).pods['originKey']!, d = await file()
  const app = must(await Application.create(must(AppDeployment.assemble({ ...d, pods: { ...d.pods, originKey: pod } }, registry))))
  const log = () => app.call('example.originkey.main', 'keyLog').entries(null)
  await log()
  const r = await app.runtime('example.originkey.main').get(AuthDef.api, { pod: 'originKey' }).authenticate('sign in')
  expect(r).toMatchObject({ ok: true, credentialId: 'CQ' })
  await new Promise(res => setTimeout(res, 20))
  expect(await log()).toEqual(success([r]))
})
