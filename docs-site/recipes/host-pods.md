# Using the host from a pod

A host offers pods of its own to the pods it runs ([In the host](/concepts/host)). In the nano app they are placed in the `main` runtime, among them `ui` (`HostUI`: alert, approve, the app bar) and `deploy` (`HostDeploy`: add and remove pods and runtimes). A pod uses one by depending on its interface, like any other pod.

Raft's cluster pod creates whole clusters, so it needs `HostDeploy`:

<<< @/../examples/raft/cluster.ts#cluster-needs

and calls it from its `create` action:

<<< @/../examples/raft/cluster.ts#cluster-deploy

- `dependencies: { deploy: HostDeploy }` says what the pod needs, not which pod gives it.
- `ctx.one(HostDeploy)` finds the one pod a call edge connects it to that provides `HostDeploy`; with none (or several), `create` returns that failure.
- `call.deploy(…)` is a call like any other, and it is the host that decides: in the nano app, it asks you.

The cluster's `nano.json` has no call edge to `deploy`; it can't know the host's pod names. When the nano app imports a pod with a dependency that no call edge meets, it wires it to the one placed pod that provides it, and says so in a toast.

**When it runs:** import Raft and the cluster is wired to the host's `deploy`. Creating a cluster opens an approval dialog listing what will be added; Approve deploys it, and Deny (or no answer within 20 seconds) makes `create` fail with nothing added.

<OpenInNano src="examples/raft/nano.json"/>
