/**
 * The external signer's contracts: make keys, sign with them, keep them in a vault, and log what happened.
 * Binary values (keys, payloads, signatures) are base64 strings (decision 2).
 *
 *   const g = ctx.one(KeyGenerator)   // success(Selection): g.value.call['create-keys']({ count: 1, purpose: 'login' }) gives { keys: ['<base64 public key>'] }
 *   const s = ctx.one(Signer)         // s.value.call.sign({ publicKey, purpose: 'login', payload }) gives { status: 'signed', signature }
 */
import { Type } from 'typebox'
import { Schema, Interface, Op } from '@pritzlaff/nano-core'

const Base64 = Type.String({ contentEncoding: 'base64' })

export const KeysRequest = Schema.define('KeysRequest', Type.Object({ count: Type.Integer({ minimum: 1, maximum: 10 }), purpose: Type.String() }))
export const NewKeys = Schema.define('NewKeys', Type.Object({ keys: Type.Array(Base64) }))

export const SignRequest = Schema.define('SignRequest', Type.Object({ publicKey: Base64, purpose: Type.String(), payload: Base64 }))
/** Domain outcomes are values: nano only carries them. */
export const SignResult = Schema.define('SignResult', Type.Union([
  Type.Object({ status: Type.Literal('signed'), signature: Base64 }),
  Type.Object({ status: Type.Literal('denied'), reason: Type.String() }),
  Type.Object({ status: Type.Literal('unknown-key') }),
]))

export const KeyList = Schema.define('KeyList', Type.Array(Type.Object({ publicKey: Base64, purpose: Type.String() })))

export const LogLine = Schema.define('LogLine', Type.String())
export const Done = Schema.define('Done', Type.Null())
export const LogEntries = Schema.define('LogEntries', Type.Array(Type.String()))

export const TestRequest = Schema.define('TestRequest', Type.Object({
  purpose: Type.String(),
  payload: Base64,
  /** Sign as another purpose than the key was made for (expect `denied`). */
  signAs: Type.Optional(Type.String()),
}))
export const TestResult = Schema.define('TestResult', Type.Object({ publicKey: Base64, result: SignResult.schema }))

export const KeyGenerator = Interface.define('example.signer.KeyGenerator', {
  'create-keys': Op.action('create-keys', KeysRequest, NewKeys),
})

export const Signer = Interface.define('example.signer.Signer', {
  sign: Op.action('sign', SignRequest, SignResult),
})

export const Vault = Interface.define('example.signer.Vault', {
  /** Makes key pairs inside the vault; only the public keys come out. */
  create: Op.action('create', KeysRequest, NewKeys),
  'sign-with': Op.action('sign-with', SignRequest, SignResult),
  /** Published after each `create`: the keys just made. */
  keys: Op.event('keys', KeyList),
})

export const Log = Interface.define('example.signer.Log', {
  append: Op.action('append', LogLine, Done),
  /** Published after each `append`: every entry so far. */
  entries: Op.event('entries', LogEntries),
})

/** Turns the vault's `keys` into log lines. */
export const KeyFormatter = Interface.define('example.signer.KeyFormatter', {
  format: Op.action('format', KeyList, Done),
  line: Op.event('line', LogLine),
})

/** The tester widget's button: make a key for a purpose, sign a payload with it. */
export const Tester = Interface.define('example.signer.Tester', {
  test: Op.action('test', TestRequest, TestResult),
})
