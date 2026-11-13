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
