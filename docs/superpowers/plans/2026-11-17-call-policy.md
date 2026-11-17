# Call Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One `Policy.isAllowed(ask)` per runtime, chosen in `nano.json` by `policy.kind` (`allow-all` or `rules`).
`PolicyRules` is one implementation. `exports` becomes a rule, and call edges may come from pods in other runtimes.

**Architecture:** `refusal` in `application/messages.ts` is the one place that asks. It builds the `Ask` from the
message's envelope and finds the runtime's policy from the deployment as it is now (so `apply` changes it), or from
`create`'s `policies` option. Every caller already has the envelope.

**Tech Stack:** Bun, TypeScript, TypeBox.

**Spec:** `docs/superpowers/specs/2026-11-17-call-policy-design.md`

## Global Constraints

- CLAUDE.md: no exported name beyond the spec's "New public names". Files stay ≤150 lines and exported object types
  ≤10 members, and every export is in `design.md`. `packages/nano/structure-baseline.json` may only shrink.
- `Ask = { runtime; kind: 'call' | 'pipe' | 'on' | 'subscribe' | 'unsubscribe' | 'lifecycle'; from; to; port?; outside; data? }`.
  `Verdict` is unchanged.
- No `policy` in a runtime means allow-all. With `rules`, the first match wins and no match is denied with reason `no rule allows it`.
  A deny rule's reason is `rules[<index>]`.
- A runtime that has both a code policy (the `create` option) and a `policy` in its deployment is `invalid-input`.
- Tests: `cd packages/nano && bun test --isolate`; `cd packages/ui && bun test --isolate`;
  `cd packages/ui-workspace && bun test --isolate && bun run build`; `cd examples && bun test --isolate`;
  `cd templates/nano-template && bun test`; root `bunx tsc --noEmit`; `bunx playwright test` (outside the sandbox).
  Never a bare root `bun test`; never `git add -A` at the root. Never commit through `templates/nano-template`'s nested `.git`.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A pod placed in two runtimes calling out:** `outside` is computed for the runtime the message travels in, not for wherever else the pod is placed. Task 3's test.
2. **`apply` changing a runtime's rules:** the next call is decided by the new rules, and live subscriptions are asked again. Task 2's test.
3. **A pipe from a pod outside the runtime:** refused by `Runtime.create` (pipes stay inside). Task 3's test.
4. **The host's `get` of a denied interface:** `denied` at the call, and nothing leaks about what is placed there. Task 4's test.
5. **A rule `to` matching by interface coordinate** also matches every port of that interface, and by port only that op. Task 2's test.

---

### Task 1: `isAllowed(ask)`: the envelope

**Files:** `packages/nano/src/policy.ts` (`Ask`, `Policy`); `packages/nano/src/application/messages.ts` (`refusal(live, ask: Omit<Ask, 'outside'>)` computes `outside`: `from` is `'host'` or not placed in `ask.runtime`); its callers in `messages.ts` (`send`), `connection.ts`, `pod-changes.ts`, `index.ts` (new-edge and re-ask checks); the custom policies in the test files listed under Global Constraints and `examples/todo/subscriptions.test.ts`; `design.md`.

- [ ] Failing test in `packages/nano/test/policy.test.ts`: `'isAllowed is asked with the envelope'`. A recording policy sees, for a host call, `{ runtime: 'r', kind: 'call', from: 'host', to: 'db', port: '<iface>/save', outside: true, data: 'x' }`; for a pod's `on`, `kind: 'subscribe'` with `outside: false`; for a pod change, `kind: 'lifecycle'`.
- [ ] Implement, and move every test policy to `isAllowed(ask)` (`data === 'subscribe'` becomes `ask.kind === 'subscribe'`).
- [ ] All suites and tsc green. Commit `refactor(nano)!: Policy.isAllowed(ask) is given the message's envelope`.

### Task 2: `PolicyRules` and `RuntimeDeployment.policy`

**Files:**
- `packages/nano/src/policy.ts`: `PolicyRules(rules): Policy`, `Rule` and its TypeBox schema. If the file would pass 150 lines, put the rules in `src/policy-rules.ts`.
- `packages/nano/src/runtime.ts`: `policy?: { kind: 'allow-all' } | { kind: 'rules'; rules: Rule[] }` in the type and the schema. The bare `'allow-all'` string goes.
- `packages/nano/src/application/messages.ts`: `refusal` uses the deployment's policy now. `create` and `apply` refuse a runtime that has both kinds of policy.
- `design.md`.

- [ ] Failing tests in `packages/nano/test/policy-rules.test.ts`:
  - kinds: one kind, a list, `'*'`;
  - `from`: a pod or `'host'`;
  - `to`: a pod, an interface coordinate (which matches all its ports) or a port coordinate (which matches only that op);
  - `outside`;
  - first match wins; no match denies with `no rule allows it`; a deny's reason is `rules[i]`.
- [ ] Failing tests in `pods-runtimes` style:
  - `policy: { kind: 'rules' }` in a deployment governs calls;
  - `apply` with changed rules governs the next call and asks live subscriptions again;
  - no policy is allow-all;
  - code plus data policy is `invalid-input`;
  - the deployment round-trips through `deployment()`.
- [ ] Implement. All suites and tsc green. Commit `feat(nano): PolicyRules; a runtime's policy is data in its deployment`.

### Task 3: Call edges from another runtime

**Files:**
- `packages/nano/src/runtime.ts`: a `call` edge's `from` must be a pod in the `Pods` scope, not necessarily placed here; `to` is placed here. A `pipe`'s ends both stay placed here.
- `packages/nano/src/application/context.ts`: a pod's selections cover every runtime holding a call edge from it, not only the runtimes it is placed in. Use one helper beside `placedIn` in `messages.ts`, `wiredFrom(live, pod)`.
- `packages/nano/src/application/compose.ts` / `pods.ts`, if they assume placement.
- `design.md`.

- [ ] Failing tests:
  - a pod in `chat` with an edge listed in `backend` calls `store`; the call is `sent` with `runtime: 'backend'`, asked with `outside: true`, and shows on backend's stream, not chat's;
  - a pipe from outside is refused by `Runtime.create`;
  - a pod placed in two runtimes is `outside: false` only where it is placed.
- [ ] Implement. All suites and tsc green. Commit `feat(nano): a call edge may come from a pod in another runtime; its calls travel where the edge is`.

### Task 4: `exports` becomes a rule

**Files:**
- `packages/nano/src/runtime.ts`: remove `exports` and its check.
- `packages/nano/src/application/resolve.ts`: `placement` drops `offered`; the host's `resolve`/`get`/`subscribe`/`call` ask the policy through `refusal` (`kind: 'call'` or `'subscribe'`, `from: 'host'`). A refusal is `denied`.
- `packages/nano/src/application/emit.ts`: `client` drops `offered` and `not-exported`.
- `packages/nano/src/result.ts`: drop `not-exported`.
- `listen.ts` and `pod-changes.ts`, if they read `exports`.
- Every `nano.json`, test and doc using `exports` or `not-exported`.
- `design.md`.

- [ ] Rewrite the existing `exports` tests as rules: `{ allow: ['call','subscribe'], outside: true, to: '<iface>' }, { allow: '*', outside: false }, { deny: '*' }`. A host `get` of an interface the rules don't allow throws `denied`.
- [ ] Implement. `git grep -n "exports\|not-exported" -- packages examples templates` shows only the npm `exports` in `package.json` files. All suites, tsc and Playwright green.
- [ ] Commit `refactor(nano)!: exports is a PolicyRules rule; not-exported is denied`.

### Task 5: The todo case study on it

**Files:** `examples/todo/nano.json` (`todos` in `frontend` only; `backend` lists the edge `todos → store` and rules allowing it from outside); `examples/todo/*.test.ts`.

- [ ] Failing test in `todo.test.ts`: `'2. the runtime: todos lives in frontend; its store calls travel in backend, allowed by backend\'s rules'`. Every `todos → store` `sent` has `runtime: 'backend'`. Then `apply` with a rule denying `todos` makes the next `add` throw `denied`, and backend's stream shows the `denied`.
- [ ] Update the existing todo tests that assumed `todos` was placed in `backend`. All suites, tsc and Playwright green.
- [ ] Commit `feat(examples): todo's store is reached across runtimes through backend's policy`.
