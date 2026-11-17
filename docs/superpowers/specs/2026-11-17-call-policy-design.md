# One call policy: `Policy.isAllowed`, chosen in `nano.json`; rules are one implementation; exports are a rule

*Proposed 2026-11-17 for the user's review. Comes before the messaging case study (a), whose cross-runtime gateway it
allows. Items marked **(my call)** were mine; the user can overturn them.*

## The user's decisions

- `Policy.isAllowed` is the one signature. Each runtime has one policy.
- `nano.json` has a `policy: { … }` section per runtime, with a **discriminator** choosing a known policy and its
  config: `PolicyRules` (the rules are its state, loaded from that config), `allow-all`, and later others such as a
  `rateLimiter` with its rates as config.
- **`exports` becomes a rule** of `PolicyRules`, not its own field. `allow: *` is one option among many.
- Who may call whom is decided by the policy, not by a structural rule: an edge from a pod in another runtime is
  valid structure, and the policy allows or denies it.

## 1. What a policy is asked: the message's envelope

Today `isAllowed(src, dest, data)` overloads `data`: a call's input, or the strings `'subscribe'` / `'lifecycle'`.
A rule needs more than that (which interface and op, what kind of message, whether the caller is outside), and the
stream already has exactly that envelope: `sent`'s `{ runtime, kind, from, to, port }`. So **(my call)**:

```ts
type Ask = { runtime: string; kind: 'call' | 'pipe' | 'on' | 'subscribe' | 'unsubscribe' | 'lifecycle'
             from: string; to: string; port?: string; outside: boolean; data?: unknown }
type Policy = { isAllowed(ask: Ask): Verdict }   // Verdict unchanged
```

`outside` is true when `from` is not placed in this runtime (the host, or a pod from another runtime). Every place that
asks today (`send`, `connect`, `notifyPodChanges`, `apply`'s new-edge check) passes the envelope it already has.

## 2. In `nano.json`

```jsonc
"backend": {
  "pods": ["store"],
  "subscriptions": [{ "kind": "call", "from": "messaging", "to": "store" }],   // messaging is placed in 'chat'
  "policy": { "kind": "rules", "rules": [
    { "allow": ["call", "subscribe"], "outside": true, "to": "example.kv.KeyValueStore" },   // what 'exports' was
    { "allow": "*", "outside": false },                                                      // inside: anything
    { "deny": "*" }
  ] }
}
```

- `policy.kind` is the discriminator: `"allow-all"` or `"rules"` in this step **(my call: the only two built in; a
  `rateLimiter` and other known kinds come later, with a registry of kinds)**.
- **No `policy`** is `allow-all`, so today's deployments behave as before **(my call)**.

## 3. `PolicyRules`

- A rule: `{ allow | deny: kind | kind[] | "*", from?, to?, outside? }`. `from` matches a pod name or `"host"`; `to`
  matches a pod name, an interface coordinate or a port coordinate (`iface/op`); absent or `"*"` matches anything.
- **First match wins; no match is denied** **(my call)**. A deny's `reason` names the rule (`rules[2]`).
- The rules are data, so they save with the deployment, `apply` can change them (which settles "policies are fixed
  at create"), and the workspace can show them.

## 4. What changes elsewhere

- **`RuntimeDeployment.exports` goes**, and so does `Runtime.create`'s check of it. Every `nano.json` that used
  `exports` moves to a rule (the todo example, the template, the workspace).
- **A call edge's `from` may be placed in another runtime**; `to` must be placed in this one. Calls along it travel
  in this runtime: policed by its policy, on its stream. A pipe's ends both stay in the runtime **(my call)**.
- **The host's `resolve`/`get`** ask the policy (`kind: 'call', from: 'host', outside: true`) instead of reading
  `exports`. A refusal is `denied`, so the FailType `not-exported` goes **(my call: one reason for one thing)**.
- **`Application.create`'s `policies` option** stays, for a policy object written in code, keyed by runtime. A runtime
  given both a code policy and a `policy` in its deployment is `invalid-input` **(my call: no silent precedence)**.

## Proven by

The todo example: `todos` placed in `frontend` only, its edge to `store` listed in `backend`, allowed by a rule.
`frontend` cannot name `store`. A rule change by `apply` cuts the edge, and the next call is `denied` on backend's
stream. Unit tests: rule matching (kinds, `from`, `to` by pod/interface/port, `outside`), first match wins, no match
denies, the discriminator, absent policy is allow-all, both policies is `invalid-input`. All suites, `tsc`, the
structure test and Playwright stay green.

## New public names (for the user's approval)

`Ask` (what `isAllowed` is given); `PolicyRules` (and the rule shape); `RuntimeDeployment.policy` as
`{ kind: 'allow-all' } | { kind: 'rules', rules }`. Removed: `RuntimeDeployment.exports`, FailType `not-exported`,
`policy: 'allow-all'` as a bare string.

## Not in this step

The `rateLimiter` and a registry of known policy kinds; policies made of other policies; validation as a policy; the
load policy (XSS).
