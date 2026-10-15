# Security policy

Report suspected vulnerabilities privately to the repository maintainer through the hosting platform's private security reporting once the repository is configured. Until a private channel is established, do not include secrets or exploit details in public issues. No reporting address has been invented for this unreleased project.

The initial supported line is 0.1.x. TestKit never loads Domo CLI session files, environment credentials or authentication tokens. It sends no telemetry and has no live Domo mutation mode.

Start interception before application requests. MSW handles supported Node fetch/HTTP/XHR surfaces; unknown HTTP requests are denied by default. Exact allowlisted unrelated origins explicitly permit real traffic. Recognized Domo host/path surfaces remain blocked unless handled by a mock. The Vitest helper checks recorded offline violations before reset. Manual users must do the same. TestKit is a testing library, not an OS network sandbox: raw sockets, subprocesses and transports bypassing MSW need independent egress controls.

Bodies are excluded from request history unless `captureBodies` is explicitly enabled. Headers other than accept/content-type are redacted. Sensitive query/JSON key patterns cover authorization, cookies, tokens, secrets, passwords, sessions, API keys and credentials. Additional configured secrets are removed from diagnostic text, including URL-encoded forms. Validation failures avoid dumping fixture values. Use synthetic data; mock response bodies and your application logs intentionally fall outside diagnostic redaction.

Fixture parsing bounds depth, visited nodes and encoded size, rejects prototype keys, accessors and non-JSON objects, and uses own-property lookups. Queries never use eval/Function or executable expressions. Content updates reject unsafe paths and immutable metadata. Failed validation leaves fixture state unchanged. Programmatic schema validators, clocks and ID functions are trusted caller-supplied code; CLI config is plain JSON only.

Security tests cover pollution, excessive JSON, unsupported operators, request budgets, redaction, request blocking and cleanup. They do not reproduce Domo collection/document permission enforcement. Verify actual authorization using Domo security controls in a separately designed integration environment.
