/**
 * The external signer's contracts: make keys, sign with them, keep them in a vault, and log what happened.
 * Binary values (keys, payloads, signatures) are base64 strings (decision 2).
 *
 *   const g = ctx.one(KeyGenerator)   // success(Selection): g.value.call['create-keys']({ count: 1, purpose: 'login' }) gives { keys: ['<base64 public key>'] }
 *   const s = ctx.one(Signer)         // s.value.call.sign({ publicKey, purpose: 'login', payload }) gives { status: 'signed', signature }
 */
import { Type } from 'typebox'
import { Coord, Schema, Op } from '@pritzlaff/nano-core'

const ns = Coord.namespace('example.signer')

const Base64 = Type.String({ contentEncoding: 'base64' })

export const KeysRequest = Schema.define(Type.Object({ count: Type.Integer({ minimum: 1, maximum: 10 }), purpose: Type.String() }), 'KeysRequest')
export const NewKeys = Schema.define(Type.Object({ keys: Type.Array(Base64) }), 'NewKeys')

export const SignRequest = Schema.define(Type.Object({ publicKey: Base64, purpose: Type.String(), payload: Base64 }), 'SignRequest')
/** Domain outcomes are values: nano only carries them. */
export const SignResult = Schema.define(Type.Union([
  Type.Object({ status: Type.Literal('signed'), signature: Base64 }),
  Type.Object({ status: Type.Literal('denied'), reason: Type.String() }),
  Type.Object({ status: Type.Literal('unknown-key') }),
]), 'SignResult')

export const KeyList = Schema.define(Type.Array(Type.Object({ publicKey: Base64, purpose: Type.String() })), 'KeyList')

export const LogLine = Schema.define(Type.String(), 'LogLine')
export const Done = Schema.define(Type.Null(), 'Done')
export const LogEntries = Schema.define(Type.Array(Type.String()), 'LogEntries')

export const TestRequest = Schema.define(Type.Object({
  purpose: Type.String(),
  payload: Base64,
  /** Sign as another purpose than the key was made for (expect `denied`). */
  signAs: Type.Optional(Type.String()),
}), 'TestRequest')
export const TestResult = Schema.define(Type.Object({ publicKey: Base64, result: SignResult }), 'TestResult')

export const KeyGenerator = ns.interface('KeyGenerator', {
  'create-keys': Op.action(KeysRequest, NewKeys),
})

export const Signer = ns.interface('Signer', {
  sign: Op.action(SignRequest, SignResult),
})

export const Vault = ns.interface('Vault', {
  /** Makes key pairs inside the vault; only the public keys come out. */
  create: Op.action(KeysRequest, NewKeys),
  'sign-with': Op.action(SignRequest, SignResult),
  /** Published after each `create`: the keys just made. */
  keys: Op.event(KeyList),
})

export const Log = ns.interface('Log', {
  append: Op.action(LogLine, Done),
  /** Published after each `append`: every entry so far. */
  entries: Op.event(LogEntries),
})

/** Turns the vault's `keys` into log lines. */
export const KeyFormatter = ns.interface('KeyFormatter', {
  format: Op.action(KeyList, Done),
  line: Op.event(LogLine),
})

/** The tester widget's button: make a key for a purpose, sign a payload with it. */
export const Tester = ns.interface('Tester', {
  test: Op.action(TestRequest, TestResult),
})
