# Getting started

Install the packed artifact into an ESM Node 22.12+ project with MSW 3 and Vitest 5. A Domo account, React, a proxy and a global Domo CLI are unnecessary. The README gives the verified build and smoke commands.

1. Write fixture rows using synthetic values. Dataset fixtures use source column names when manifest mappings are supplied.
2. Register `useDomoTestKit` from `domo-testkit/vitest` in a setup file or sequential test suite. This checks offline violations before resetting each test.
3. Call application code normally. Native Node fetch uses absolute URLs. The Domo shim and kit fetch resolve relative URLs against the configured origin.
4. Override fixtures or activate a scenario inside an individual test. The helper restores the baseline afterward.
5. Assert rendered output, returned values, final AppDB state, and relevant request history.

For manual hooks, use:

```ts
import { beforeAll, afterEach, afterAll } from 'vitest';
import { createDomoTestKit } from 'domo-testkit';
const kit = createDomoTestKit({ datasets: { sales: [] } });
beforeAll(() => kit.start());
afterEach(() => {
  try {
    kit.assertNoUnhandledRequests();
  } finally {
    kit.reset();
  }
});
afterAll(() => kit.stop());
```

Keep one kit active per worker. Separate Vitest workers isolate mutable state; use sequential tests within a suite sharing one kit. The helper does not reset your own spies, fake timers, DOM state or other libraries' resources. Clean them up with their normal APIs.

The CLI creates a separate example configuration so it can coexist with an application's existing Vitest setup. After reviewing the sample, move its lifecycle registration into your own setup if desired. The CLI JSON configuration is used by `check`; running tests uses the fixtures configured by the tests themselves.
