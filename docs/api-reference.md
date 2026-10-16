# Public API

`createDomoTestKit(config?: TestKitConfig)` constructs an isolated kit. Import it and all public types from `domo-testkit`. Import `useDomoTestKit` from `domo-testkit/vitest` only in Vitest code. The main entry has no Vitest runtime dependency.

| Member                                               | Semantics                                                                                                                                            |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start(): Promise<void>`                             | Start MSW Node interception. Idempotent. Reject a second active kit in the same worker.                                                              |
| `stop(): Promise<void>`                              | Cancel pending delays, close interception and restore installed globals. Idempotent.                                                                 |
| `reset(): void`                                      | Cancel pending requests, restore baseline fixtures and ID sequence, clear faults/history/violations.                                                 |
| `seed(fixtures, { replaceInitial?: boolean }): void` | Replace all current fixture registries transactionally. Default reset baseline remains unchanged. `replaceInitial: true` establishes a new baseline. |
| `datasets.set(alias, rows)`                          | Validate and replace source rows with isolated copies.                                                                                               |
| `datasets.get(alias)`                                | Return isolated exposed rows after field mapping.                                                                                                    |
| `appdb.list/get/query`                               | Read isolated internal v2-style documents; no HTTP or permission scenario evaluation.                                                                |
| `fetch(path, init?)`                                 | Relative URL adapter to native fetch. Requires a started kit. Returns `Response`.                                                                    |
| `createDomoClient()`                                 | Parsed JSON `get/post/put/delete`; errors carry a numeric `status`. Empty delete response maps to `undefined`.                                       |
| `installDomoGlobal({ overwrite?: boolean })`         | Install the shim explicitly; return an idempotent restorer. Stop restores nested installs in reverse order.                                          |
| `requests()`                                         | Sanitized, deep-copied recent request history. Bodies omitted unless enabled.                                                                        |
| `setScenario(name, options?)`                        | Replace a named scenario. Different scenarios run in activation order.                                                                               |
| `clearScenario(name?)`                               | Remove one or all scenarios.                                                                                                                         |
| `assertNoUnhandledRequests()`                        | Throw on blocked paths/methods/versions/query features, including failures caught by application code. Call before reset.                            |
| `summary()`                                          | `{ mode: 'offline-mock', requests, unhandled, contracts }`. Counts are bounded recent diagnostics, not suite totals.                                 |

Also exported: `validateConfig`, `normalizeManifest`, `validateQuery`, `contracts`, `TestKitError`, and public TypeScript interfaces. `contracts` is an immutable registry of implemented AppDB method/path/status/response/source entries.

## Configuration

Named TypeScript interfaces are accepted for document content, dataset rows, fixture seeds and overrides. `Document<T>` retains the supplied content model's field types; no string index signature is required. Input objects are validated as plain JSON at runtime, and read results retain the default JSON row shape. The parsed Domo client also accepts typed request interfaces and rejects non-JSON values before serialization.

| Option                                | Default / meaning                                                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `datasets`                            | Alias to source JSON rows; empty object                                                                                                                |
| `appdb`                               | Collection name to document envelopes; empty object                                                                                                    |
| `baseUrl`                             | `https://domo.test`; an HTTP(S) origin without path or credentials                                                                                     |
| `appdbVersions`                       | `['v2']`; optionally explicitly include `'v1'`                                                                                                         |
| `manifest`                            | Plain manifest object; relevant mappings validated, unrelated metadata ignored                                                                         |
| `manifestAdapter`                     | `'modern'`; `'legacy-mapping'` enables old `mapping`, `'collections-mapping'` enables `collectionsMapping`. Ambiguous simultaneous forms rejected.     |
| `datasetSchemas`, `collectionSchemas` | Map of `.parse()` validators; validation only, transforms are not applied. Programmatic trusted code only.                                             |
| `clock`                               | Function returning fixed `2026-01-01T00:00:00.000Z` by default                                                                                         |
| `idFactory`                           | Function of sequence starting at 1; default predictable UUIDs. Seed collisions skipped, bounded to 10,000 attempts.                                    |
| `userId`                              | Numeric string `'1'`; v1 requires safe integer conversion                                                                                              |
| `allowOrigins`                        | Empty; exact HTTP(S) origins only. Never bypass recognized Domo hosts/surfaces. Explicitly enables real HTTP traffic to unrelated allowlisted origins. |
| `secrets`                             | Additional literal secrets to redact, including URL-encoded representations                                                                            |
| `captureBodies`                       | `false`; enable sanitized request JSON history                                                                                                         |
| `maxFixtureBytes`                     | 8,000,000 total JSON state budget; up to 100,000,000                                                                                                   |
| `maxRequestBytes`                     | 2,000,000 streamed request-body cap; cannot exceed 2,000,000                                                                                           |
| `maxHistory`                          | 1,000 records/violations, bounded ring history                                                                                                         |

Fixtures require plain JSON, maximum depth 32 and 500,000 visited nodes per validation. Prototype keys, accessors, cycles, non-finite numbers and non-JSON values are rejected. Names disallow separators and reserved operation names. Fixture documents require `id` and object `content`. Supplied metadata is preserved; generated metadata is deterministic.

## Scenarios

Options: `alias`, `collection`, `method`, `status` (400–599), `delayMs` (0–60,000), `body` (JSON), `once`. Filters combine; irrelevant families do not affect each other. A generic scenario can target both families. The first returning scenario wins; delay scenarios continue to normal handling or later scenarios.

| Name                                                                                          | Effect                                                          |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `http:error`                                                                                  | Synthetic HTTP error; default 500                               |
| `network:error`                                                                               | Network error response; fetch rejects                           |
| `network:slow`                                                                                | Apply delay; then normal handling                               |
| `dataset:timeout`                                                                             | Dataset-scoped delay for caller-owned timeout/abort tests       |
| `dataset:empty`                                                                               | Return `[]`                                                     |
| `dataset:invalid-json`                                                                        | Return malformed JSON with JSON content type                    |
| `response:override`                                                                           | Return configured JSON body; default 200, optional error status |
| `appdb:permission-denied`                                                                     | Synthetic 403                                                   |
| `appdb:collection-not-found`, `appdb:document-not-found`                                      | Synthetic 404                                                   |
| `appdb:create-failure`, `appdb:update-failure`, `appdb:delete-failure`, `appdb:query-failure` | Operation-scoped synthetic 500, overridable error status        |

Use response overrides to model missing columns, unexpected types, schema mismatch and nulls without weakening valid-fixture validation. Fault payloads are marked `toe: DOMO-TESTKIT-SYNTHETIC`. Reset/stop cancels delayed requests before any subsequent mutation. Already committed requests are not rolled back except by reset restoring the baseline.
