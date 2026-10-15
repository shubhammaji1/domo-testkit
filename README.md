# domo-testkit

**Test Domo Apps Before Domo Tests You.**

An offline testing library for Domo Custom Apps and TypeScript services. Use your existing Vitest suite, mock HTTP with MSW, and exercise dataset loading and stateful AppDB operations without credentials. This is an independent community project, not affiliated with or endorsed by Domo.

Version 0.1.0 is a release candidate. Tests verify the simulator and application behavior against documented contract subsets; they do not prove a live Domo deployment works.

## Installation

Requires Node **22.12+**, ESM, MSW **3.0.3+ within major 3**, and optionally Vitest **5.0.4+ within major 5**. The package is not yet published. Build and verify the local tarball:

```sh
npm ci
npm run build
npm run smoke
```

The smoke task packs `domo-testkit-0.1.0.tgz`, installs it in a clean temporary project, checks declarations, and executes the public runtime and CLI. To install that artifact in your application, use its absolute path with your package manager and install `msw@3.0.3` and `vitest@5.0.4` as development dependencies. A future npm release will use the exact name `domo-testkit`; no publication is performed by these commands.

## Five-minute quick start

Create a test file in your existing Vitest project:

```ts
import { expect, test } from 'vitest';
import { useDomoTestKit } from 'domo-testkit/vitest';

const kit = useDomoTestKit({
  datasets: { sales: [{ amount: 100 }] },
  appdb: { TodoList: [] },
});

test('loads sales offline', async () => {
  const domo = kit.createDomoClient();
  expect(await domo.get('/data/v1/sales')).toEqual([{ amount: 100 }]);
});
```

`useDomoTestKit` starts interception before the suite, checks for blocked requests after each test, resets state, and stops interception after the suite. Add it to a sequential suite or setup file. Each Vitest worker has isolated fixture state. Concurrent suites sharing one worker must use one kit; overlapping kits are rejected.

## Supported APIs

| Surface                                        | Scope                                                            |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| Dataset alias `GET /data/v1/:alias`            | JSON rows, manifest aliases, `fields`, `limit`, `offset`         |
| App Framework AppDB v2                         | Create/list/get/replace/delete, query and partial update subsets |
| App Framework AppDB v1                         | Explicit opt-in with numeric identity metadata                   |
| Product AppDB `/api/datastores/*`              | Blocked; not implemented                                         |
| Public Platform dataset API                    | Blocked; distinct from dataset aliases                           |
| SQL, Code Engine, Workflows, Users, bulk AppDB | Blocked; future scope                                            |

See the [endpoint and fidelity matrix](docs/supported-contracts.md) for exact methods, bodies, sources, and omissions. Unknown methods, versions, and query features are rejected rather than silently approximated.

## Dataset fixtures

Fixtures are source rows. With `datasetsMapping`, each `columnName` maps to its application `alias`; unmapped fields are omitted. An empty `fields` list preserves source column names. Register empty arrays for empty datasets; unknown aliases return a synthetic 404.

```ts
kit.datasets.set('sales', [{ amount: null }]);
kit.datasets.get('sales'); // isolated copy of exposed rows
kit.reset(); // original rows restored
```

Optional `datasetSchemas` accept Zod schemas (or a compatible `.parse()` validator) for source rows. Validation runs for initial fixtures, seeds, and overrides. See [dataset testing](docs/dataset-testing.md).

## Stateful AppDB

```ts
const domo = kit.createDomoClient();
const path = '/domo/datastores/v2/collections/TodoList/documents';
const todo = await domo.post<{ id: string }>(path, {
  content: { title: 'Ship tests', done: false },
});
await domo.put(`${path}/update`, {
  query: { id: todo.id },
  operation: { $set: { 'content.done': true } },
});
await domo.delete(`${path}/${todo.id}`);
```

Document content and system metadata remain separate. IDs and timestamps are deterministic by default, with optional `idFactory` and `clock`. Replace overwrites content; partial update supports `$set`, `$unset`, and `$inc` on `content.*` paths. Unsupported operators fail. Query supports equality, `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$and`, `$or`, and `$exists`. See [AppDB testing](docs/appdb-testing.md).

## Domo.js and Toolkit

`kit.createDomoClient()` supplies parsed JSON methods `get/post/put/delete`. Native `fetch` returns a standard `Response`; the shim returns parsed values and throws `TestKitError` for non-2xx responses. It does not implement all of Domo.js. `kit.fetch(path, init)` resolves relative URLs against `baseUrl` for Node tests. Native Node fetch requires absolute URLs.

Use `kit.installDomoGlobal()` only if your application needs `globalThis.domo`. It refuses to replace an existing global unless `{ overwrite: true }` is passed, returns a restore function, and restores the prior descriptor on stop.

The actual **@domoinc/toolkit 2.3.0** XHR transport is tested in jsdom. Its `TransportClient.get` and `DocumentsClient.create/get/update/partialUpdate` work with the supported subset when v1 is explicitly enabled. Toolkit returns its own `{ status: 'OK', statusCode, data }` wrapper. Its `DocumentsClient.delete`, including single-ID deletion, uses a bulk endpoint and is currently unsupported. See [compatibility research](docs/research.md).

## React and Vitest

Use the jsdom Vitest environment, load your component with Testing Library, and register the same helper. React is only an example development dependency. The core does not import React or change your Vitest configuration. Runnable examples in the source repository cover native fetch, a Todo service, field mappings, and React success/error rendering. Run them with the package test suite:

```sh
npm test
npm run test:coverage
```

## Failure simulations

```ts
kit.setScenario('http:error', { alias: 'sales', status: 503, once: true });
kit.setScenario('appdb:permission-denied', { collection: 'TodoList' });
kit.setScenario('network:slow', { delayMs: 250 });
kit.clearScenario();
```

Network rejection, invalid JSON, empty datasets, response overrides, and operation-specific AppDB errors are supported. Delay timers honor abort signals and are canceled by reset/stop. `dataset:timeout` adds a bounded delay; use a caller-owned `AbortController` or client timeout to produce timeout behavior. It does not invent transport timeout semantics. [API reference](docs/api-reference.md) lists every scenario.

## CLI

After installation, the executable is `domo-testkit`. It provides `--help`, `init`, `check`, and `test`.

- `init --dry-run`: inspect the project and preview three new files.
- `init --yes` or `init --non-interactive`: create defaults without prompts. Existing files are always preserved; there is no force-overwrite flag.
- `check --config domo-testkit.json`: validate fixtures, API versions, offline defaults, and the presence of project-local Vitest.
- `check --doctor`: detect Domo Doctor and explain its separate diagnostic boundary. Automated Doctor execution is deferred.
- `test`: delegate to project-local Vitest in run mode. Selection, `--config`, `--coverage`, `--reporter json`, `--reporter junit`, and output flags are forwarded with no shell interpolation.

Init creates a separate `vitest.domo.config.ts`, a sample test, and `domo-testkit.json`. It detects npm/pnpm/yarn lockfiles and root `manifest.json`. It does not import your manifest automatically or install dependencies. It prints the exact command to run the new suite. These paths are validated in the installed-artifact smoke test.

## Configuration and lifecycle

Configuration is typed by `TestKitConfig`. Programmatic configuration supports manifests, schemas, clocks, IDs, budgets, configured secrets, and exact allowed origins. CLI configuration is JSON data; executable configuration files are not loaded. See [complete API reference](docs/api-reference.md).

For manual lifecycle integration, await `kit.start()` and `kit.stop()`. In `afterEach`, call `kit.assertNoUnhandledRequests()` in a `try` block and `kit.reset()` in `finally`. This makes blocked requests fail a test even if application code catches the HTTP failure. `requests()` returns bounded, sanitized copies. `summary()` reports mock request counts and enabled contract versions; it does not count tests or pretend to validate live deployments.

## CI and reports

Vitest supplies terminal, JSON, JUnit and coverage reports. The included GitHub Actions matrix checks Node 22/24/26 on Windows/Linux/macOS. It typechecks, lints, checks formatting, runs tests with coverage, builds and verifies a clean tarball installation. No Domo credentials are required. See [contribution and release guidance](CONTRIBUTING.md).

```sh
npm run typecheck
npm run lint
npm run format:check
```

## Security and live testing

All intercepted HTTP traffic is blocked unless matched by a supported mock or an explicitly allowlisted unrelated origin. Recognized Domo surfaces cannot bypass interception through the allowlist. Offline enforcement applies while the kit is started, to transports MSW intercepts. Raw sockets, separate processes, and previously captured unpatched transports are outside this boundary; use OS/container egress restrictions if those must be isolated. There is no live mode or telemetry.

Credentials are never loaded. Request bodies are omitted from history by default. Captured headers use an allowlist; sensitive JSON keys/query parameters and configured secrets are redacted. Fixture responses intentionally contain fixture values, so use synthetic data. See [security policy](SECURITY.md).

Mocked permissions do not prove collection/document security is configured in Domo. Authentication, development proxying, and publishing remain the responsibility of Domo CLI, Ryuu proxy, and other existing tools.

## Limitations and troubleshooting

This simulator does not reproduce permissions, sync, backend concurrency, aggregation, all MongoDB semantics, SQL, or browser service-worker setup. v1 is grounded in the current official YAML's legacy entries, marked excluded in Domo's rendered docs. Live validation and broader version/transport ranges remain unverified. See [limitations](docs/limitations.md).

If relative native fetch fails in Node, use `kit.fetch` or the parsed shim. If the kit reports another active interceptor, move concurrent suites to separate workers or share one kit. If requests are blocked, check method, version, alias, collection and supported query options; do not allowlist a production Domo instance. Keep fake timers active until delayed requests have settled, then restore timers in your own cleanup.

## Contributing and roadmap

See [CONTRIBUTING.md](CONTRIBUTING.md) and [CHANGELOG.md](CHANGELOG.md). Planned milestones: 0.2 expanded AppDB contracts, 0.3 dataset query/scenario coverage, 0.4 broader integrations, and 1.0 after stable contracts and adopter feedback. These are scope goals, not release dates. Publication requires an explicit maintainer decision and a fresh package-name availability check.
