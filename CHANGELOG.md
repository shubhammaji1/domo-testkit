# Changelog

## 0.1.1 — Unreleased

- Accept ordinary named TypeScript interfaces as document content, dataset fixtures, seeds, overrides, query filters and parsed-client JSON bodies.
- Preserve JSON validation at fixture and transport boundaries; reject non-JSON request values before serialization.
- Replace prepublication README instructions with npm installation and consumer CLI setup; add typed interface examples.
- Read the CLI version from package metadata and verify interface compatibility in clean tarball installations.

## 0.1.0

- Fix CLI execution through npm's Unix symlinks by resolving the entry-point real path; add linked-directory launch verification to the installed-artifact smoke test.

- Add deterministic offline dataset fixtures with manifest field aliases and schema validation.
- Add stateful App Framework AppDB v2 CRUD, explicit v1 numeric metadata compatibility, query and partial-update subsets.
- Add MSW 3 interception, bounded request capture, fail-closed defaults, explicit unrelated-origin allowlists and synthetic fault scenarios.
- Add parsed Domo adapter, managed global installation, optional Vitest 5 lifecycle helper, and Toolkit 2.3 XHR compatibility tests.
- Add init/check/test CLI, runnable React and service examples, independent contract cases, security/isolation tests and tarball installation verification.
- Document unsupported APIs, simulated security/concurrency, network interception boundaries and release gates.

The 0.1.0 package is available on npm. No live Domo validation has occurred.
