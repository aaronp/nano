/**
 * `example.auth/passkey`: a passkey behind a modal. Headless: no lit; the default `confirm` builds a plain `<dialog>`
 * only when called. In a sandbox (opaque origin, any frame, or no `navigator.credentials`) it refuses without a modal.
 */
import { AuthDef } from './contract.ts'

type Result = AuthDef.Result
/** Example-only: what the pod reaches outside nano; tests replace it with `setEnv`. */
export type Env = { credentials?: CredentialsContainer; sandboxed: boolean; confirm(purpose: string, caller: string): Promise<boolean> }

function ask(purpose: string, caller: string): Promise<boolean> {
  const d = document.createElement('dialog'), p = document.createElement('p')
  p.textContent = `${caller} wants to ${purpose} — Authenticate with passkey?`
  const button = (label: string, value: boolean) => {
    const b = document.createElement('button'); b.textContent = label; b.onclick = () => { d.close(); done(value) }; return b
  }
  let done!: (v: boolean) => void
  const answer = new Promise<boolean>(r => { done = r })
  d.append(p, button('Approve', true), button('Cancel', false))
  d.oncancel = () => done(false)
  document.body.append(d)
  d.showModal()
  return answer.finally(() => d.remove())
}

/** Example-only: opaque origin, any frame (the workspace's sandbox keeps its origin), or no credentials. */
export function detectSandboxed(g: { location?: { origin?: string }; navigator?: { credentials?: unknown }; top?: unknown; self?: unknown }) {
  try { return g.location?.origin === 'null' || g.top !== g.self || !g.navigator?.credentials } catch { return true }
}

let env: Env = {
  get sandboxed() { return detectSandboxed(globalThis) },
  get credentials() { return globalThis.navigator?.credentials },
  confirm: ask,
}
export function setEnv(e: Env) { env = e }

const b64url = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const challenge = () => crypto.getRandomValues(new Uint8Array(32))
const SANDBOX = 'passkeys are not available in a sandbox'

/** Runs one ceremony; only ok, purpose, at, credentialId and reason leave it. */
async function ceremony(purpose: string, run: (c: CredentialsContainer) => Promise<Credential | null>): Promise<Result> {
  const at = () => new Date().toISOString()
  if (env.sandboxed || !env.credentials) return { ok: false, purpose, at: at(), reason: SANDBOX }
  try {
    const c = await run(env.credentials) as PublicKeyCredential | null
    return c ? { ok: true, purpose, at: at(), credentialId: b64url(c.rawId) } : { ok: false, purpose, at: at(), reason: 'no credential' }
  } catch (e) { return { ok: false, purpose, at: at(), reason: (e as Error)?.name ?? 'Error' } }
}

/** Example-only: the view's Register button, a new passkey (no modal: the click is the user's). */
export const register = (rpName = 'nano examples') => ceremony('register', c => c.create({ publicKey: {
  challenge: challenge(), rp: { name: rpName }, user: { id: challenge(), name: 'nano', displayName: 'nano' },
  pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }], authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },   // discoverable: Passkey's get names no credential
} }))

const passkey = AuthDef.api.impl(AuthDef.ns.implementationId('passkey'))
  .description('Asks the user, in a modal, for a passkey; refuses in a sandbox.')
  .make(() => {
    const listeners = new Set<(r: Result) => void>()
    let pending = false
    return {
      async authenticate(purpose) {
        if (pending) return { ok: false, purpose, at: new Date().toISOString(), reason: 'busy' }
        if (env.sandboxed) return ceremony(purpose, async () => null)
        pending = true
        try {
          // ponytail: the caller's pod is not visible to an action handler, so the modal names no one in particular
          let approved: boolean
          try { approved = await env.confirm(purpose, 'A pod') } catch (e) { return { ok: false, purpose, at: new Date().toISOString(), reason: (e as Error)?.name ?? 'Error' } }
          if (!approved) return { ok: false, purpose, at: new Date().toISOString(), reason: 'cancelled' }
          const r = await ceremony(purpose, c => c.get({ publicKey: { challenge: challenge(), userVerification: 'preferred' } }))
          if (r.ok) for (const l of listeners) l(r)
          return r
        } finally { pending = false }
      },
      async *authenticated() {   // a source fed by a queue, one per subscriber
        const queue: Result[] = []
        let wake: (() => void) | undefined
        const push = (r: Result) => { queue.push(r); wake?.() }
        listeners.add(push)
        try {
          for (;;) {
            while (queue.length) yield queue.shift()!
            await new Promise<void>(r => { wake = r })
          }
        } finally { listeners.delete(push) }
      },
    }
  })

export default AuthDef.ns.provider([passkey])
