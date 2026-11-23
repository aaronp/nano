# Policies

A call edge says which pod the calculator reaches; it does not stop anyone else. A runtime's **policy** is its yes or no on each message travelling in it, before it is delivered. Here only the calculator may save to the history:

<<< @/../examples/tutorial/13-policies.ts#rules

- Each rule `allow`s or `deny`s kinds of message (`call`, `pipe`, `subscribe`, … or `'*'`), from a pod or `'host'` (`from`), to a pod (`toPod`), any op of an interface (`toInterface`) or one op (`toPort`). A field left out matches anything.
- The first rule that matches decides; when none does, the message is refused.

`PolicyRules(rules)` makes them a policy, given to the Application for runtime `main`:

<<< @/../examples/tutorial/13-policies.ts#policies

A refused message is not delivered: its result is a `denied` failure, its reason the rule that refused it. The calculator's save matched `rules[0]`; the host's matched `rules[1]`.

## What it prints

```
2 + 3 = 5
{"ok":false,"fail":{"type":"denied","reason":"rules[1]"}}
[{"a":2,"op":"+","b":3,"result":5}]
{"ok":false,"fail":{"type":"denied","reason":"rules[1]"}}
```

A policy in code is any `{ isAllowed(ask) }` giving `{ approved: true }` or `{ approved: false, reason }`; it is asked each message's runtime, kind, `from`, `to`, port and data, and whether `from` is `outside` the runtime.

::: details Raw
The same rules can be data, the runtime's `policy` in its deployment (and so in a `nano.json`). A runtime has one or the other, never both. It prints the last line:

<<< @/../examples/tutorial/13-policies.ts#raw
:::

Next, [the Application](/learn/14-application): changing what runs, and its own yes or no.
