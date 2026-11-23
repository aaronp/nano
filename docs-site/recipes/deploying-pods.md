# Pods that deploy pods

A pod can add and remove other pods while the app runs. Raft's cluster pod creates a cluster as a set of runtimes, one per node, and removes them again. It goes through the host's `deploy` pod ([Using the host from a pod](/recipes/host-pods)).

A cluster is plain data, built by a pure function:

<<< @/../examples/raft/deployment.ts#cluster-deployment

- Each node gets a runtime named `<name>-<i>`, with its own `node`, `ledger` and seeded `random` pods.
- Each runtime also places the `raft-messaging` and `raft-clock` pods that the cluster's `nano.json` already defines, so every node shares them; they are placed, not defined again.
- Call edges connect each node to its pods, and the messaging back to the node.

`create` hands that data to `deploy`:

<<< @/../examples/raft/cluster.ts#cluster-deploy

`remove` hands the runtime names to `undeploy`, which removes them and the pods placed nowhere else, so the shared messaging and clock stay:

<<< @/../examples/raft/cluster.ts#cluster-remove

The cluster remembers only in memory which clusters it made and their sizes. After a reload it no longer knows a cluster's size, so it tries 5 nodes, then 3.

**When it runs:** in the cluster's panel, create a cluster of 3 and Approve: three runtimes appear and the nodes, all eager, start an election by themselves. Remove it and Approve: its runtimes and node pods are gone. A name already in use is refused, with nothing added.

<OpenInNano src="examples/raft/nano.json"/>
