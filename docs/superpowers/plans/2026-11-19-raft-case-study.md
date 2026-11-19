# Raft Case Study Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A raft.github.io-style Raft cluster, installed from File › Examples, that a pod deploys through the host
and that the time machine and a new generic Ring view can pause, slow and scrub, with the state at the cursor.

**Architecture:**
- **Every piece of logic is a pure, headless-tested module; views only display it** (the user's rule for this plan).
  - The Raft state machine is `step(node, input) → { node, effects }`, tested by a pure simulator without nano.
  - The Ring layout, the dots and the live/past choice are pure functions.
  - HostDeploy's edits and approval summary are pure functions.
  - Each view's model is a pure function of data.
- **nano-core gains one thing:** an application deployment policy with `apply`'s `caller`.
- **Order:** HostDeploy (Tasks 1–3), then the Ring view (Task 4), then Raft (Tasks 5–9).

**Tech Stack:** TypeScript, bun test (`--isolate`), happy-dom, Lit, TypeBox, nano-core, nano-ui, ui-workspace.

**Spec:** `docs/superpowers/specs/2026-11-19-raft-case-study-design.md`. Decisions: `adr/decisions.md`
(ADR-0010, ADR-0015).

## Global Constraints

- **Size:** files at most 150 lines. The structure test also limits an exported interface or object type to 10 members.
- **nano-core:** its only change is the deployment policy (`DeploymentPolicy`, `DeploymentPolicies`), `apply`'s
  `caller` and `applied`'s `caller`. Each name goes in `design.md`.
- **nano-ui exports:**
  - `HostDeploy` and the Ring element (with its `defineViews` registration) are the only new ones, each recorded in
    `design.md`;
  - the workspace's and the example's helpers stay internal to them.
- **Constants, not strings:** ops are named by their constants and `port(...)`, never by duplicated coordinate strings.
- **No hidden time:** Raft pods use only the wired clock and random, with no `setTimeout`, `Date.now` or `Math.random`.
- **Headless first:** every behaviour is proven by a data-only test. happy-dom tests only check that a view renders its
  model and that its buttons call the right ops.
- **Raft defaults:**
  - election timeout uniform in 150–300 ms (sim time);
  - heartbeat every 50 ms;
  - messaging latency uniform in 10–30 ms;
  - cluster sizes 3 or 5;
  - seed default 1.
- **Tests:** `cd packages/nano && bun test --isolate`; `cd packages/ui && bun test --isolate`;
  `cd packages/ui-workspace && bun test --isolate`; `cd examples && bun test --isolate`; `bunx tsc --noEmit` at the
  root. Never a bare `bun test` at the root.
- **Commits:** on `dev-raft`, each ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A cluster name that partly exists:** with `example-2` already a runtime, `deploy` of `example-1..3` changes
   nothing and answers `invalid-input` naming `example-2` (Task 3).
2. **A stopped majority:** with 2 of 3 nodes stopped, no leader is elected and no request commits. After a resume, a
   leader is elected and commits resume (Task 5).
3. **Scrubbing a history too long to rebuild:** the views stay live and the Ring says "history too long to rebuild
   state". Nothing throws (Task 4).
4. **A request with no leader known, or to a stopped node,** is refused with a reason, `no leader known` or `stopped`,
   and the ledger is unchanged (Task 5).
5. **Removing a cluster while messages to it are in flight:** a delivery to a missing runtime is dropped quietly, with
   no failure on the sender and no throw (Task 6).

---

### Task 1: nano-core — the application's deployment policy and `apply`'s caller

**Files:**
- Modify:
  - `packages/nano/src/policy.ts`, or create `packages/nano/src/deployment-policy.ts` if `policy.ts` would pass 150
    lines;
  - `packages/nano/src/application/index.ts`: `Opts`, `apply`;
  - `packages/nano/src/application/stream.ts`: `applied` gains `caller`;
  - `packages/nano/src/application/listen.ts`: keep `caller` when narrowing;
  - `packages/nano/src/index.ts`;
  - `design.md`;
  - `packages/nano/structure-baseline.json`, only if the structure test requires it. It may only shrink.
- Test: `packages/nano/test/deployment-policy.test.ts`.

**Interfaces:**
- Produces:
  ```ts
  export type DeploymentAsk = { caller: string; deployment: AppDeployment }   // caller: 'host' or a pod name
  export type DeploymentPolicy = { isAllowed(ask: DeploymentAsk): Verdict | Promise<Verdict> }
  export const DeploymentPolicies: { allowAll(): DeploymentPolicy }
  // Application.create(runtimes, { …, deploymentPolicy?: DeploymentPolicy })   absent = allowAll
  // app.apply(next, opts?: { caller?: string }): Promise<NanoResult<void>>      caller default 'host'
  // AppEvent { type: 'applied'; caller: string; added; removed; changed; rewired }
  ```
- **A refusal:** `apply` answers a `failure` of type `'denied'` with the verdict's `reason`. Nothing changes, and no
  `applied` is emitted.

- [ ] **Step 1: Write the failing tests:**
  - `absent policy: apply works as before and applied.caller is 'host'`;
  - `allowAll: same`;
  - `a refusing policy: apply is denied with its reason, the deployment is unchanged, no applied event`;
  - `the policy hears caller and the next deployment`: `apply(next, { caller: 'grower' })` makes the policy's ask
    `{ caller: 'grower', deployment: next }`, and `applied.caller === 'grower'`;
  - `an async policy is awaited`.
- [ ] **Step 2:** Run `cd packages/nano && bun test --isolate test/deployment-policy.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. The policy is asked before any instance changes. Add one line per new name to
  `design.md`'s core table, beside `Policy`.
- [ ] **Step 4:** Run all four suites and `tsc`. Expected: PASS, including `structure.test.ts`.
- [ ] **Step 5:** Commit `feat(core): an application deployment policy; apply takes and records its caller`.

### Task 2: Recording and replay know who applied

**Files:**
- Modify:
  - `packages/ui/src/observe/entry.ts`: the deployment entry gains `caller?: string`;
  - `packages/ui/src/observe/record.ts`: copy `applied.caller` onto the deployment entry that follows it;
  - `packages/ui/src/observe/replay.ts`: re-apply only deployment entries whose `caller` is `'host'` or absent.
- Test: `packages/ui/test/observe/replay-caller.test.ts`.

**Interfaces:**
- Consumes: Task 1's `apply(next, { caller })` and `applied.caller`.
- Produces:
  - deployment entries carry `caller`;
  - `replay` reproduces a pod's apply only by replaying its cause, so it happens exactly once.

- [ ] **Step 1: Write the failing tests.** Use a test-only `grower` pod providing a test interface
  `Grow { grow(name) }`. It holds the app through a closure variable that the test sets after `create`, and its
  `grow` applies a deployment adding runtime `name` with `{ caller: 'grower' }`.
  - `a pod's apply is recorded with its caller`;
  - `replay applies it once, at fast and at original pace`: record `grow('r1')` from a clean start, then replay into a
    second store. The app has `r1` exactly once, `diverge(pair(first), pair(second))` is null, and the replay's
    `failed` is 0;
  - `a host apply is still re-applied`: the existing replay tests pass unchanged.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the ui and workspace suites and `tsc`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(observe): deployment entries record who applied; replay re-applies only the host's`.

### Task 3: `HostDeploy` — the interface, the workspace's component and its approval policy

**Files:**
- Modify:
  - `packages/ui/src/interfaces.ts`: add `HostDeploy`;
  - `packages/ui/src/index.ts`;
  - `design.md`: the nano-ui line.
- Create: `packages/ui-workspace/src/host-deploy.ts`, holding the pure `addTo`, `removeFrom` and `summary`, the
  implementation, and `approvalPolicy`.
- Modify:
  - `packages/ui-workspace/src/host.ts`: place a `deploy` pod in `main` beside `ui`; pass `deploymentPolicy` to
    `Application.create`; bind the app into the implementation; give `shadowAt`'s `create` factory
    `DeploymentPolicies.allowAll()`. `host.ts` is at 150 lines, so move the wiring into `host-deploy.ts` and leave
    `host.ts` no longer than now;
  - `packages/ui-workspace/src/auto-connect.ts` only if a dependency on `HostDeploy` doesn't already auto-connect to
    the `deploy` pod.
- Test:
  - `packages/ui-workspace/test/host-deploy.test.ts` (headless);
  - `packages/ui/test/host-deploy-iface.test.ts` (schemas).

**Interfaces:**
- Produces:
  ```ts
  // nano-ui
  export const HostDeploy = ns.interface('HostDeploy', {
    deploy: Op.action(Addition, Nothing),     // Addition = { pods: Record<string, PodData>, runtimes: Record<string, RuntimeData> }, reusing nano-core's deployment schemas
    undeploy: Op.action(Removal, Nothing),    // Removal = { runtimes: string[] }
  })
  // workspace (internal)
  export function addTo(d: AppDeployment, add: Addition): NanoResult<AppDeployment>   // any existing pod or runtime name → invalid-input naming it, nothing added
  export function removeFrom(d: AppDeployment, rm: Removal): NanoResult<AppDeployment> // unknown runtime → not-found; pods no longer placed anywhere are dropped
  export function summary(current: AppDeployment, next: AppDeployment): string          // e.g. "Create runtimes example-1..3 (9 pods)", "Remove runtimes example-1..3"
  export function approvalPolicy(approve: (text: string) => Promise<boolean>): DeploymentPolicy   // 'host' always allowed; a pod asks approve(summary)
  ```
- **The implementation `nano.ui-workspace/host-deploy`** (coordinate per the workspace's namespace) applies with
  `{ caller: <its own pod name> }`, and answers the apply's `Fail` when refused.

- [ ] **Step 1: Write the failing tests:**
  - `addTo adds pods and runtimes`;
  - `addTo refuses a name that exists, adding nothing` (Review Focus 1: `example-2` exists, adding `example-1..3`
    gives `invalid-input` mentioning `example-2`);
  - `removeFrom drops the runtimes and the pods placed nowhere else, keeping shared ones`;
  - `summary names the runtimes and pod count`;
  - `approvalPolicy allows host, asks for pods, and a no denies`;
  - **host:** a fixture pod with a `HostDeploy` dependency, imported, is auto-connected to `deploy`. Its call adds a
    runtime after approve says yes, and changes nothing (answering `denied`) when it says no. The history's deployment
    entry has `caller: 'deploy'`.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement. Apply through the existing `AppDeployment.edit` where it fits, and use `app.apply` for the
  rest.
- [ ] **Step 4:** Run all four suites and `tsc`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(workspace): HostDeploy — pods deploy runtimes through the host, approved by its deployment policy`.

### Task 4: The Ring view — pure layout, dots and past/live binding; a thin element; the `#/ring` page

**Files:**
- Create:
  - `packages/ui/src/observe/ring.ts`: pure `ringLayout`, `ringDot`, `ringSource`;
  - `packages/ui/src/observe/ring-view.ts`: the `<nano-ring>` element.
- Modify:
  - `packages/ui/src/views/define.ts`: register `nano-ring`;
  - `packages/ui/src/index.ts`;
  - `design.md`;
  - `packages/ui-workspace/public/index.html`: the `#/ring` route with the bar; nav "Connections | Desk | Messages |
    Ring" on each wiring page;
  - `packages/ui-workspace/src/boot-wiring.ts`: `/ring` as `/desk`;
  - `packages/ui-workspace/src/main.ts`: `hand()` gives the Ring `tm`, `store` and `create`, plus `show` from the
    deployment's `layout.ring.show`, a list of implementation coordinates (absent: every pod). `layout` is the host's
    plain object, so no core change.
- Test:
  - `packages/ui/test/observe/ring.test.ts` (headless);
  - `packages/ui/test/observe/ring-view.test.ts` (happy-dom);
  - `packages/ui-workspace/test/ring-page.test.ts`.

**Interfaces:**
- Consumes: `TimeMachine`, `Frame`, `shadowAt(store, t, create, { host })`, `cleanStart`, `viewFor`, `ViewTarget`.
- Produces:
  ```ts
  export type RingLayout = {
    runtimes: { id: string; x: number; y: number; r: number }[]   // outer ring of clusters; one runtime → centred
    pods: { pod: string; runtime: string | null; x: number; y: number }[]   // runtime null = shared (placed in ≥2) → near centre
  }
  export function ringLayout(d: AppDeployment, opts: { size: number; show?: (pod: string, impl: string) => boolean }): RingLayout
  export function ringDot(l: RingLayout, d: AppDeployment, m: Message, progress: number): { x: number; y: number } | undefined
     // from → to, interpolated; a hidden pod → its runtime's centre; host or unknown → undefined
  export function ringSource(mode: 'live' | 'paused' | 'playing', atNewest: boolean, rebuildable: boolean): 'live' | 'past' | 'too-long'
  ```
- **The element** `<nano-ring>` takes the properties `app`, `registry`, `tm`, `store`, `create` (the host's factory)
  and `show` (the filter).
  - It renders each shown pod's view (`viewFor`) at its layout position, and the frame's dots.
  - On `'past'`, once the cursor has been still for 200 ms, it builds `shadowAt` and points every view's
    `target.app` at it, with the views `inert`. It closes the previous shadow app.
  - On `'live'`, it points the views back at the live app.
  - On `'too-long'`, it stays live and shows "history too long to rebuild state" (Review Focus 3).
  - A dot click calls `tm.seek(at)`.

- [ ] **Step 1: Write the failing tests:**
  - **headless:**
    - `one runtime: pods evenly on one circle`;
    - `three runtimes and two shared pods: three clusters, shared pods within 0.25·size of the centre`;
    - `show hides pods`;
    - `ringDot interpolates; hidden pod uses its runtime centre; host gives undefined`;
    - `ringSource: live → live; paused at newest → live; paused earlier → past; not rebuildable → too-long`;
  - **happy-dom:**
    - `renders Typing's pods as their views`;
    - `scrubbing back rebinds the views to a shadow app, inert`;
    - `Live rebinds to the live app`;
    - `too-long shows the message and stays live`;
    - `a dot click seeks`;
  - **workspace:** `the #/ring page has the bar and nano-ring, handed the page's tm`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement. Keep the logic in `ring.ts`; the element only wires and draws.
- [ ] **Step 4:** Run all four suites and `tsc`, plus `cd packages/ui-workspace && bun run build`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(observe): the Ring view — pods on rings, messages between them, state at the cursor`.

### Task 5: The Raft state machine (pure) and its simulator tests

**Files:**
- Create, in `examples/raft/core/`, each at most 150 lines:
  - `types.ts`;
  - `step.ts`: dispatch, actions;
  - `election.ts`;
  - `replication.ts`.
- Test:
  - `examples/raft/core/sim.ts` (test helper: a pure seeded simulator);
  - `examples/raft/core/election.test.ts`;
  - `examples/raft/core/replication.test.ts`;
  - `examples/raft/core/safety.test.ts`.

**Interfaces:**
- Produces:
  ```ts
  export type Role = 'follower' | 'candidate' | 'leader'
  export type LogEntry = { index: number; term: number; value: unknown; at: number }   // index from 1
  export type Persistent = { currentTerm: number; votedFor: string | null; log: LogEntry[] }
  export type Peer = { next: number; match: number; granted: boolean; rpcDue: number; heartbeatDue: number }
  export type Node = { id: string; peers: string[]; p: Persistent; role: Role; commitIndex: number; leader: string | null;
    electionAlarm: number; stopped: boolean; progress: Record<string, Peer>; timing: { electionMin: number; electionMax: number; heartbeat: number } }
  export type Rpc =
    | { kind: 'vote'; term: number; lastIndex: number; lastTerm: number }
    | { kind: 'vote-reply'; term: number; granted: boolean }
    | { kind: 'append'; term: number; prevIndex: number; prevTerm: number; entries: LogEntry[]; commit: number }
    | { kind: 'append-reply'; term: number; success: boolean; match: number }
  export type Input = { kind: 'tick' } | { kind: 'receive'; from: string; rpc: Rpc } | { kind: 'request'; value: unknown }
    | { kind: 'time-out' } | { kind: 'stop' } | { kind: 'resume' } | { kind: 'restart'; p: Persistent }
  export type Effect = { kind: 'send'; to: string; rpc: Rpc } | { kind: 'persist'; p: Persistent }
    | { kind: 'refused'; reason: 'no leader known' | 'stopped' | 'not leader'; leader?: string }
  export function initial(id: string, peers: string[], p: Persistent, now: number, draw: () => number, timing?: Node['timing']): Node
  export function step(n: Node, input: Input, now: number, draw: () => number): { node: Node; effects: Effect[] }
  ```
- **Rules:**
  - `tick` runs due work: the election alarm, then heartbeats and RPC retries, by `rpcDue`/`heartbeatDue`.
  - `draw()` is in `[0, 1)`; election timeout = `min + draw()·(max−min)`.
  - `stopped` ignores everything but `resume`.
  - `restart` keeps `p`, resets the rest to a follower, and re-arms the alarm.
  - A `request` to a follower with a known leader gives `refused` `not leader` with `leader`.
  - The commit index advances only on a majority match of an entry from the current term.

- [ ] **Step 1: Write the failing tests** on `simulate({ size, seed, script })`. It delivers sends after a seeded
  10–30 ms, ticks every 10 ms of sim time, and returns each node's state after every event.
  - `election: sizes 3 and 5, seeds 1–5: exactly one leader within 2000 ms`;
  - `same seed → same leader and term`;
  - `request to the leader commits on a majority; all logs match`;
  - `request to a follower: refused 'not leader' naming the leader`;
  - `no leader known: refused 'no leader known'`;
  - `request to a stopped node: refused 'stopped', ledger unchanged` (Review Focus 4);
  - `stopped minority: commits continue`;
  - `stopped majority: no leader, no commit; after resume a leader and commits` (Review Focus 2);
  - `stopped leader replaced; after resume its uncommitted entries are overwritten`;
  - `restart keeps term, vote and log`;
  - **safety, on every event of every scripted run above:**
    - `at most one leader per term`;
    - `log matching: same index and term ⇒ equal prefixes`;
    - `commitIndex never decreases and committed entries never change`.
- [ ] **Step 2:** Run `cd examples && bun test --isolate raft/core`. Expected: FAIL.
- [ ] **Step 3:** Implement, following the Raft paper's figure 2.
- [ ] **Step 4:** Run the examples suite and `tsc`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(raft): a pure Raft state machine, proven by a seeded simulator`.

### Task 6: Raft pods — messaging, node, ledger, cluster, and the cluster's deployment

**Files:**
- Create in `examples/raft/`:
  - `interfaces.ts`: `Messaging`, `RaftNode`, `Ledger`, `Cluster` in namespace `example.raft`;
  - `deployment.ts`: pure `clusterDeployment`;
  - `messaging.ts`;
  - `node.ts`: wires `step` to the context;
  - `ledger.ts`;
  - `cluster.ts`;
  - `index.ts`: the provider and the `views` map, filled in Task 8;
  - `nano.json`: runtime `raft` with `cluster`, `messaging` and a `clock` on `nano.ui/sim-clock`;
  - `fold.ts`: `ledgerStep`;
  - `test-host.ts`: a test-only `HostDeploy` implementation holding an app, with `allowAll`.
- Modify: `examples/scripts/build.ts`, adding `raft: { 'example.raft': 'raft/index.ts' }`.
- Test:
  - `examples/raft/deployment.test.ts`;
  - `examples/raft/pods.test.ts`.

**Interfaces:**
- Consumes: Task 5's `step`, `initial` and types; Task 3's `HostDeploy`; nano-ui `Clock`, `Random`, `simClock`,
  `seededRandom`.
- Produces:
  ```ts
  export function clusterDeployment(name: string, size: 3 | 5, seed: number): { pods: AppDeployment['pods']; runtimes: AppDeployment['runtimes'] }
    // runtimes `${name}-${i}` (i = 1..size), each placing messaging, clock (shared), `${name}-${i}-raft`, `${name}-${i}-ledger`, `${name}-${i}-random` (seeded-random, seed + i);
    // call edges raft → messaging, ledger, clock, random; messaging → raft in that runtime; all eager; peers via each raft pod's config { id, peers }
  Messaging: send({ to: string; message: Rpc & { from: string } }) → Nothing   // returns at once; delivers to `to`'s RaftNode.receive after a latency on the clock (config { minMs: 10, maxMs: 30 }, drawn from its own seeded-random)
  RaftNode:  receive, request(value), timeOut, stop, resume, restart, status → NodeStatus; event changed(NodeStatus)
  Ledger:    read → Persistent, write(Persistent) → Nothing; event written(Persistent)
  Cluster:   create({ name, size, seed }), remove({ name }), list → string[]
  export function ledgerStep(pod: string): FoldStep<Persistent | undefined>   // folds the pod's written events; resets on a deployment change of that pod
  ```
- **The node pod:**
  - It loads its ledger at build. The election alarm and heartbeats go through `Clock.after`, with tags of its own.
  - It runs `step` on each input, then performs the effects: `send` goes through `Messaging`, `persist` goes to
    `Ledger.write` (awaited before sends that depend on it), and `refused` is the op's failure (`invalid-input` with
    the reason).
  - It publishes `changed` after each step that changes the status.
- **The messaging pod:** a delivery to a runtime or pod that no longer exists is dropped silently (Review Focus 5).

- [ ] **Step 1: Write the failing tests:**
  - **headless `clusterDeployment`:** names, placement, edges, seeds, sizes 3 and 5; and it assembles against the
    registry;
  - **pods, on a sim clock driven by `advance`, through `test-host` creating `example` with 3 nodes:**
    - `a leader is elected for seeds 1–5`;
    - `request commits on every ledger`;
    - `stop / resume / restart / time-out act as in Task 5`;
    - `remove() with messages in flight: dropped, no failure, no throw`;
    - `ledgerStep folds a node's ledger to equal Ledger.read`.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the examples suite and `tsc`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(raft): pods — shared messaging, node, ledger and a cluster that deploys itself through the host`.

### Task 7: Raft replay and consistency — the case study's centre

**Files:**
- Test:
  - `examples/raft/replay.test.ts`;
  - `examples/raft/consistency.test.ts`.

**Interfaces:**
- Consumes:
  - `record`, `replay`, `pair`, `diverge`, `foldAt`, `shadowAt`, `memoryStore` (nano-ui);
  - Task 6's `test-host`, `ledgerStep` and `Cluster`;
  - Task 2's caller-aware replay.

- [ ] **Step 1: Write the tests.** Record from a clean start (`record(app, store, { clean: true })`), stamping `at`
  once per host input through `record`'s `now` option (the KV consistency test's technique). The script:
  1. `cluster.create({ name: 'example', size: 3, seed })`;
  2. `advance` until a leader;
  3. two requests;
  4. stop the leader, advance, resume it, restart a follower;
  5. one request.

  The tests:
  - `replayed fast and original: diverge is null, the cluster is created once`, for seeds 1–5;
  - `foldAt(ledgerStep) equals shadowAt's Ledger.read for every node at every quiet boundary`, for seeds 1–5;
  - `the safety properties hold on the recorded run`, folding each node's `changed` events at every boundary (one
    leader per term, log matching, commit monotone).
- [ ] **Step 2:** Run them. If a test fails, the bug is in Tasks 2, 5 or 6: fix it there, in this task's commit, and
  say which.
- [ ] **Step 3:** Run the examples, ui and workspace suites and `tsc`. Expected: PASS.
- [ ] **Step 4:** Commit `test(raft): a recorded cluster replays exactly and its ledgers fold to the shadow's, across seeds`.

### Task 8: Raft views — pure models, thin elements

**Files:**
- Create in `examples/raft/views/`:
  - `model.ts`: pure `glyphModel`, `detailModel`, `ledgerRows`;
  - `glyph.ts`: `raft-node`;
  - `detail.ts`;
  - `ledger-view.ts`: `raft-ledger`;
  - `cluster-view.ts`: `raft-cluster`.
- Modify: `examples/raft/index.ts`, setting `views` to `{ 'example.raft/node': 'raft-node', 'example.raft/ledger':
  'raft-ledger', 'example.raft/cluster': 'raft-cluster' }`.
- Test:
  - `examples/raft/views/model.test.ts` (headless);
  - `examples/raft/views/views.test.ts` (happy-dom).

**Interfaces:**
- Consumes: `NodeStatus`, `Persistent`, nano-ui's `ViewTarget` contract (`target.app.call(runtime, pod)`,
  `target.app.listen`).
- Produces:
  ```ts
  export function glyphModel(s: NodeStatus, now: number): { term: number; role: Role; stopped: boolean; arc: number /* 0..1 of election time left */; peers: { id: string; state: 'pending' | 'granted' | 'idle' }[] }
  export function detailModel(s: NodeStatus, now: number): { rows: [string, string][]; peers: { peer: string; next: number; match: number; granted: boolean; rpcDue: string; heartbeatDue: string }[] }   // times as signed ms, one decimal
  export function ledgerRows(p: Persistent, commitIndex: number): { index: number; term: number; value: string; at: string; committed: boolean }[]
  ```
- **The glyph:**
  - a circle with the term, coloured by role (follower grey, candidate amber, leader green, stopped dimmed);
  - an arc for `arc`;
  - one dot per peer, hollow when `pending` and filled when `granted`;
  - a click opens the detail panel, with the buttons stop, resume, restart, time out and request.
- **The cluster view:** name, size (3 or 5) and seed; Create and Remove; the list of clusters.

- [ ] **Step 1: Write the failing tests:**
  - **headless:** each model's fields for follower, candidate (pending and granted peers), leader and stopped; arc
    0 at the alarm and 1 at a fresh timeout; `ledgerRows` marks committed rows;
  - **happy-dom:** each element renders its model; each button calls its op; the ledger table follows `written`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement, using the Desk's palette.
- [ ] **Step 4:** Run the examples suite and `tsc`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(raft): the node glyph, detail panel, ledger table and cluster view`.

### Task 9: File › Examples › Raft, and a real-browser check

**Files:**
- Modify:
  - `packages/ui-workspace/src/components/file-menu.ts`: append `['raft', 'Raft: a cluster that elects a leader']` to
    `EXAMPLES`;
  - `examples/raft/nano.json`: a `layout` whose slots open `cluster`, and
    `layout.ring.show: ['example.raft/node', 'example.raft/messaging']`;
  - `design.md`: the examples line mentions Raft.
- Test: `packages/ui-workspace/test/examples-menu.test.ts`, extending the existing test if there is one.

- [ ] **Step 1: Write the failing test:** `File › Examples lists Raft, and importing examples/raft/nano.json places
  cluster, messaging and clock in runtime raft, with cluster auto-connected to deploy`.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement. Run `cd packages/ui-workspace && bun run build`, then confirm
  `public/examples/raft/nano.json` exists.
- [ ] **Step 4:** Run all four suites and `tsc`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(workspace): Raft in File › Examples`.
- [ ] **Step 6 (controller): a real-browser check.**
  1. Install Raft from File › Examples, then create `example` with 3 nodes and approve it.
  2. On `#/ring`, a leader is elected, with dots through the central messaging pod.
  3. Request an entry; it appears in each ledger.
  4. Stop the leader; a new one is elected.
  5. Pause, play at 1/10 and scrub back. The glyphs show the past state, inert. Live returns.
