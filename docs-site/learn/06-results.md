# Results

Each call to a pod gives a **result value**, so a failure is data you can read, log or pass on. Dividing by zero is not an exception; it is a failure.

<<< @/../examples/tutorial/06-results.ts#builder

- A method's return value is a success: `{ ok: true, value }`.
- Any throw is a failure, `{ ok: false, fail }`, of type `threw` with the error's message.
- To choose the failure's type, throw an Error carrying `fail`: the builder passes that failure on as it is. Here, division by zero is `invalid-input`.

Call it through `app.call`, which gives each result as it is:

<<< @/../examples/tutorial/06-results.ts#results

## What it prints

```
{"ok":true,"value":{"a":2,"op":"+","b":3,"result":5}}
{"ok":false,"fail":{"type":"invalid-input","reason":"division by zero"}}
{"ok":false,"fail":{"type":"threw","reason":"the result is too large"}}
{"ok":false,"fail":{"type":"invalid-input","reason":"division by zero"}}
```

The typed client, `get(Calculator)`, unwraps a success to its value and throws an Error carrying the `fail` on a failure: handy when you expect success, where `app.call` lets you look at every outcome.

::: details Raw
Without the builder, a handler returns the result value itself: `success(value)`, or `failure(type, reason)`. The last line above is this pod's:

<<< @/../examples/tutorial/06-results.ts#raw-impl

<<< @/../examples/tutorial/06-results.ts#raw
:::

Next, [events](/learn/07-events): the calculator tells others what it calculated.
