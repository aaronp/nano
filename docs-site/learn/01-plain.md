---
playground: 01-plain
---

# A calculator in plain TypeScript

We start from code you already know, so each later step changes one thing. This is the calculator the rest of Learn turns into a nano component:

<<< @/../examples/tutorial/01-plain.ts#plain

Dividing by zero is an error, thrown like any other:

<<< @/../examples/tutorial/01-plain.ts#use

## What it prints

```
2 + 3 = 5
1 / 0: cannot divide by zero
```

Nothing here is nano yet. Next, the calculator gets a [contract](/learn/02-contract).
