# Decision log

Append-only. One entry per decision: the question, the decision, why, and what it costs if wrong.

## 1. Do op hashes count annotations?

**Decision:** No. `description`, `title`, `examples` and `$comment` are stripped at every depth before hashing, except where a key is a property name (inside `properties`, `patternProperties`, `$defs`). `required` is hashed as a sorted set.
**Why:** Rewording documentation must never break a wire. Kerits hashes the whole schema; we deliberately differ.
**Cost if wrong:** Two ops that differ only in documentation share a coordinate; adding an annotation to the hash is a one-line change that re-keys every op.

## 2. How does binary data travel?

**Decision:** As base64 strings with a declared format, never as a refined `Uint8Array`. A schema holding a `Refine` or any function is rejected by `defineSchema` with `<type>: schema is not JSON`.
**Why:** A refined `Uint8Array` can't be hashed or cross a frame (the `Bytes` finding).
**Cost if wrong:** A second, in-process-only schema flavour for binary values.

## 3. Do selectors create connections?

**Decision:** Never. A selector only chooses among existing connections.
**Why:** Keeps every reachable target visible as data in the subscriptions.
**Cost if wrong:** An implicit-connection mode and a way to record what it made.

## 4. What do selector tags match?

**Decision:** The tags of the target instance, not the consumer's.
**Why:** Per-consumer roles then need distinct, tagged instances, which stay visible as data.
**Cost if wrong:** Per-subscription tags added to the document.

## 5. In what order does provisioning resolve a dependency?

**Decision:** For each unsatisfied dependency: exactly one matching existing instance, subscribe to it; otherwise exactly one matching implementation in the registry, create it (recursively, with a cycle check) and subscribe; otherwise leave it unsatisfied. Loading a document never provisions.
**Why:** Mirrors the dependencies work's resolver; ambiguity is left for the host to offer a choice.
**Cost if wrong:** A preference or priority rule for several candidates.

## 6. Can a subscription cross runtimes?

**Decision:** No. A subscription lives in one runtime and joins two members of it; to use something from elsewhere, the application places it into the consumer's runtime first. Each hop is policed by the runtime it happens in.
**Why:** Keeps policy and bookkeeping local and every connection a plain pair in one graph.
**Cost if wrong:** Cross-runtime coordinates in subscriptions and a joint policy.

## 7. What is Eval?

**Decision:** A code-taking component (its input is code, with the existing consent on load), not a new subsystem. Code snippets as a data dependency are config of that kind.
**Why:** No new machinery; the component model already covers it.
**Cost if wrong:** A dedicated code-execution subsystem later.

## 8. Rewrite the old code in place, or build a fresh package?

**Decision:** A fresh package (`packages/nano`) beside the old code.
**Why:** A clean break without breaking the running host until plan 2 switches it.
**Cost if wrong:** One package rename.

## 9. Can an implementation have ops outside an interface?

**Decision:** No. Every op belongs to an interface; an implementation provides whole interfaces, and `make` throws `<coord>: missing <iface>/<op>` for any action or sink left without a handler.
**Why:** Keeps the manifest and selectors one shape: everything on offer is an interface coordinate.
**Cost if wrong:** A "local interface" helper later.

## 10. What keys an implementation's handlers?

**Decision:** A port: `portKey(ifaceCoord, opCoord)` = `<iface coord>/<op coord>`. `make` returns handlers keyed by port; it throws when an interface is given twice, or given but not declared in `provides`, and checks for missing handlers per interface. `registry.op(coord)` stays keyed by op coord.
**Why:** An op coord is content-only, so two interfaces with an identical op (`log.write`, `audit.write`) share it; keyed by op coord they would collide, and one interface's handler would satisfy the other's.
**Cost if wrong:** Routing re-keyed by op coord, and a rule for which interface's handler wins.

## 11. Where does an instance's outgoing call travel?

**Decision:** Through its home runtime's subscriptions, wherever the instance is called from. A pod always hands its handlers the instance's own context (home runtime), never the caller's.
**Why:** Matches the signer calling the vault at home and a client-side log listening where it was placed; policy for each hop stays in the runtime the hop happens in.
**Cost if wrong:** A per-runtime context per member.

## 12. Does replacing an instance ask the policy?

**Decision:** Yes. `replace` rewrites every subscription naming the old coord to the new one and asks `policy.isAllowed(from, to, subscription)` for each rewritten subscription before creating anything; the first denial returns `denied` and nothing changes (the old member and its subscriptions stay).
**Why:** The new coord is a different `dest` (or `src`) as far as a policy is concerned, and the spec says a rewire the policy denies changes nothing; replacing is a rewire of every subscription naming the instance.
**Cost if wrong:** Drop the check in `replace`; one test changes.

## 13. Which events do `replace` and `reorder` emit?

**Decision:** `replace` emits `instance-replaced { from, to }`, then `subscription-set` for each rewritten subscription, then any `status` changes — not `instance-added` / `instance-removed`. `reorder` emits `subscription-set` for each subscription in the given list (in the new order); a listener reads the order from `subscriptions()`.
**Why:** One event per user-visible change; a listener keeping a member list can apply `instance-replaced` directly.
**Cost if wrong:** A listener that only handles added/removed misses replacements; emit both, or add an order event.

## 14. In what order does a runtime list its members?

**Decision:** Create order (`add` order for placed members). `replace` keeps the replaced member's slot: `acme/db/mem#d` → `acme/db/file#d` stays where it was.
**Why:** Saving relies on it: a saved document lists instances in the order they were made, and a replacement doesn't reshuffle the file.
**Cost if wrong:** One sort in `members()`, and saved documents reorder.

## 15. Can a runtime replace a member whose home is another runtime?

**Decision:** No. `replace` fails `denied` with `<coord>: replace it at its home runtime <home>` and changes nothing.
**Why:** The home runtime owns the pod and its outgoing calls (decision 11). A replacement made in a guest runtime would leave the home holding the old pod.
**Cost if wrong:** A cross-runtime replace that goes through the application to the home runtime.

## 16. Does a member remember its config?

**Decision:** Yes, `Member.config` is the config the instance was created with. `replace` carries it over unless `opts.config` is given.
**Why:** Saving writes it (Task 9), and a replacement of the same kind (a newer version) usually wants the same settings.
**Cost if wrong:** Replacements that need a fresh config must pass one explicitly.

## 17. Where does `ctx.publish` deliver?

**Decision:** In every runtime the instance is a member of (home and every runtime it was `add`ed to), each runtime delivering to its own live event subscriptions under its own policy and books. Runtimes register with the pod on `create`/`add`/`replace` and leave on `remove`/`replace` (a runtime-layer `WeakMap<Pod, Set<Deliver>>`, so no application is needed). Once the instance is gone from its home runtime, its publishes go nowhere.
**Why:** The ruling: an instance calls out at home but publishes into every runtime it belongs to — a client-side log listens where it was placed.
**Cost if wrong:** Restrict delivery to the home runtime; one test changes.

## 18. Which ports does `ctx.publish(op, data)` publish on?

**Decision:** Every source port of the instance whose op coord equals `op.coord` (normally one). Data that fails the op's output schema, or an op that is none of the instance's sources, is dropped and observed as an `exception` (`op` = the op coord); `publish` never throws.
**Why:** Keeps the `publish(op)` signature while handlers and event ends are keyed by port; two interfaces offering the identical source both emit it.
**Cost if wrong:** A `publish(iface, name)` form that names the port.

## 19. What do a subscription's books count?

**Decision:** Messages actually delivered over it — client calls and event deliveries — with the last result. A message the policy denies is neither delivered nor counted. `books(id)` is `{ calls: 0 }` for a subscription with no traffic, `undefined` for an unknown id, and unsubscribing drops the books.
**Why:** The runtime reports exactly the connections carrying traffic; a denial is not traffic.
**Cost if wrong:** A `denied` counter beside `calls`.

## 20. What if the `fn` given to a verb throws?

**Decision:** That connection's result is `threw` with reason `<target coord>: <message>`; the verb applies its cardinality as for any fail (`all` lists it, `fallback` moves on). Verbs never reject.
**Why:** Platform failures are NanoResult fails, never thrown; one bad call in a fan-out must not lose the others' results.
**Cost if wrong:** Let it propagate; the handler's pod still turns it into `threw`.

## 21. What client does a plain-data selector get?

**Decision:** Built per target from the target's own interfaces whose coord is `implements` (every interface it provides when `implements` is absent; on a name clash the first wins). An interface or `sel(I, …)` selector always uses the caller's interface, so the client is typed and a missing op is `unknown-op`.
**Why:** Plain data carries no ops; the target's interface is the only shape at hand.
**Cost if wrong:** Look the interface up in the registry by `implements` instead.

## 22. What if a policy throws while a message is checked?

**Decision:** The message is denied (`denied`, reason `policy threw: <message>`) and observed as an `exception` from the sender, with `op` the port the message was going to. A verb gets that fail; `publish` still resolves.
**Why:** Platform failures are fails, never thrown; one runtime's broken policy must not reject another runtime's publish.
**Cost if wrong:** Treat a throwing policy as approving; one test changes.

## 23. Which subscription does a call in flight get booked on?

**Decision:** Only the exact subscription it went over, if that subscription is still there unchanged when the call settles. Unsubscribed, retargeted or rewritten by `replace` meanwhile, the call is not booked (a new subscription that reuses the id starts at `{ calls: 0 }`).
**Why:** Books describe what each current connection carried; a call to the old target is not traffic on the new edge.
**Cost if wrong:** Book on the id regardless; a retarget shows calls its new target never saw.

## 24. Does `create` provision by default?

**Decision:** No: only with `{ provision: true }`. Without it, `unsatisfied` lists every dependency with no live connection, each with reason `not provisioned`, and nothing is made or subscribed.
**Why:** Loading a document never provisions, and a host that creates what a user picked should opt in to the runtime making more.
**Cost if wrong:** Flip the default; hosts that want plain creates pass `provision: false`.

## 25. Provisioning when several existing members match

**Decision:** The dependency is left unsatisfied with `<n> match` (n members); no implementation is made even if exactly one matches.
**Why:** Two candidates already present is a choice for the user (the host may offer it); making a third hides that choice.
**Cost if wrong:** Fall through to the implementation rule; one test changes.

## 26. Provisioning: create first, then wire; calls wait for the pass

**Decision:** A provisioned create is one pass. Every instance the pass makes is instantiated and joins the runtime at once; then its unmet dependencies are settled by the usual rule (one matching member → subscribe; several → `<n> match`; none → exactly one matching implementation → make it, in the same pass, then subscribe; else unsatisfied). A new instance is made only when no member matches, and once made it matches, so a pass makes each implementation at most once and mutual dependencies connect both ways (A ↔ B, or R → A → B → C → B). Until the pass finishes, calls and deliveries into or out of its instances (from handlers, or from instances outside the pass) wait for it, then proceed normally. `make` is construction, not use: a verb or publish through `ctx` while that instance's `make` is still running fails at once with `missing-component` (`<instance>: dependencies are not available while it is being made`). `all`/`each` give `[]`, `optional` gives that fail rather than none, and a publish is dropped and observed. It never waits, so a `make` cannot deadlock on its own pass. A depth limit (the registry's implementation count) is a safety net with reason `provisioning too deep`; it should be unreachable. Generated ids are `<last coord segment>-<first free n>`, skipping ids held, reserved by creates in progress, or taken elsewhere (`idTaken`).
**Why:** Calls are late-bound through the runtime, and an instance is never handed another instance, so a mutual dependency is legitimate. Wiring after everything exists is what makes it work, and waiting keeps the half-wired state invisible to callers.
**Removed:** the earlier cycle detection (`cycle: a → b → a` reasons, cycle paths failing nested creates) and the `cycle` fail type.
**Cost if wrong:** Reinstate the creation-stack cycle check; mutual dependencies then stop at a reported cycle.

## 27. What if a policy throws while a subscription is checked?

**Decision:** As decision 22 for messages: the rewire (`subscribe`, `retarget`, `reorder`, `replace`, or a subscription provisioning makes) is denied with reason `policy threw: <message>` and nothing changes; it is observed (if the runtime has an observer) as an `exception` from the subscription's `from`, with `op` the subscription id.
**Why:** No runtime call rejects because of user code.
**Cost if wrong:** Let it throw; callers must guard.

## 28. What does placing an instance check, and what does the receiving runtime hold?

**Decision:** `place(instance, from, to)` fails `not-found` unless `from` holds the instance and `to` exists; then `to`'s policy approves `isAllowed(<from runtime id>, <to runtime id>, <instance coord>)` (a throw is `denied` with `policy threw: <message>`), and `to.add({ coord, pod, home })` with the instance's real home (so placing a placed instance keeps its home). `from` emits nothing; `to` emits `instance-added` with that home. The same pod serves both runtimes.
**Why:** The runtime receiving something polices what enters it; one pod keeps one instance, and its calls out still go through its home (decision 11).
**Cost if wrong:** A policy check on the sending side too; one more `isAllowed` call.

## 29. What happens to placed copies when an instance leaves its home?

**Decision:** Removing an instance at its home removes it from every runtime of the application it was placed into (each emits `instance-removed`, unregisters its publish delivery, and its subscriptions to it go `waiting`). Removing it from a runtime it was placed into touches only that runtime.
**Why:** The home disposes the pod; a guest holding a disposed pod would show a live connection that can only fail.
**Cost if wrong:** Guests keep a dead member; calls into it fail `not-found … is disposed`.

## 30. Does a call in another runtime wait for the home's provisioning pass?

**Decision:** Yes. A runtime made by the application consults every runtime's own unfinished passes (`Runtime.settling(coord)`; instance ids are unique, so only the home can have one) through `RuntimeOpts.settling`, so a call routed in a guest into or out of a placed member mid-pass waits for that pass, as at home (decision 26).
**Why:** The half-wired state of a pass must be invisible to callers wherever they call from.
**Cost if wrong:** Guests see the half-wired instance; their calls may fail `missing-component` during a pass.

## 31. In what order is a defined runtime opened?

**Decision:** `open(id)` returns an opened runtime as it is (a concurrent open gets the same promise). A defined one is built: its own instances first (`provision: false`, create order), then the runtimes its members come from are opened (one currently being opened is skipped), then its members are placed, then its subscriptions added (they may wait). Any failure is returned as the `NanoResult` fail; the runtime is taken down again (its members removed, it is no longer opened, its definition stays), while runtimes opened on the way stay open. An undefined, unopened id fails `not-found`.
**Why:** Creating its own instances before opening others makes mutual placement work: when A's members come from B and B's from A, B (opened while A is opening) can already place A's instances. The plan's order (homes first) would fail that case with `not-found`.
**Cost if wrong:** Swap two loops; mutually placing runtimes then fail to open.

## 32. Which instance ids are taken in an application?

**Decision:** Any id held by a member of the root or any child runtime, and any id a defined but unopened runtime declares among its instances. Applies to creates (and provisioning's generated ids) in runtimes the application makes.
**Why:** Instance ids are unique across the application (ruling), including runtimes opened later on demand; otherwise opening a saved runtime could fail on an id created meanwhile.
**Cost if wrong:** Opening a runtime can fail `exists`.

## 33. What does the application share with adopted children, and what does `runtimes()` list?

**Decision:** `createRuntime` and `open` make children that share the application's registry, tags and id check; an adopted runtime (another application included) keeps its own registry, tags and ids, and only its id must be free. `place` works between the root and direct children (adopted ones included, as they are runtimes); runtimes inside an adopted application are out of reach (placing across nested applications is out of scope). `runtime(<application id>)` gives the root; `runtimes()` lists child ids, opened and defined, not the root. Defined runtimes always use the allow-all policy (the only saved policy).
**Why:** Nesting is adoption only (ruling); the root is the application itself.
**Cost if wrong:** A cross-application place that walks nested applications.
