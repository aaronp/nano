/**
 * The external signer's contracts: make keys, sign with them, keep them in a vault, and log what happened.
 * Binary values (keys, payloads, signatures) are base64 strings (decision 2).
 *
 *   ctx.one(KeyGenerator, g => g['create-keys']({ count: 1, purpose: 'login' }))   // { keys: ['<base64 public key>'] }
 *   ctx.one(Signer, s => s.sign({ publicKey, purpose: 'login', payload }))          // { status: 'signed', signature }
 */
import { Type } from 'typebox'
import { defineSchema, iface, op } from '@pritzlaff/nano'

const Base64 = Type.String({ contentEncoding: 'base64' })

export const KeysRequest = defineSchema('KeysRequest', Type.Object({ count: Type.Integer({ minimum: 1, maximum: 10 }), purpose: Type.String() }))
export const NewKeys = defineSchema('NewKeys', Type.Object({ keys: Type.Array(Base64) }))

export const SignRequest = defineSchema('SignRequest', Type.Object({ publicKey: Base64, purpose: Type.String(), payload: Base64 }))
/** Domain outcomes are values: nano only carries them. */
export const SignResult = defineSchema('SignResult', Type.Union([
  Type.Object({ status: Type.Literal('signed'), signature: Base64 }),
  Type.Object({ status: Type.Literal('denied'), reason: Type.String() }),
  Type.Object({ status: Type.Literal('unknown-key') }),
]))

/** Key pairs handed to the vault: a raw public key and a PKCS#8 private key. */
export const StoreRequest = defineSchema('StoreRequest', Type.Object({
  purpose: Type.String(),
  keys: Type.Array(Type.Object({ publicKey: Base64, privateKey: Base64 })),
}))
export const Stored = defineSchema('Stored', Type.Object({ stored: Type.Integer() }))
export const KeyList = defineSchema('KeyList', Type.Array(Type.Object({ publicKey: Base64, purpose: Type.String() })))

export const LogLine = defineSchema('LogLine', Type.String())
export const LogEntries = defineSchema('LogEntries', Type.Array(Type.String()))

export const TestRequest = defineSchema('TestRequest', Type.Object({
  purpose: Type.String(),
  payload: Base64,
  /** Sign as another purpose than the key was made for (expect `denied`). */
  signAs: Type.Optional(Type.String()),
}))
export const TestResult = defineSchema('TestResult', Type.Object({ publicKey: Base64, result: SignResult.schema }))

export const KeyGenerator = iface('example.signer.KeyGenerator', {
  'create-keys': op.action('create-keys', KeysRequest, NewKeys),
})

export const Signer = iface('example.signer.Signer', {
  sign: op.action('sign', SignRequest, SignResult),
})

export const Vault = iface('example.signer.Vault', {
  store: op.action('store', StoreRequest, Stored),
  'sign-with': op.action('sign-with', SignRequest, SignResult),
  /** Published after each `store`: the keys just stored. */
  keys: op.source('keys', KeyList),
})

export const Log = iface('example.signer.Log', {
  append: op.sink('append', LogLine),
  /** Published after each `append`: every entry so far. */
  entries: op.source('entries', LogEntries),
})

/** Turns the vault's `keys` into log lines. */
export const KeyFormatter = iface('example.signer.KeyFormatter', {
  format: op.sink('format', KeyList),
  line: op.source('line', LogLine),
})

/** The tester widget's button: make a key for a purpose, sign a payload with it. */
export const Tester = iface('example.signer.Tester', {
  test: op.action('test', TestRequest, TestResult),
})
