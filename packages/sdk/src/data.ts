/**
 * Canonical JSON and content digests, the same as kerits' SAIDs.
 *
 * NOTE: copied (the minimal part) from kerits `packages/core/src/common/data.ts` (`Data.digest`, `schemaSaidOf`)
 * and `common/canonical.ts`. Replace with the kerits data library once it is extracted from the monolith; the
 * digests are identical (RFC 8785 canonical JSON, Blake3-256, CESR qb64 with the 'E' code).
 */
import { blake3 } from '@noble/hashes/blake3.js'
import { canonicalize } from 'json-canonicalize'

/** RFC 8785 canonical JSON: sorted keys, minimal whitespace, normalised numbers. */
export const canonical = (value: unknown): string => canonicalize(value)

/** Blake3-256 of `bytes`, CESR-encoded: 'E' + base64url of the digest with one leading pad byte (44 chars). */
export const digest = (bytes: Uint8Array): string => {
  const padded = new Uint8Array(33)
  padded.set(blake3(bytes, { dkLen: 32 }), 1)
  const b64 = btoa(String.fromCharCode(...padded)).replace(/\+/g, '-').replace(/\//g, '_')
  return 'E' + b64.slice(1)
}

/** The digest of a value's canonical JSON. */
export const digestFor = (value: unknown): string => digest(new TextEncoder().encode(canonical(value)))
