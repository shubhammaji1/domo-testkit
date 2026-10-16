# Published npm package verification

Tested on 16 October 2026 using Windows, Node 22.22.0 and npm 10.9.4. The subject was **the public npm release `domo-testkit@0.1.0`**, installed from the registry into a new consumer project. No workspace build or source imports were used for execution.

**Verdict: the supported offline workflows work, but two user-facing issues should be corrected in a patch release.** This is evidence for the scoped simulator and consumer integration, not for live Domo backend fidelity or permission configuration.

## Artifact and environment

- Registry: https://registry.npmjs.org/domo-testkit/-/domo-testkit-0.1.0.tgz
- npm SHA-512 integrity matched the downloaded tarball: `sha512-WQ4hW3zmhqFYYWwEU3BB1h7N26taZ2ed3zwQgD8gSwYRQqDi7ZwJYoy6EmOKONoJrKwtpdhb2Y6MhVIy7PLefw==`.
- Initial installation included only `domo-testkit`; npm installed its required MSW peer. Neither React nor Vitest was installed for the standalone runtime test.
- Consumer tools resolved independently: MSW 3.0.3, Vitest/coverage-v8 5.0.5, TypeScript 5.9.3, React/React DOM 19.3.1, jsdom 27.4.0, Testing Library React 16.3.3, and Toolkit 2.3.0.
- The React consumer has a normal `react-jsx` TypeScript configuration. Public declarations were compiled strictly without `skipLibCheck`.
- Local evidence is in `.smoke/published-sdHdQl/`: registry metadata, tarball, consumer package/lockfile, JSON/JUnit reports, logs and type reproductions. These generated files are ignored by Git.

## Results

| Consumer flow                                                             | Result                                                      |
| ------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Registry install and artifact integrity                                   | Passed                                                      |
| Standalone ESM without Vitest or React                                    | Passed                                                      |
| Native fetch dataset loading                                              | Passed                                                      |
| AppDB create, read, replace, partial update, query, delete                | Passed for implemented v1/v2 subsets                        |
| Dataset aliases, manifest field mapping, pagination, overrides, reset     | Passed                                                      |
| Failure scenarios, abort handling, managed globals and cleanup            | Passed                                                      |
| Actual Toolkit XHR transport and supported document operations            | Passed                                                      |
| React success and error rendering                                         | Passed                                                      |
| Published API contract/HTTP/Toolkit/React suite                           | **99 tests passed**                                         |
| Independent pollution, schema, real-HTTP blocking and nested-state probes | **4 tests passed**                                          |
| Generated init quick-start test                                           | **1 test passed**                                           |
| Installed CLI direct launch, npm binary and linked-directory launch       | Passed                                                      |
| Init dry-run/noninteractive, refusal to overwrite, check/Doctor boundary  | Passed                                                      |
| JSON/JUnit reporting and coverage forwarding                              | Passed                                                      |
| Deliberately caught offline violation                                     | Correctly failed its consumer test and returned exit code 1 |
| Next test after the intentional failure                                   | Passed with clean fixtures and history                      |
| Standard strict public-declaration import                                 | Passed                                                      |
| Named interfaces as document content and dataset rows                     | **Failed: public type constraint issue**                    |
| Equivalent object type aliases                                            | Passed; verified workaround                                 |
| Published installation documentation                                      | **Failed: obsolete prepublication instructions**            |
| Actual consumer dependency-tree npm audit                                 | Zero advisories reported                                    |

There were 105 passing application/framework tests across the successful suites and cleanup check, plus one deliberately failing test whose failure was the expected safety result. Verification checkpoints also include installation, CLI and TypeScript commands; these are not counted as Vitest tests.

The HTTP-blocking probe started a real local HTTP server, issued a request while TestKit was active, and verified a synthetic 501, a recorded violation, and **zero requests reaching the server**. This covers the intercepted fetch transport; it does not establish OS-level egress isolation.

## Issue 1 — Common TypeScript interfaces fail the public API constraint

This ordinary application model does not compile:

```ts
import type { Document } from 'domo-testkit';

interface Todo {
  title: string;
  completed: boolean;
}

const document: Document<Todo> = {
  id: 'one',
  content: { title: 'Task', completed: false },
};
```

TypeScript reports `TS2344: Type 'Todo' does not satisfy the constraint 'Row'` because the interface lacks a string index signature. The same issue affects `interface Sale { amount: number }` supplied as `Sale[]` to `datasets.sales`, producing TS2322. The exported `Row` type's string index signature, and `Document<T extends Row>`, require more than a normal named domain interface provides.

**Impact:** JavaScript and inferred object fixtures work, but real TypeScript applications reusing existing interfaces encounter compile errors. This limits the first-class TypeScript claim.

**Verified temporary workaround:** use object type aliases for fixture models, such as `type Todo = { title: string; completed: boolean }` and `type Sale = { amount: number }`. Both a typed document and typed dataset array compile and can be passed to the kit with these aliases. The library should support ordinary interfaces directly rather than requiring this workaround.

## Issue 2 — Published README has obsolete installation instructions

The README inside the npm tarball says “The package is not yet published,” asks users to run `npm ci`, `npm run build`, and `npm run smoke`, and describes installing a future local tarball. It has no direct npm installation command for the published package. Source files, the development lockfile and smoke script are correctly excluded from the consumer tarball, so these development instructions are unsuitable as consumer installation steps.

**Impact:** installation succeeds technically, but first-time users following the npm README are directed into a source-build workflow and may believe the package is unavailable.

The tested consumer setup was equivalent to:

```sh
npm install --save-dev domo-testkit@0.1.0 msw@3 vitest@5
npx domo-testkit init --yes
npx domo-testkit check
npx domo-testkit test --config vitest.domo.config.ts
```

Actual automated CLI invocation uses `npm exec` or the installed Node entry with argument arrays, avoiding shell interpolation. React, Toolkit, jsdom and coverage tooling are additional optional tools for the particular flows tested.

## Reproduction and limits

Run `npm run verify:published` from this source repository to create another fresh consumer project and repeat the registry-only verification. It deliberately returns a nonzero exit code while the named-interface and README checks fail. The script pins the package to the registry's latest resolved version at the start of each run and records its metadata and integrity. It uses existing public-API reference cases plus independent consumer probes; it does not import private implementation modules or substitute local builds.

No production app, Domo credentials or live Domo instance was used. This run tested the published artifact on Windows/Node 22. Previous source CI covered Linux/macOS/Windows and Node 22/24/26, but that is separate evidence from this registry install. ESM, MSW 3 and Vitest 5 are the supported integration path; compatibility with older stacks or all third-party clients has not been established.

I recommend a **0.1.1 patch** addressing the TypeScript model constraints and consumer-facing documentation before promoting broad adoption. No runtime library fix, new release or publication was performed during this testing task.

## Follow-up — local 0.1.1 fixes verified

The subsequent fix request was completed on 16 October 2026. Both findings above are corrected in the local **0.1.1 candidate**: ordinary interfaces now work for typed documents, datasets, seed/override inputs and request bodies; the README now provides npm installation and consumer CLI commands. Generic content fields remain typed, and runtime JSON validation is preserved. The CLI reads its version from package metadata.

Validation of the final candidate:

- **181 tests passed** with Vitest/coverage-v8 5.0.5; statement coverage 98.64%, branch coverage 97.22%, function coverage 100%.
- Type checking, ESLint and formatting checks passed.
- The CI tarball smoke passed, including installed declarations without `skipLibCheck`, named-interface regressions, CLI version and linked launch, installation instructions, React, reports and cleanup.
- The complete candidate consumer verification passed **all 15 checkpoints**, including the formerly failing interface/documentation checks. Evidence is under `.smoke/candidate-sAGBsb/`.
- The consumer application suite passed 103 tests; four additional safety/state tests, the generated quick-start test and the post-failure cleanup test also passed. The deliberately failing offline-violation test returned the expected failure status.

The first smoke attempt encountered an npm resolver error with the old Vitest 5.0.4 consumer toolchain. Development Vitest and coverage were aligned to 5.0.5, after which the final smoke and candidate verification passed. One half-million-entry resource-limit stress test exceeded its default wall-clock timeout under CPU contention; it now has a scoped 15-second test budget. Its input size, assertions and runtime validation limits are unchanged.

The candidate tarball is `domo-testkit-0.1.1.tgz`. These fixes have **not been published or pushed** during this task; this section does not change the historical findings for the published 0.1.0 artifact above. Cross-platform confirmation of the patch requires a new CI run after pushing the changes.
