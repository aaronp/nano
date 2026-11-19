# The Raft case study — design

Date: 2026-11-19. Builds on the time machine (`2026-11-18-time-machine-design.md`), the clock and random
capabilities, and ADR-0015 (`adr/decisions.md`). Branch: `dev-raft`.

## Intent

A teaching example of **event-driven observability with nano**, in the style of [raft.github.io](https://raft.github.io/):
a ring of servers electing a leader and replicating a log, with every message visible, pausable, slowable and
replayable. It is not another production Raft. What it shows off is nano:

- **Runtimes created by a pod** (a management pod deploys an N-node cluster through the host).
- **The app gateway pattern**: one messaging pod shared by every node runtime.
- **Storage as a pod** whose state at any time comes from the history.
- **Determinism as a mechanism**: a simulated clock and seeded randomness make a run exactly replayable.
- **The time machine** (pause, 1/30×, scrub, Reset) and a new generic **Ring view**.

## Decided (user, 2026-11-19)

- **The `raft` runtime** declares a `Messaging` interface through which all nodes talk, and holds a management/demo
  pod for deploying an N-node cluster.
- **`HostDeploy` is a component like any other** (ADR-0015, clarified): it takes a nano deployment (runtimes, pods,
  wiring). Its instance is placed in the host's runtime, and its implementation, supplied by the host, holds the
  `Application`, so it can apply deployments. The Raft management pod declares it as a dependency.
- **The `Application` gets a deployment policy:** `isAllowed(caller, deployment)`, passed by the host to
  `Application.create`, just as each runtime's `Policy` (with `PolicyRules`) polices calls. The host's policy may
  prompt the user through existing host actions (`approve`, settings). `DeploymentPolicies.allowAll()` serves tests.
- **Scrubbing shows state at the cursor:** a separate application rebuilt from the recording up to t (today's
  `shadowAt`: the recorded messages, the simulated clock and seeded random make it exact). State rehydrates by
  replaying messages. An `env` on `NanoContext` and pod state snapshots are deferred (ADR-0010).
- **A cluster named `example` of 3 nodes** is runtimes `example-1`, `example-2`, `example-3`. Each holds:
  - the **shared messaging pod** (one instance placed in every node runtime: the gateway pattern);
  - its **`raft-api` pod**, the Raft logic;
  - its own **`ledger` pod**, the storage.
- **The pods start eager**, so a node times out and starts the election by itself.
- **Node actions copy raft.github.io:** stop, resume, restart, time out, request.
- **The node's look copies raft.github.io's glyph and detail panel** (below).
- **The ledger has a view:** its records with their terms and timestamps.
- **Watching the cluster is a core nano capability:** the time machine (pause, replay, scrub) plus the Ring view.
  Raft adds nothing to it.
- **Packaged in File › Examples.**
- **Mechanisms, not guarantees** (standing stance): document what replay assumes, don't promise more.

## Approaches considered

**How the servers talk:**
1. *One runtime, N server pods calling each other directly.* Simple, but a single ring, and delaying or dropping
   messages needs special handling.
2. **One runtime per server, all traffic through a shared messaging pod (chosen).** It is the gateway pattern and a
   ring of rings, and the messaging pod is the one place to add latency or drops later, under the seeded random.

**How a pod creates runtimes:**
1. **A `HostDeploy` component in the host runtime, policed by an application deployment policy (chosen, ADR-0015).**
   Deployment change stays apart from UI concerns, and who may deploy is policy, as calls are.
2. *A `deploy` op on `HostUI`.* Smaller, but mixes deployment into an interface about the UI.

**How scrubbing shows past state:**
1. **Views bound to an application rebuilt to the cursor (chosen).** Generic: every pod view works unchanged.
2. *Views stay live; only the dots scrub.* Simpler, but old messages beside today's state.
3. *A replay mode fed by recorded `env` values on `NanoContext`.* Deferred (ADR-0010).

## Goals

- File › Examples › Raft installs the `raft` runtime. Creating a 3-node (or 5-node) cluster from the management pod's
  view asks for approval, then deploys the node runtimes, and a leader is elected without any further input.
- Every node's glyph, detail panel and actions work, and so does each ledger's table.
- On the Ring view, messages travel between nodes through the central messaging pod. Pausing, slowing to 1/30× and
  scrubbing with the time bar work on the whole cluster.
- **Strong replay tests** (the case study's point): a seeded run is replayed exactly, and the ledgers' state at any
  time from folding the history agrees with a shadow app.

## Non-goals

- Membership changes, log compaction and snapshots, persistence beyond memory.
- Network partitions and message drops in the UI (the messaging pod makes them possible later).
- Proving Raft correct. The tests check the safety properties on recorded runs; they don't prove them.

## Anti-goals

- Raft-specific code in the time machine, the Ring view or the workspace.
- A second engine beside nano: every Raft message is a nano message, so the recorder sees it.
- Hidden time: no `setTimeout` or `Date.now` in the Raft pods. All time is the wired clock.

## The parts

### 1. `HostDeploy` and the deployment policy

**In nano-core (the one core change):**
- **`DeploymentPolicy`:** `isAllowed({ caller, deployment })` answering a `Verdict`, as runtime policies do (sync or
  async is the builder's call; the host's will prompt, so async).
- **`DeploymentPolicies.allowAll()`.**
- **`Application.create(runtimes, { deploymentPolicy? })`:** absent, allow-all (today's behaviour).
- **`app.apply(next, { caller? })`:** `caller` is `'host'` by default, else the pod applying. A refusal is
  `denied` with the policy's reason, and nothing changes.
- **The `applied` event carries the `caller`,** so the history says who changed the deployment.
- **`design.md`** gets each new name; the structure test's limits hold.

**In nano-ui:** the `HostDeploy` interface:
- `deploy({ pods, runtimes, onConflict? })`: adds them to the current deployment. With `onConflict: 'error'`
  (the default) an existing name is `invalid-input`; with `'overwrite'` the addition replaces pods and runtimes of the
  same name, and the approval says what it replaces (user, 2026-11-19).
- `undeploy({ runtimes })`: removes those runtimes, and the pods no longer placed anywhere.

**In the workspace:**
- **The implementation:** holds the `Application` (bound when the host builds it), and applies through
  `AppDeployment.edit` and `app.apply(next, { caller: <its pod> })`.
- **Placement:** an instance in the host's runtime (`main`, beside `ui`). An example that needs it gets a call edge
  to it at import, as for other host capabilities (an example's `nano.json` can't name host pods).
- **The workspace's deployment policy** asks `approve` with a one-line summary, such as "Create runtimes
  example-1..3 (9 pods)".
- **Who may call `HostDeploy`** is the host runtime's ordinary call policy. Revisiting the application's deployment
  policy as a whole is a board item.

**Reset and replay:**
- **Reset keeps the cluster** (as Reset does today: the new clean start is the current deployment). Every pod
  restarts, so the ledgers empty and a fresh election follows. Remove a cluster with `undeploy`.
- **Replay re-applies only the host's own applies** (`caller: 'host'`). An apply made by a pod is reproduced by
  replaying its cause (the root host call to the management pod), so it isn't applied twice.
- **Applications rebuilt for replay or scrubbing use `DeploymentPolicies.allowAll()`:** the decision was made live
  and is in the history, so nobody is asked again.
- **`shadowAt` keeps the `HostDeploy` pod** (it leaves out only `ui`), bound to the shadow application.

### 2. The Ring view (nano-ui `observe/`, shown in the workspace)

- **A generic element** (name left to the builder, `nano-` prefix like `<nano-time-machine>`):
  - It is handed an `Application`, a `Registry` and the page's `TimeMachine`. It knows nothing about Raft.
- **Layout:**
  - Each runtime is a cluster on an outer ring.
  - Pods placed in several runtimes (shared pods, like the messaging pod and the clock) sit near the centre.
  - With one runtime it is a single ring of its pods.
- **Each pod is drawn as its own view**, small, else as a plain labelled node. The element takes a `views` map
  (implementation → tag, the existing `ViewMap`), which the workspace fills with the views its loaded modules bring
  (user, 2026-11-19), so the Raft glyph is just `raft-api`'s view.
- **A filter** chooses which pods are drawn, by implementation. Raft's default shows `raft-api` and the messaging pod.
  - A message to or from a hidden pod is drawn to or from its runtime's cluster.
- **State at the cursor:** when the time machine is paused or playing away from Live, the Ring rebuilds an
  application to the cursor with `shadowAt` (once the slider settles, closing the previous one) and points each pod
  view's `target.app` at it. Views are marked `inert` while they show the past, so an action can't change a rebuilt
  copy by mistake. Back at Live, the views point at the live app again. When the history is too long to rebuild,
  the views stay live and the Ring says so.
- **Messages in flight** are the time machine's frames: dots travel from sender to receiver, as on the Desk.
  - It reuses the Desk's call/pipe matching where it applies.
  - Clicking a dot pauses there and opens the existing message detail.
- **Page:** a `#/ring` page with the shared time bar. The nav reads "Connections | Desk | Messages | Ring".
- **Tried first on Typing** (a single ring) before Raft.

### 3. The Raft example (`examples/raft/`)

**Deployment (`examples/raft/nano.json`):**
- Runtime `raft` holds:
  - `cluster`, the management pod, with a `deploy: HostDeploy` dependency (its edge to the host's `HostDeploy` pod
    is added at import);
  - `messaging`;
  - `clock`, a `nano.ui/sim-clock`, so the clock driver drives it and the time bar paces the cluster.

**Created per node `<name>-<i>`:**
- `messaging` and `clock` placed (shared);
- `<name>-<i>-raft` (`raft-api`) and `<name>-<i>-ledger`;
- a `nano.ui/seeded-random` with seed `seed + i` (the cluster's `seed` is set in the management view; default 1);
- call edges raft-api → messaging, ledger, clock, random, and messaging → raft-api in that runtime;
- eager.

**Interfaces (in an `example.raft` namespace, named by constants):**
- **`Messaging`:** `send({ to, message })` returns at once, then delivers the message to node `to`'s `raft-api`
  `receive` in that node's runtime (selected by runtime, as the migration example does).
  - Latency: each delivery waits a seeded random time on the clock. The default range is set in the messaging pod's
    config, so messages visibly travel and arrive in a varied order.
- **`RaftNode`** (`raft-api`):
  - actions `receive`, `request(value)`, `timeOut`, `stop`, `resume`, `restart`, `status`;
  - events publishing each change of role, term or commit index.
- **`Ledger`:**
  - persistent state: `currentTerm`, `votedFor`, and the log (`{ index, term, value, at }`);
  - actions to read it, `setTerm`/`vote`, `append(fromIndex, entries)` (truncating a conflicting suffix);
  - an event publishing each change, so `foldAt` can rebuild any node's ledger at any time.
- **`Cluster`** (management): `create({ name, size, seed })` and `remove({ name })`, through its `HostDeploy`
  dependency.

**Raft behaviour** (the paper's core, kept small and readable):
- **Elections:** a seeded random election timeout per term; RequestVote; a majority wins. Heartbeats come by
  AppendEntries on a fixed interval.
- **Replication:** AppendEntries with the consistency check; nextIndex and matchIndex per peer; the commit index
  advances on a majority for the current term.
- **Requests and replies** are separate `send`s, so both travel visibly, as on raft.github.io.

**The actions** (raft.github.io's):
- **request:** a client request. A leader appends and replicates it. A follower refuses and names the leader if it
  knows one.
- **time out:** fires the election timer now.
- **stop:** the node ignores every message and timer until **resume**.
- **restart:** the node drops its in-memory state (role, commitIndex, peer progress, timers) and reloads term, vote
  and log from its ledger. This is the pod's own action, not nano's `restart`.

**Views:**
- **The glyph** (`raft-api`'s view):
  - a circle with the current term inside, coloured by role;
  - an arc around it for the time left on the election timer;
  - one small dot per peer: hollow while a reply is pending, filled when a vote was granted;
  - stopped nodes are greyed.
- **The detail panel** (opens from the glyph):
  - state, currentTerm, votedFor, commitIndex, election alarm;
  - a peers table: next index, match index, vote granted, RPC due, heartbeat due;
  - the five actions.
- **The ledger's view:** a table, one row per log entry (index, term, value, at), with committed rows marked, and
  currentTerm and votedFor above it.
- **The management view:** name, size (3 or 5) and seed inputs; Create and Remove buttons; the clusters it has
  created.

**Packaging:**
- The example builds through `examples/scripts/build.ts` into `examples/dist/raft`, which the workspace copies.
- `EXAMPLES` in `file-menu.ts` gains `['raft', 'Raft: a cluster that elects a leader']`.
- Its `layout` opens the management view and the Ring page.

## Tests

All headless on the sim clock, driven by `advance`.

- **Deployment policy (nano-core):**
  - `allowAll` and absent behave as today;
  - a refusing policy leaves the deployment unchanged and `apply` answers `denied`;
  - `applied` carries `caller` (`'host'` or the pod).
- **`HostDeploy`:**
  - `deploy` adds runtimes and refuses existing names;
  - `undeploy` removes them;
  - a refused approval changes nothing;
  - the apply is recorded with the `HostDeploy` pod as caller;
  - replay of a recording that created a cluster applies it once, at both paces (`diverge` null).
- **Election:**
  - a 3-node and a 5-node cluster each elect exactly one leader within a bounded sim time, for seeds 1–5;
  - the same seed elects the same leader in the same term.
- **Replication:**
  - requests to the leader commit on a majority, and every node's log matches;
  - a stopped minority doesn't block commits;
  - a stopped leader is replaced, and its uncommitted entries are overwritten after it resumes.
- **Safety, on every recorded run, at every message boundary:**
  - at most one leader per term;
  - log matching: equal index and term mean equal prefixes;
  - the commit index never decreases.
- **Replay** (the case study's centre):
  - a seeded run with requests, a stop, a resume and a restart is recorded from a clean start;
  - replayed at `fast` and at `original` pace, `diverge` is null;
  - `foldAt(ledgerStep)` agrees with `shadowAt`'s ledgers at every quiet boundary, for seeds 1–5, as the KV
    consistency test does.
- **Views** (happy-dom):
  - the glyph's arc, dots and colour follow the published events;
  - the detail actions call the right ops;
  - the ledger table follows the ledger's events.
- **Ring view** (happy-dom):
  - layout with one and several runtimes;
  - shared pods at the centre;
  - the filter;
  - dots for frames, and a click that pauses and opens the detail;
  - scrubbing back rebinds the views to a rebuilt application showing the state at the cursor (inert), and Live
    rebinds them to the live app.
- **Real-browser check:** install Raft from File › Examples, create 3 nodes, watch the election on the Ring, request
  an entry, stop the leader, then pause, play at 1/10 and scrub.

## Constraints

- Files at most 150 lines. **One nano-core change:** the deployment policy, `apply`'s `caller` and `applied`'s
  `caller`, each in `design.md`.
- **New exports:**
  - `DeploymentPolicy` and `DeploymentPolicies` are nano-core exports; `HostDeploy` and the Ring element are nano-ui's;
    each recorded in `design.md` and the ADR ledger;
  - the Raft names stay inside the example (`examples/` is outside core: tiny steps, template-shaped).
- **Constants, not strings:** ops are named by their constants and `port(...)`, never by duplicated coordinate strings.
- **No hidden time:** Raft pods use only the wired clock and random.

## Depends on open decisions (`adr/decisions.md`)

- **ADR-0010 (settled):** clock and random stay capability pods; an `env` on `NanoContext` is deferred, so the
  scrubbing application is today's `shadowAt`, replaying from the start (no snapshots).
- **ADR-0011, the clock driver's idle advances:** a live cluster already records heartbeats, and the driver adds about
  40 entries a second. It isn't blocking, but it shortens how long a session can be rebuilt before "history too long".
- **ADR-0012, the observe API public in nano-ui:** the Ring view assumes yes, as the time bar does.

## Left to the builder

- **Names:** the Ring element's name and file layout, and the exact op names and schemas (constants, per the
  rules).
- **Defaults:** the messaging latency range, the election timeout range (raft.github.io uses about 150–300 ms) and the
  heartbeat interval. The core's default stays at 150–300 ms and 50 ms (the simulator tests rely on it); the example ships
  seconds-scale timings through config (nano.json): heartbeat 1000 ms and elections 3000–6000 ms on the cluster pod's
  `timing`, latency 200–600 ms on the messaging pod, so the Ring view is watchable. The cluster view chooses the heartbeat when it creates a cluster; elections are 3–6 × it.
- **Styling:** colours follow the Desk's palette.
- **Ring geometry:** sizes and spacing.
