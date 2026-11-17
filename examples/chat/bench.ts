/**
 * How a message's cost scales: `alice.say` (chat → messaging → store, two hops plus a published event) in the chat
 * app, alone and with 1,000 extra participants (each a pod, a call edge and a policy rule in `example.chat.backend`). The cost
 * per message should stay flat as the deployment grows: lookups are per deployment, not scans per message.
 *
 *   cd examples && bun chat/bench.ts
 *
 * 2026-11-17, Apple silicon: before the lookups ~31 µs alone, ~277 µs with 1,000; after, ~15 µs either way.
 */
import { Application, AppDeployment, Registry, type NanoResult } from '@pritzlaff/nano-core'
import kv from '../kv/memory.ts'
import { chatDeployment } from './deployment.ts'
import messaging from './messaging/kv.ts'
import { ChatDef } from './room/contract.ts'
import chat from './room/messaging.ts'

const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
const registry = Registry.create()
for (const p of [kv, messaging, chat]) must(registry.add(p))

async function time(label: string, n: number, f: (i: number) => Promise<unknown>) {
  for (let i = 0; i < 200; i++) await f(i)
  const t0 = performance.now()
  for (let i = 0; i < n; i++) await f(i)
  console.log(`${label.padEnd(44)} ${((performance.now() - t0) * 1000 / n).toFixed(1).padStart(7)} µs/message`)
}

for (const extra of [0, 1000]) {
  const d = chatDeployment(registry)
  const policy = d.runtimes['example.chat.backend']!.policy!
  for (let i = 0; i < extra; i++) {
    d.pods[`p${i}`] = { implementation: 'example.chat/participant', eager: false }
    d.runtimes['example.chat.room']!.pods.push(`p${i}`)
    d.runtimes['example.chat.backend']!.subscriptions.push({ kind: 'call', from: `p${i}`, to: 'messaging' })
    if (policy.kind === 'rules') policy.rules.unshift({ allow: ['call', 'subscribe'], from: `p${i}`, outside: true, toInterface: 'example.messaging.Messaging' })
  }
  const app = must(await Application.create(must(AppDeployment.assemble(d, registry))))
  const alice = app.runtime('example.chat.room').get(ChatDef.api, { pod: 'alice' })
  await time(`alice.say, ${extra} extra participants`, 3000, i => alice.say(`m${i}`))
  await app.close()
}
