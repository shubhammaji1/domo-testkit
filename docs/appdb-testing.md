# AppDB testing

Seed document envelopes with `{ id, content }`. The direct `kit.appdb.list/get/query` API returns clones in the internal v2-style model. HTTP requests serialize through explicit v1 or v2 adapters. Enable v1 with `appdbVersions: ['v1', 'v2']`; no request is rewritten to another version.

Create and replace bodies must contain only `{ content: object }`. IDs are immutable. Create allocates a predictable ID and the configured timestamp. It returns `owner`, `createdBy`, `updatedBy`, `createdOn`, `updatedOn`, `syncRequired`, `id`, and `content`. Supplied fixture envelopes may include optional `datastoreId` and `collectionId`; generated documents omit these because datastore management is not simulated. Clock injection controls updated timestamps as well as create timestamps.

Query uses a filter object directly, for example `{ 'content.done': false }`. Prefix content properties with `content.`; metadata can be queried directly with `{ id: 'todo-1' }`. There is no executable query language. Equality is structural for objects/arrays, scalar equality can match array members, null equality matches null/missing, and comparisons require matching scalar types. Dotted lookup traverses own object properties only. This subset is not full MongoDB compatibility.

Partial updates use `{ query, operation }`, such as `{ query: {}, operation: { $inc: { 'content.count': 1 } } }`, and return a numeric matched-document count. Updates operate on all matches. Missing numeric fields start at zero; nonnumeric targets and numeric overflow fail. `$unset` of an absent path is a no-op. Only `content.*` may be updated, and overlapping update paths are rejected. An invalid batch leaves all documents unchanged; this all-or-nothing simulator behavior is an implementation choice, not a claim about Domo transactions.

Collection schemas declared in a manifest validate provided non-null column values. They do not enforce required fields. Use a custom `collectionSchemas` validator when tests need stricter content rules. Schema-free collections accept arbitrary safe JSON objects. This validation is a fixture convenience, not a reproduction of Domo sync conversion.

Use `appdb:permission-denied` for explicit synthetic authorization failures. Permission inheritance, document filters, user identity, concurrent backend ordering, datastore sync and synchronization conflicts are not modeled. Verify actual authorization separately in Domo. The initial release has no live integration or mutation feature.

Every reset restores the baseline and ID sequence. `seed` replaces current state; `{ replaceInitial: true }` changes the baseline explicitly. Input, read results and request history are isolated copies. Concurrent HTTP calls commit in their handler arrival order; do not assert remote concurrency semantics from this ordering.
