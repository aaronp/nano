/** The auth case study, headless: a fake `navigator.credentials` and `confirm` stand in for the browser. */
import { expect, test } from 'bun:test'
import { Application, AppDeployment, Registry, success, type NanoResult } from '@pritzlaff/nano-core'
import uiProvider from '@pritzlaff/nano-ui'
import { AuthDef } from './contract.ts'
import auth, { setEnv } from './passkey.ts'

const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
const settle = () => new Promise(r => setTimeout(r, 20))
const KEYS = ['ok', 'purpose', 'at', 'credentialId', 'reason']

async function open() {
  const registry = Registry.create()
  must(registry.add(uiProvider)); must(registry.add(auth))
  const app = must(await Application.create(must(AppDeployment.assemble(await Bun.file(new URL('./nano.json', import.meta.url)).json(), registry))))
  return { app, auth: app.runtime('example.auth.main').get(AuthDef.api, { pod: 'auth' }), log: () => app.call('example.auth.main', 'log').entries(null) }
}
function fake(opts: { approve?: boolean; sandboxed?: boolean; get?: () => Promise<unknown> } = {}) {
  const calls = { confirm: 0, get: 0, create: 0 }
  const credentials = {
    get: () => { calls.get++; return opts.get?.() ?? Promise.resolve({ rawId: new Uint8Array([1, 2, 3]).buffer, getClientExtensionResults: () => ({ prf: { results: { first: 'secret' } } }) }) },
    create: () => { calls.create++; return Promise.reject(new Error('unused')) },
  } as unknown as CredentialsContainer
  setEnv({ credentials, sandboxed: opts.sandboxed ?? false, confirm: async () => { calls.confirm++; return opts.approve ?? true } })
  return calls
}

test('approved and a passkey given: ok, with the credential id, and authenticated reaches the log', async () => {
  fake()
  const { auth, log } = await open()
  await log()   // builds the log, and the pipe from auth
  const r = await auth.authenticate('sign in')
  expect(r).toMatchObject({ ok: true, purpose: 'sign in', credentialId: 'AQID' })
  expect(Number.isNaN(Date.parse(r.at))).toBe(false)
  await settle()
  expect(await log()).toEqual(success([r]))
})

test('cancelled at the modal: ok false, reason cancelled, no event, credentials untouched', async () => {
  const calls = fake({ approve: false })
  const { auth, log } = await open()
  await log()
  expect(await auth.authenticate('pay')).toMatchObject({ ok: false, reason: 'cancelled' })
  await settle()
  expect(await log()).toEqual(success([]))
  expect(calls).toEqual({ confirm: 1, get: 0, create: 0 })
})

test('the authenticator refuses: ok false with its error name', async () => {
  fake({ get: () => Promise.reject(new DOMException('no', 'NotAllowedError')) })
  expect(await (await open()).auth.authenticate('sign in')).toMatchObject({ ok: false, reason: 'NotAllowedError' })
})

test('sandboxed: refused without a modal and without touching credentials', async () => {
  const calls = fake({ sandboxed: true })
  expect(await (await open()).auth.authenticate('sign in')).toMatchObject({ ok: false, reason: 'passkeys are not available in a sandbox' })
  expect(calls).toEqual({ confirm: 0, get: 0, create: 0 })
})

test('a second call while one is pending: busy', async () => {
  let release!: (v: unknown) => void
  fake({ get: () => new Promise(r => { release = r }) })
  const { auth } = await open()
  const first = auth.authenticate('one')
  await settle()
  expect(await auth.authenticate('two')).toMatchObject({ ok: false, purpose: 'two', reason: 'busy' })
  release({ rawId: new Uint8Array([9]).buffer })
  expect(await first).toMatchObject({ ok: true })
})

test('no result carries more than ok, purpose, at, credentialId, reason', async () => {
  const results = []
  for (const opts of [{}, { approve: false }, { sandboxed: true }, { get: () => Promise.reject(new DOMException('x', 'AbortError')) }]) {
    fake(opts)
    results.push(await (await open()).auth.authenticate('p'))
  }
  for (const r of results) for (const k of Object.keys(r)) expect(KEYS).toContain(k)
})
