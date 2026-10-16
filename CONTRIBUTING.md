# Contributing

Use a supported even-numbered Node LTS/current release and the committed npm lockfile. Run `npm ci`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run test:coverage`, `npm run build`, and `npm run smoke` before submitting a change. The allowlist test connects to a local loopback HTTP server; a sandbox must permit loopback for that test. No external network or Domo credentials are needed for the tests. Installing dependencies requires npm access or a populated cache.

Add a contract matrix entry and independent reference case for every newly supported endpoint, version, response or operator. Do not infer support from a similar endpoint. Preserve explicit version adapters and fail on unsupported features. Include failure, cleanup, isolation and malicious-input assertions when changing state or routing. Do not lower coverage thresholds to hide a regression.

Examples are real tests included in the suite. Their relative imports target source during package development; consumers use `domo-testkit` and `domo-testkit/vitest`. The clean-install smoke suite exercises the installed exports and generated consumer test. Keep documentation commands synchronized with tested scripts.

The tarball smoke check installs a new consumer project. It prefers npm's cache but may access the registry to obtain missing dependency metadata or archives. `npm ci` alone does not guarantee the metadata needed by a separate `npm install` is cached. Smoke dependencies use the exact direct versions recorded in the root lockfile; it does not bypass peer dependency validation. The installed application's mock tests remain offline.

## Branch protection

After pushing to a repository, configure branch protection to require the `quality` job and every `verify` matrix job, require review and disallow bypasses/force pushes. GitHub account/repository settings cannot be configured by local files. CI uploads coverage and tarballs for review; it has no publish token.

## Versioning and release

Use `npm run verify:published` to test the current npm release in a fresh consumer project. To verify an unpublished candidate with the same checks, build and pack it, then run `npm run verify:package -- --tarball <absolute-tarball-path>`. Both modes record their artifact source and results under `.smoke`; the candidate mode does not publish anything. The regular `npm run smoke` also checks named-interface declarations and consumer installation instructions.

Use npm's established semantic-version workflow (`npm version`) and maintain CHANGELOG.md. During 0.x, document every breaking change. A maintainer must explicitly authorize publication. Before release:

1. Recheck the exact npm name `domo-testkit`; a conflict blocks publication.
2. Review all prepared CI results on Linux/macOS/Windows and supported Node majors. Local Windows verification alone is insufficient.
3. Run the full checks and audit, then inspect `npm pack --dry-run` and the clean-install smoke result.
4. Review license, package metadata, exported declarations, compatibility boundaries and changelog. Add real repository/homepage metadata when a hosting repository is chosen.
5. Confirm package contents contain only intended public files and no credentials, private paths, source maps or research artifacts.
6. Obtain explicit publication authorization. Publish manually using appropriate npm authentication/provenance. No workflow publishes automatically.

Live integration testing is deferred. A future implementation requires explicit instance allowlists, read-only defaults and separate authorization for mutations. Do not introduce real authentication into ordinary CI.
