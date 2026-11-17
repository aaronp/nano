/**
 * The chat app's deployment, written at the call site (the App Gateway pattern). `example.chat.backend` holds the store and the
 * Messaging API over it; `example.chat.room` holds the participants, which reach only the Messaging API, through edges listed in
 * `example.chat.backend` and let in by its rules. Nothing in `example.chat.room` can name the store.
 *
 *   const d = chatDeployment(registry)   // the AppDeployment: nano.json, assemble, create or apply
 */
import { AppDeployment, type Registry } from '@pritzlaff/nano-core'
import { KeyValueStoreDef } from '../kv/contract.ts'
import kv, { impls as kvImpls } from '../kv/memory.ts'
import { MessagingDef } from './messaging/contract.ts'
import { impls as messagingImpls } from './messaging/kv.ts'
import { impls as chatImpls } from './room/messaging.ts'

export function chatDeployment(registry: Registry): AppDeployment {
  const d = AppDeployment.edit({
    pods: {},
    runtimes: {
      'example.chat.backend': { pods: [], subscriptions: [], policy: { kind: 'rules', rules: [{ allow: '*', outside: false }, { deny: '*' }] } },
      'example.chat.room': { pods: [], subscriptions: [] },
    },
    modules: { 'example.kv': '../kv/memory.js', 'example.messaging': './messaging/kv.js', 'example.chat': './room/messaging.js' },
  }, registry)
  d.place(kv.implementations.get(String(kvImpls.memory))!, { pod: 'store', in: 'example.chat.backend' })
  d.resolve('example.chat.backend', KeyValueStoreDef.api).create(messagingImpls.kv, { pod: 'messaging', in: 'example.chat.backend' })
  const gateway = d.resolve('example.chat.backend', MessagingDef.api)
  gateway.create(chatImpls.participant, { pod: 'alice', in: 'example.chat.room' })
  gateway.create(chatImpls.participant, { pod: 'bob', in: 'example.chat.room' })
  return d.deployment()
}
