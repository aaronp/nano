/**
 * The origin-key example (a case study): the auth example's Passkey / Register, packaged to run `home-origin`: in a
 * frame loaded from this bundle's own page (`frames` in nano.json), so the passkey belongs to the origin it is served
 * from, not to the workspace that imports it. It implements the same `example.auth.Auth`.
 *
 * In that frame, passkeys work unless the origin is opaque or there are no credentials (unlike auth's own check,
 * which refuses in any frame: there, a frame is the host's sandbox, on the host's origin).
 */
import { Coord } from '@pritzlaff/nano-core'
import { passkeyImpl, register } from '../auth/passkey.ts'
import { AuthPasskeyView } from '../auth/view.ts'

/** No passkeys: an opaque origin (a sandbox without its own origin), or no `navigator.credentials`. */
export const homeSandboxed = (g: { location?: { origin?: string }; navigator?: { credentials?: unknown } } = globalThis) => {
  try { return g.location?.origin === 'null' || !g.navigator?.credentials } catch { return true }
}

const ns = Coord.namespace('example.originkey')
const passkey = passkeyImpl(ns.implementationId('passkey'), 'A passkey for the origin this bundle is served from (run it home-origin).', () => homeSandboxed())

export class OriginKeyView extends AuthPasskeyView {
  protected register() { return register('nano origin-key', () => homeSandboxed()) }
}
export const views = { 'example.originkey/passkey': 'origin-key' }
if (!customElements.get('origin-key')) customElements.define('origin-key', OriginKeyView)

export default ns.provider([passkey])
