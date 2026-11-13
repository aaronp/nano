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
