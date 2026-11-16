/**
 * The chat app's deployment, written at the call site (the App Gateway pattern). `backend` holds the store and the
 * Messaging API over it; `chat` holds the participants, which reach only the Messaging API, through edges listed in
 * `backend` and let in by its rules. Nothing in `chat` can name the store.
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
      backend: { pods: [], subscriptions: [], policy: { kind: 'rules', rules: [{ allow: '*', outside: false }, { deny: '*' }] } },
      chat: { pods: [], subscriptions: [] },
    },
    modules: { 'example.kv': '../kv/memory.js', 'example.messaging': './messaging/kv.js', 'example.chat': './room/messaging.js' },
  }, registry)
  d.place(kv.implementations.get(String(kvImpls.memory))!, { pod: 'store', in: 'backend' })
  d.resolve('backend', KeyValueStoreDef.api).create(messagingImpls.kv, { pod: 'messaging', in: 'backend' })
  const gateway = d.resolve('backend', MessagingDef.api)
  gateway.create(chatImpls.participant, { pod: 'alice', in: 'chat' })
  gateway.create(chatImpls.participant, { pod: 'bob', in: 'chat' })
  return d.deployment()
}
