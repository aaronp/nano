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
**Superseded by 26:** there is no cycle check; a pass creates first, then wires, so mutual dependencies connect.

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

**Decision:** Through its home runtime's subscriptions, wherever the instance is called from. A pod always hands its handlers the instance's own context (home runtime), never the caller's. So a call subscription whose `from` is a member placed into a runtime (its home is elsewhere) is `broken` there: it can never carry a call (`statusOf` takes the runtime id).
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

Superseded by 51: `swap` emits `pod-swapped { pod, implementation }` (coords are kept, so no subscription is rewritten).

## 14. In what order does a runtime list its members?

**Decision:** Create order (`add` order for placed members). `replace` keeps the replaced member's slot: `acme/db/mem#d` → `acme/db/file#d` stays where it was.
**Why:** Saving relies on it: a saved document lists instances in the order they were made, and a replacement doesn't reshuffle the file.
**Cost if wrong:** One sort in `members()`, and saved documents reorder.

Superseded by 51: there are no member slots; pods keep create (or place) order and a swap keeps the pod and its coords.

## 15. Can a runtime replace a member whose home is another runtime?

**Decision:** No. `replace` fails `denied` with `<coord>: replace it at its home runtime <home>` and changes nothing.
**Why:** The home runtime owns the pod and its outgoing calls (decision 11). A replacement made in a guest runtime would leave the home holding the old pod.
**Cost if wrong:** A cross-runtime replace that goes through the application to the home runtime.

Superseded by 51: `swap` acts only at the pod's home; elsewhere it is `denied` (`<pod>: swap it at its home runtime <home>`).

## 16. Does a member remember its config?

**Decision:** Yes, `Member.config` is the config the instance was created with. `replace` carries it over unless `opts.config` is given.
**Why:** Saving writes it (Task 9), and a replacement of the same kind (a newer version) usually wants the same settings.
**Cost if wrong:** Replacements that need a fresh config must pass one explicitly.

Superseded by 51: config lives on the pod record; `swap` keeps it unless `opts.config` is given.

## 17. Where does `ctx.publish` deliver?

**Decision:** In every runtime the instance is a member of (home and every runtime it was `add`ed to), each runtime delivering to its own live event subscriptions under its own policy and books. Runtimes register with the pod on `create`/`add`/`replace` and leave on `remove`/`replace` (a runtime-layer `WeakMap<Pod, Set<Deliver>>`, so no application is needed). Once the instance is gone from its home runtime, its publishes go nowhere. `ctx.publish` awaits every delivery, so a slow listener holds the publisher up and can push the publishing handler toward its own timeout.
**Why:** The ruling: an instance calls out at home but publishes into every runtime it belongs to — a client-side log listens where it was placed.
**Cost if wrong:** Restrict delivery to the home runtime; one test changes.

## 18. Which ports does `ctx.publish(op, data)` publish on?

**Decision:** Every source port of the instance whose op coord equals `op.coord` (normally one). Data that fails the op's output schema, or an op that is none of the instance's sources, is dropped and observed as an `exception` (`op` = the op coord); `publish` never throws. It resolves once every delivery on every port has settled (decision 17).
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
**Superseded in part by 49:** its subscriptions are deleted, not left waiting.

## 30. Does a call in another runtime wait for the home's provisioning pass?

**Decision:** Yes. A runtime made by the application consults every runtime's own unfinished passes (`Runtime.settling(coord)`; instance ids are unique, so only the home can have one) through `RuntimeOpts.settling`, so a call routed in a guest into or out of a placed member mid-pass waits for that pass, as at home (decision 26).
**Why:** The half-wired state of a pass must be invisible to callers wherever they call from.
**Cost if wrong:** Guests see the half-wired instance; their calls may fail `missing-component` during a pass.

## 31. In what order is a defined runtime opened?

**Decision:** `open(id)` returns an opened runtime as it is (a concurrent open gets the same promise). A defined one is built: its own instances first (`provision: false`, create order), then the runtimes its members come from are opened (one currently being opened is skipped), then its members are placed, then its subscriptions added (they may wait). A member whose home fails to open, or that cannot be placed (denied, or not held there), is skipped with the note `<runtime>: member <coord> skipped: <reason>` on `app.notes()` and the open goes on; subscriptions to it wait (decision 47). Any other failure is returned as the `NanoResult` fail; the runtime is taken down again (its members removed, it is no longer opened, its definition stays), while runtimes opened on the way stay open. An undefined, unopened id fails `not-found`.
**Why:** Creating its own instances before opening others makes mutual placement work: when A's members come from B and B's from A, B (opened while A is opening) can already place A's instances. The plan's order (homes first) would fail that case with `not-found`.
**Cost if wrong:** Swap two loops; mutually placing runtimes then fail to open.

## 32. Which instance ids are taken in an application?

**Decision:** Any id held by a member of the root or any child runtime, and any id a defined but unopened runtime declares among its instances. Applies to creates (and provisioning's generated ids) in runtimes the application makes.
**Why:** Instance ids are unique across the application (ruling), including runtimes opened later on demand; otherwise opening a saved runtime could fail on an id created meanwhile.
**Cost if wrong:** Opening a runtime can fail `exists`.

## 33. What does the application share with adopted children, and what does `runtimes()` list?

**Decision:** `createRuntime` and `open` make children that share the application's registry, tags and id check; an adopted runtime (another application included) keeps its own registry, tags and ids, and only its id must be free. `place` works between the root and direct children (adopted ones included, as they are runtimes); runtimes inside an adopted application are out of reach (placing across nested applications is out of scope). `runtime(<application id>)` gives the root; `runtimes()` lists child ids, opened and defined, not the root. Defined runtimes always use the allow-all policy (the only saved policy). The id check and the pass wait (decision 30) cover the root and direct children only: the children of an adopted application are not consulted (out of scope with placing across nested applications).
**Why:** Nesting is adoption only (ruling); the root is the application itself.
**Cost if wrong:** A cross-application place that walks nested applications.

## 34. What happens to placed copies when an instance is replaced at its home?

**Decision:** Every runtime it was placed into follows: on the home's `instance-replaced`, the application calls `rehome(from, newMember)` on each runtime whose member `from` has that home. The new coord and pod take the old member's slot (create order holds), publish delivery moves to the new pod, the runtime emits `instance-replaced`, and its subscriptions are rewritten from → to under its own policy. If that policy denies the rewrite, the member is still swapped but its subscriptions stay on the old coord (now `waiting`) and `rehome` returns the denial, which the application records on `app.notes()` as `<runtime>: following <from> -> <to>: <reason>`. Replacing with the same implementation keeps the coord: guests swap to the new pod (the `exists` check skips `next.coord === from`). `rehome` refuses a member whose home is this runtime (`denied`: replace it there). The instance's tags move to the new coord.
**Why:** The home disposes the old pod; a guest must not keep it. Each runtime polices its own rewires (decision 27), so a guest can refuse the new implementation without the home being blocked.
**Cost if wrong:** Guests drop the member instead and the person reconnects by hand.

Superseded by 48: a placed pod is the home's record, so a replacement keeps every coord and there is nothing to rewrite or refuse.

## 35. Opens that overlap

**Decision:** Each open carries its chain (the runtimes it is opening, outermost first). Building a runtime, a home on this chain is skipped (it made its instances already, decision 31); a home being opened by another, independent open is waited for until its own instances exist (not until it is fully open: two overlapping opens of runtimes placing into each other would wait on each other forever); any other home is opened in full. `open` never rejects: a throw while building fails `threw` (`opening <id>: <message>`) and the runtime is taken down. Taking a failed runtime down removes everything placed into it.
**Why:** Skipping every runtime being opened made `Promise.all([open('signer'), open('client')])` fail `not-found` for the client, whose members signer had not made yet.
**Cost if wrong:** An open may resolve while a home another caller is opening is still adding its subscriptions; that caller's own `open` tells when it is done.

## 36. Definitions and tags keep ids and coords tidy

**Decision:** `define` fails `exists` (`instance id <id> is taken`) when one of its instances' ids is already taken in the application (decision 32). An instance's tags are dropped once it is gone from every runtime (removed at home); removing it from a runtime it was placed into keeps them.
**Why:** Ids are unique across the application, definitions included; tags keyed by a coord no runtime holds would reattach to an unrelated instance created later with that coord.
**Cost if wrong:** A clash surfaces only at `open`; stale tags on reuse.

## 37. Does a round trip keep how a runtime's own instances and placed members interleave?

**Decision:** No. The v2 document keeps a runtime's own instances in create order and its placed members in placing order, as two lists; on load its own instances come first (decision 31), then its members. Everything else round-trips: own instances with config, placed members with home, subscriptions (ids, order, status) and tags. Pinned by `document.test.ts` "a round trip gives the same runtimes, …".
**Why:** The brief's `RuntimeDef` has separate `instances` and `members`; create order matters for creates and replacing, not for placed copies.
**Cost if wrong:** An `order` list of coords per runtime in the document.

## 38. How is the application's own root runtime saved and loaded?

**Decision:** Saved as a runtime under the application's id, only when it holds members or subscriptions, and listed first in `open`. `loadDoc(doc, { registry, policy?, id? })` builds the application with `id` (default `app`); a saved runtime with that id is the root: its instances are created (`provision: false`), its members' homes opened and placed, its subscriptions added, before the rest of `open`. Saved under another id, the root loads as an ordinary child runtime (opened, since it is in `open`). Pinned by "the root is saved under the application id only when …" and "a root saved under another id loads as a child runtime, opened".
**Why:** The document has no application id; a mismatch should lose nothing.
**Cost if wrong:** An `application` id field in the document.

## 39. Which runtimes and policies does `saveDoc` write?

**Decision:** Every child runtime, opened (read from live) or only defined (its definition, unchanged), in `runtimes()` order; adopted runtimes are skipped (`Application.adopted(id)`), and members placed from them then load with a `has no home` note. `open` lists the opened ones. `Policies.allowAll()` now returns one shared policy, so a runtime using it is saved with `policy: 'allow-all'`; a runtime with any other policy is saved without the field and loads with allow-all (known limitation: custom policies are not data yet). `providers` are the providers of the implementations of every saved instance, sorted; `tags` are the coords held by saved runtimes with at least one tag. Pinned by the `saving and loading` tests in `document.test.ts`.
**Why:** Adopted runtimes keep their own registry and ids (decision 33); fine-grained policies are a non-goal.
**Cost if wrong:** Saving adopted applications as nested documents; a policy schema.

## 40. What does `loadDoc` do with a document that does not fully fit?

**Decision:** It never throws or rejects. An invalid document (per `checkDoc`) gives an empty application and the reason as the only note. Otherwise each problem is skipped with a note and the rest loads: `provider <coord> is not registered` (note only); `<runtime>/<id>: no implementation <coord>` (instance dropped); `<runtime>: member <coord> has no home <runtime>` (member dropped: its home is not in the document, is the runtime itself, or does not hold that instance after the drops above); `<runtime>/<sub id>: <reason>` (subscription dropped: invalid shape or a repeated id); `<runtime>: <reason>` when a runtime cannot be defined (it is not opened either) or fails to open (it stays defined); `<runtime>: member <coord> skipped: <reason>` when a member's home fails to open while opening (from `app.notes()`, decision 31); `<runtime>: saved with a custom policy; loaded with allow-all` for every runtime saved without `policy` (the root only when no `policy` is given to `loadDoc`); `load: <message>` for anything thrown. Subscriptions whose ends were dropped stay, `waiting`. `checkDoc` answers `not a nano v2 document` unless `nano` is 2, else the first schema error as `<path>: <message>`. Pinned by the `loading what does not fit` and `checkDoc` tests.
**Why:** A document written by another registry or an older build should open as far as it can, with each loss visible.
**Cost if wrong:** Refuse the whole document on the first problem.

## 41. One id rule, enforced where things are made

**Decision:**
- One rule, `ID = /^[^/\s#\x00-\x1f\x7f]{1,64}$/`, exported from `runtime/members.ts`. It applies to runtime, instance and subscription ids.
- Where it is enforced:
  - `createRuntime` throws `bad runtime id` (it is a factory, like `iface`). This covers `createApplication`.
  - `Application.createRuntime` fails `invalid-input`.
  - `Runtime.create` fails `invalid-input`.
  - `subscribe` fails `invalid-input` for a caller-chosen id.
  - `parseInstance` accepts only coords whose id fits the rule, so subscription ends and placed members follow it.
- Provisioning cuts a generated id's base to 50 characters.
- `define` checks the definition against `RuntimeDefSchema`, the document's own runtime schema, which now lives in `application.ts`, and refuses a config that is not JSON.
- `Runtime.create` and `replace` refuse a config that is not plain JSON (`isJson` in `schema.ts`).
- The document schema reuses these constants.

Pinned by the "only what the document can hold is made" tests in `document.test.ts`.
**Why:** The application should only be able to hold what its document can hold, so `checkDoc(saveDoc(app))` cannot fail on ids or configs.
**Cost if wrong:** Saving produces documents that refuse to load.

## 42. Loading: repeated members, held tags, copied configs

**Decision:**
- A member repeated in one runtime is loaded once, with the note `<runtime>: member <coord> is repeated`.
- `loadDoc` applies tags only to coords held after loading (by an opened runtime or declared by a defined one), so a dropped instance's tags are not kept.
- `saveDoc` deep-copies configs from opened runtimes and from definitions, so changing the document never changes what runs.

Pinned by the matching tests in `document.test.ts`.
**Why:** A repeated member otherwise failed the whole runtime's open. Stale tags would attach to a later instance with that coord (decision 36). A shared config would let an edit to a saved document reach a running instance.
**Cost if wrong:** Runtimes fail to open; tags appear on the wrong instance; configs change unseen.

Limits: `define` enforces the per-runtime ones (500 instances or members, 2000 subscriptions) through `RuntimeDefSchema`; only live creation (`create`, `place`, `subscribe`, `createRuntime`) and the 50-runtime document limit are unenforced. An application past them saves a document that `checkDoc` refuses.

## 43. External signer: where do the map and the log live?

**Decision:** The vault and the map live in `signer`; the log lives in `signer-client`. `vault.keys → map.format` is an event subscription in `signer`; the map is placed into `signer-client`, where `map.line → log.append` is an event subscription. The vault is never placed anywhere.
**Why:** Event subscriptions stay within one runtime (decision 6), and an instance publishes into every runtime it is a member of (decision 17). Placing the map, not the vault, keeps the vault private to `signer` while the client still sees a formatted view of what it stores; the log stays in the client, as in the spec's walkthrough.
**Cost if wrong:** Place the vault into the client (exposing `create` and `sign-with` there) or move the log into `signer`; one example changes.

## 44. Examples: how are the dependencies wired?

**Decision:** The external signer uses provisioning (`create(…, { provision: true })`): the generator and signer find the one vault beside them, and in `signer-client` the tester finds the placed generator and signer, because they are placed before the tester is created. The messenger subscribes explicitly, with named ids (`inbox-store`, `composer-messaging`, `messages-inbox`), since plugging in and unplugging is what it demonstrates. Event subscriptions are always explicit (provisioning only makes call subscriptions).
**Why:** One example of each: provisioning is what a host does when a person adds a widget; explicit subscriptions are what the person does when plugging in, and named ids read better in `nano.json` and in `unsubscribe`.
**Cost if wrong:** None to the model; the examples change.

## 45. Examples: how does a test call into an instance from outside the graph?

**Decision:** A known gap, test-only: the example tests call `rt.member(coord)!.pod.invoke(portKey(iface.coord, op.coord), input)` (their `press` helper). It skips the runtime's policy, its books and the provisioning-pass wait, so it is not how a host should call in. The planned fix (plan 2) is a host-side invoke through the runtime, policed and booked like any other message. To see what a source publishes, a test subscribes a probe sink whose input is `Type.Unknown()` (it fits any source, `fits`).
**Why:** There is no caller instance outside the graph and no host-side invoke yet; calls between instances only travel through subscriptions.
**Cost if wrong:** A host built on `pod.invoke` would let button presses past policy and leave them out of the books.

## 46. External signer: who makes the keys?

**Decision:** The vault. `Vault.create({ count, purpose })` makes Ed25519 key pairs inside the vault (private keys non-extractable) and returns only the public keys; `KeyGenerator.create-keys` asks the vault to do it. The vault has no `store`.
**Why:** Private keys must never travel in messages: messages are observed and visible to policy, and a `store` would let any caller inject keys. This is also the shape the passkey and other-origin variants need, where the keys never leave their holder.
**Cost if wrong:** An import action on the vault, guarded by policy, for keys made elsewhere.

## 47. Whole-branch review: what the application notes, and smaller rulings

**Decision:**
- The application keeps `notes()`: what it skipped or could not follow, oldest first: a member an open skipped (decision 31), and a guest whose `rehome` failed (decision 34). `open` keeps its `NanoResult<Runtime>` contract; `loadDoc` appends `app.notes()` to its own notes.
- `createHostPod` gives `make` the handler timeout: a `make` that does not settle fails `timeout`; a late settle is ignored and its handlers never used.
- `define` stores its own copy, and `definition()` returns a copy. It rejects an instance id repeated within the definition (`exists`, `instance id <id> is repeated`).
- `saveDoc` writes an unopened definition with `policy: 'allow-all'`: it opens with allow-all whatever it says, so the custom-policy note on load (decision 40) is only for runtimes that really had one.
- A message waiting for a provisioning pass whose subscription is gone when the pass ends fails `not-found` and is not delivered.

Pinned by the matching tests in `application.test.ts`, `document.test.ts` and `pod.test.ts`.
**Why:** Each was a silent loss: a guest kept a disposed pod (same-implementation replace), one bad home failed every runtime placing from it, a hung `make` hung its creator, an edit to a definition changed what opened later.
**Cost if wrong:** Notes are unbounded (a drain or cap later); an open that should fail on a missing member needs a strict flag.

## 48. Pods in the runtime (pods revision, task 1)

**Decision:**
- A runtime holds **pod records** `{ id, implementation, config, home, next, instances, holders }` (`runtime/pods.ts`, which replaces `members.ts`). Instance coords are `<pod>#<n>`; `parseInstance` gives `{ pod, index }` and accepts only a pod id under the id rule (decision 41) and an index without leading zeros. `create` fails `invalid-input` on a bad pod id or a `count` that is not a whole number from 1.
- `create` holds the pod before it awaits anything: the id is taken and its instances are `starting`. A `make` that throws or times out leaves that instance `failed` and the create succeeds; only validation fails it (unknown implementation `not-found`, taken id `exists`, bad config `invalid-input`). This overturns two runtime tests: "a pod that cannot be made fails threw and adds nothing" (now: created, failed) and "an id taken elsewhere while the pod was being made fails exists" (the id is now held from the call, so that race cannot happen; the re-check after the await is gone, and the test pins that a second create of the id fails while the first is still making).
- An end whose instance is not `running` makes a subscription `waiting`. Every runtime holding a pod is one of its `holders` (its publish delivery and a status refresh); an instance's state change refreshes them all.
- Placing shares the record, not a copy. The publish registry is the record's `holders` (was a `WeakMap<Pod, Set<Deliver>>`, decision 17); a context publishes only while its own host is still the instance's. The pass wait stays keyed on instance coords, now `<pod>#<n>`.
- `replace(pod, implementation, opts)` remakes every instance of the pod off to the side, then swaps them all at once; any make failing changes nothing. Coords are kept, so no subscription is rewritten or re-policed, tags stay, and guests see the new implementation through the shared record. `rehome` is gone (decision 34 superseded) and `instance-replaced` is now `pod-replaced { pod, implementation }`. The application tests on rewrites a guest's policy denies, and on `rehome` itself, are deleted; the rest are kept on the new coords.
- `remove(pod)` takes a pod id: at home the instances are disposed and `stopped`; placed, only the membership goes. Subscriptions to it still wait (the cascade comes with removal in a later task). *Superseded in part by 49:* they are deleted.
- `members()`/`member()` are replaced by `pods()`, `pod(id)` (a `PodInfo`), `instances()` and `record(id)` (the live record, for placing, and for the examples' test-only `press`, decision 45). `PodInfo` carries `home`, so the pods test "reports its implementation, config, count, state and instances" now expects `home: 'app'`.
- Provisioning names a made pod `<last segment>-<first free n from 1>` and subscribes to its `#0`. It matches instances whatever their state, so a failed match still gets a subscription; when that subscription is not live the role is unsatisfied with `subscription <id> to <coord> is <status>` (Review Focus 5). With `count` above 1 every instance is provisioned. The old test "a nested create that fails leaves the role unsatisfied with its reason" became that case.
- For the tests this task turns green: `addInstance(pod)` (the next index, home only) and a minimal `connect` (a `{ pod }` target, by `first` — the lowest running index — or `index`). The connecting task brings the other targets, tags and the `2 match` rule.
- Until the application starts pods: `RuntimeDef` keeps its shape, each `instances` entry is a pod with one instance, `members` and subscriptions name `<pod>#<n>` coords, `place(coord, from, to)` places that coord's pod, and saving writes a placed pod by its first instance. A pod's count is not saved yet. Pod ids are unique across the application. A home whose pod's make fails now opens with that pod failed, so the member is placed and subscriptions to it wait (the application test changed accordingly).
- Events keep today's channel (ruling): `instance-added`/`instance-removed` per instance, in the runtime that acted; no state-change events until the one stream.

**Why:** The spec: a pod owns its instances, their states and their lifecycle; a failing make never fails its runtime; coords are deterministic and survive a swap. Sharing the record makes "placed without copying" literal and removes the follow-the-home machinery.
**Cost if wrong:** Guests can no longer refuse a new implementation by policy; a guest that must would need a per-runtime veto on `pod-replaced`.

Superseded in part by 51: `replace` is now `swap` and `pod-replaced` is `pod-swapped`.

## 49. Removal cascades; unavailable waits (pods revision, task 2)

**Decision:**
- Removing an instance or pod **deletes** every subscription naming the removed coords, in every runtime holding the pod (each emits `instance-removed`, then `subscription-removed` per subscription). Removing at home also evicts the pod from guests; removing from a guest only drops that runtime's membership and its subscriptions to it. Supersedes decision 29's "its subscriptions to it go `waiting`".
- An **unavailable** end (instance `failed`, `stopped` or `starting`) still makes the subscription `waiting`; it goes `live` when the instance runs again. Only removal (the end is gone) deletes.
- `scale(pod, count)` (0 to 500: a pod with no instances is `stopped`, as after `removeInstance` of its last; `create` stays 1 to 500; the same cap on `create`, `invalid-input` above) removes the highest indices going down and adds at `next` going up; indices are never reused. `removeInstance` and `restart` act at home only (`denied` elsewhere; unknown `not-found`). `restart` remakes in place, only a `failed` or `stopped` instance (else `invalid-input`: a second start would leak the first host); a failing make returns `threw` and the instance stays `failed`.
- A failed make keeps its reason on the instance (`PodInfo.instances[].reason`) and reports an `exception` observation (`op: 'make'`) through the existing `observe` option; Task 6 moves it to the event stream.

- A pod removed during its provisioning pass stops being made and wired: nothing subscribes to its coords afterwards.
- `addInstance`/`scale` up emit `instance-added` in every holder, like removal.

**Why:** The spec: unavailable is temporary and a connection should wait for it; deleted is final, and a subscription to a coord that will never be reused only misleads.
**Cost if wrong:** A caller wanting "reconnect on re-add" must resubscribe; scaling down silently deletes the subscriptions of the highest instances.

## 50. Connect: end selectors resolved once (pods revision, task 3)

**Decision:**
- `resolveEnd` (`runtime/connect.ts`) is pure over the runtime's pods (own and placed) and `tagsOf`, and never throws: a non-object `target`/`instance`, an unknown target kind or `by`, or non-string tags are `invalid-input`. None matching is `not-found`, several `ambiguous` (`<n> match`, listing the coords). Hits are counted across all matching pods: `first` yields the lowest running instance of each pod, `index` the coord index, `tags` every tagged instance. A guest runtime's `implements`/`implementation` targets consider placed pods as well as its own.
- `subscribe` with a concrete end fails `not-found` when the end's pod is in this runtime, its index is below the pod's `next` and the instance is missing (definitely deleted: indices are never reused). A coord whose pod is absent, or whose index is at or above `next`, is still accepted and waits (loading and later creation rely on that), as do unavailable instances.

**Why:** A selector means "pick one now"; a coord is a promise about the future.
**Cost if wrong:** A pod removed and its id reused can pick up a hand-made subscription made while the pod was absent; closing that needs pod tombstones. A typo'd coord for an absent pod waits forever.

## 51. Swap in place (pods revision, task 4)

**Decision:**
- `Runtime.swap(pod, implementation, opts?)` replaces `replace`, at home only (`denied` elsewhere, unknown `not-found`). Coords, tags and subscriptions are kept; config is replaced when `opts.config` is given, else kept. Every instance is made off to the side; the old instances serve until all are made, then all switch at once and every runtime holding the pod recomputes its statuses (a subscription whose port the new implementation lacks is `broken`). Any make failing changes nothing. The event is `pod-swapped { pod, implementation }` (Task 6 folds it into the one stream).
- An instance added while a swap is pending is made with the new implementation too: the swap keeps making until every current instance has a new host, then switches. If the instance's own (old-implementation) start finishes after the switch, its host is dropped.
- Calls already inside an old instance finish there with its result; calls after the switch reach the new one. Disposing a host only refuses new calls, so disposing it at the switch is "disposed once its in-flight calls settle"; no in-flight tracking is needed while dispose has no teardown of its own (a sandboxed host with one would have to wait).
- `Application.place(pod, from, to)` takes a pod id and adds the same record to `to`. An instance coord still stands for its pod (saved members name one until the application starts pods). Removing at home deletes the pod's subscriptions and membership in every runtime holding it (decision 49), now pinned with two guests.

**Why:** The spec: a swap keeps coords and never makes a subscription wait; placed pods are swapped once, at home, and every runtime sees it through the shared record.
**Cost if wrong:** A swap that should only reach some instances (a canary) needs a per-instance swap; a host with real teardown needs dispose to wait for in-flight calls.
