// The auth example's module: its provider (default export) and its view, by implementation.
import { AuthPasskeyView } from './view.ts'

export { default } from './passkey.ts'
export const views = { 'example.auth/passkey': 'auth-passkey' }

if (!customElements.get('auth-passkey')) customElements.define('auth-passkey', AuthPasskeyView)
