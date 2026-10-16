import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
} from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.env.npm_execpath;
assert(npm, 'Run with npm run verify:published or npm run verify:package');
const tarballArgument =
  process.argv[2] === '--tarball' ? process.argv[3] : undefined;
assert(
  process.argv.length === 2 || (process.argv.length === 4 && tarballArgument),
  'Usage: npm run verify:package -- --tarball <path>',
);
const candidate = tarballArgument ? resolve(root, tarballArgument) : undefined;
mkdirSync(resolve(root, '.smoke'), { recursive: true });
const project = mkdtempSync(
  resolve(root, '.smoke', candidate ? 'candidate-' : 'published-'),
);
const results = [];
function run(args) {
  return execFileSync(process.execPath, args, {
    cwd: project,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 240_000,
  });
}
function save(name, content) {
  writeFileSync(resolve(project, name), content);
}
function step(name, fn) {
  const started = Date.now();
  try {
    const details = fn();
    results.push({
      name,
      passed: true,
      durationMs: Date.now() - started,
      details,
    });
    console.log(`PASS ${name}`);
    return true;
  } catch (error) {
    results.push({
      name,
      passed: false,
      durationMs: Date.now() - started,
      error: String(error.message),
      stdout: String(error.stdout ?? ''),
      stderr: String(error.stderr ?? ''),
    });
    console.log(`FAIL ${name}: ${error.message}`);
    return false;
  } finally {
    save(
      'results.json',
      JSON.stringify(
        {
          source: candidate ?? 'npm-registry',
          project,
          node: process.version,
          platform: process.platform,
          results,
        },
        null,
        2,
      ),
    );
  }
}
save(
  'package.json',
  JSON.stringify({
    name: 'published-domo-testkit-consumer',
    version: '1.0.0',
    type: 'module',
    private: true,
  }),
);
save(
  'tsconfig.json',
  JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      jsx: 'react-jsx',
      strict: true,
      types: ['node'],
    },
  }),
);
let metadata;
let installSpec;
if (
  !step(
    candidate
      ? 'Inspect candidate tarball and verify integrity'
      : 'Resolve the actual npm release and verify tarball integrity',
    () => {
      if (!candidate)
        metadata = JSON.parse(
          run([
            npm,
            'view',
            'domo-testkit',
            'version',
            'dist',
            '--json',
            '--fetch-retries=0',
            '--fetch-timeout=30000',
          ]),
        );
      const [packed] = JSON.parse(
        run([
          npm,
          'pack',
          candidate ?? `domo-testkit@${metadata.version}`,
          '--json',
          '--ignore-scripts',
        ]),
      );
      assert.equal(packed.name, 'domo-testkit');
      if (candidate) {
        metadata = {
          version: packed.version,
          source: candidate,
          dist: {
            integrity:
              'sha512-' +
              createHash('sha512')
                .update(readFileSync(candidate))
                .digest('base64'),
          },
        };
      }
      save('registry-metadata.json', JSON.stringify(metadata, null, 2));
      installSpec = candidate
        ? resolve(project, packed.filename)
        : `domo-testkit@${metadata.version}`;
      const integrity =
        'sha512-' +
        createHash('sha512')
          .update(readFileSync(resolve(project, packed.filename)))
          .digest('base64');
      assert.equal(integrity, metadata.dist.integrity);
      save('registry-pack.json', JSON.stringify(packed, null, 2));
      return {
        version: metadata.version,
        integrity,
        files: packed.files.length,
      };
    },
  )
)
  process.exit(1);
if (
  !step('Install package with no testing or React dependencies', () => {
    return run([
      npm,
      'install',
      '--save-dev',
      installSpec,
      '--no-audit',
      '--no-fund',
      '--fetch-retries=0',
      '--fetch-timeout=30000',
    ]);
  })
)
  process.exit(1);
save(
  'minimal.mjs',
  `import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createDomoTestKit } from 'domo-testkit';
assert(import.meta.resolve('domo-testkit').includes('/node_modules/domo-testkit/'));
assert(existsSync('node_modules/msw/package.json'));
assert(!existsSync('node_modules/react/package.json'));
assert(!existsSync('node_modules/vitest/package.json'));
const kit = createDomoTestKit({ datasets: { sales: [{ amount: 1200 }] }, appdb: { Todos: [] } });
await kit.start();
try {
  assert.deepEqual(await (await fetch('https://domo.test/data/v1/sales')).json(), [{ amount: 1200 }]);
  const client = kit.createDomoClient(); const p = '/domo/datastores/v2/collections/Todos/documents';
  const doc = await client.post(p, { content: { title: 'Real consumer', done: false } });
  assert.equal(await client.put(p + '/update', { query: { id: doc.id }, operation: { $set: { 'content.done': true } } }), 1);
  assert.equal((await client.post(p + '/query', { 'content.done': true })).length, 1);
  await client.delete(p + '/' + doc.id); assert.deepEqual(kit.appdb.list('Todos'), []);
  kit.assertNoUnhandledRequests();
} finally { await kit.stop(); }
console.log(JSON.parse(readFileSync('node_modules/domo-testkit/package.json')).version);
`,
);
step(
  'Standalone ESM, native fetch and AppDB application CRUD without Vitest',
  () => run(['minimal.mjs']),
);
if (
  !step('Install consumer Vitest, React, Toolkit and TypeScript tools', () =>
    run([
      npm,
      'install',
      '--save-dev',
      'vitest@^5.0.4',
      'msw@^3.0.3',
      '@vitest/coverage-v8@^5.0.4',
      'react@19',
      'react-dom@19',
      'jsdom@27',
      '@testing-library/react@16',
      '@domoinc/toolkit@2.3.0',
      'typescript@^5.9.0',
      '@types/node@22',
      '@types/react@19',
      '--no-audit',
      '--no-fund',
      '--fetch-retries=0',
      '--fetch-timeout=30000',
    ]),
  )
)
  process.exit(1);
const cli = 'node_modules/domo-testkit/dist/cli.js';
step('Installed npm binary, direct CLI and linked launch', () => {
  assert.equal(run([cli, '--version']).trim(), metadata.version);
  assert.match(run([cli, '--help']), /init/);
  symlinkSync(
    resolve(project, 'node_modules/domo-testkit/dist'),
    resolve(project, 'linked-cli'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  assert.match(run(['linked-cli/cli.js', '--help']), /init/);
  assert.match(
    run([npm, 'exec', '--offline', '--', 'domo-testkit', '--help']),
    /init/,
  );
});
step('CLI init dry-run, noninteractive setup, no overwrite, and check', () => {
  assert.match(
    run([cli, 'init', '--dry-run', '--non-interactive']),
    /Would create/,
  );
  assert.match(run([cli, 'init', '--yes']), /Created/);
  const before = readFileSync(resolve(project, 'domo-testkit.json'), 'utf8');
  assert.throws(() => run([cli, 'init', '--yes']));
  assert.equal(
    readFileSync(resolve(project, 'domo-testkit.json'), 'utf8'),
    before,
  );
  assert.match(run([cli, 'check', '--doctor']), /PASS/);
});
step(
  'Generated quick-start test, JSON reporter and coverage forwarding',
  () => {
    const output = run([
      cli,
      'test',
      '--config',
      'vitest.domo.config.ts',
      '--reporter',
      'json',
      '--coverage',
      '--outputFile',
      'quickstart.json',
    ]);
    save('quickstart.log', output);
    assert.equal(
      JSON.parse(readFileSync(resolve(project, 'quickstart.json'), 'utf8'))
        .numPassedTests,
      1,
    );
  },
);
save(
  'api.ts',
  `import { createDomoTestKit, type Document, type TestKitConfig } from 'domo-testkit';
import { useDomoTestKit } from 'domo-testkit/vitest';
const config: TestKitConfig = { datasets: { sales: [{ amount: 100 }] } };
const doc: Document = { id: 'one', content: { done: false } };
createDomoTestKit(config).seed({ appdb: { Todos: [doc] } });
void useDomoTestKit;
`,
);
const tsc = [
  'node_modules/typescript/bin/tsc',
  '--noEmit',
  '--strict',
  '--module',
  'NodeNext',
  '--target',
  'ES2022',
];
step('Strict installed TypeScript declarations without skipLibCheck', () =>
  run([...tsc, 'api.ts']),
);
save(
  'typed-model.ts',
  `import type { Document } from 'domo-testkit';
interface Todo { title: string; completed: boolean }
const document: Document<Todo> = { id: 'one', content: { title: 'Task', completed: false } };
import { createDomoTestKit } from 'domo-testkit';
createDomoTestKit({ appdb: { Todos: [document] } });
void document;
`,
);
step('Ordinary named TypeScript interface as document content', () =>
  run([...tsc, 'typed-model.ts']),
);
save(
  'typed-dataset.ts',
  `import { createDomoTestKit } from 'domo-testkit';
interface Sale { amount: number }
const sales: Sale[] = [{ amount: 100 }];
createDomoTestKit({ datasets: { sales } });
`,
);
step('Ordinary named TypeScript interface as dataset rows', () =>
  run([...tsc, 'typed-dataset.ts']),
);
save(
  'typed-model-alias.ts',
  `import { createDomoTestKit, type Document } from 'domo-testkit';
type Todo = { title: string; completed: boolean };
type Sale = { amount: number };
const document: Document<Todo> = { id: 'one', content: { title: 'Task', completed: false } };
const sales: Sale[] = [{ amount: 100 }];
createDomoTestKit({ datasets: { sales }, appdb: { Todos: [document] } });
`,
);
step('Type alias workaround for typed documents and dataset rows', () =>
  run([...tsc, 'typed-model-alias.ts']),
);

mkdirSync(resolve(project, 'consumer/fixtures'), { recursive: true });
const sources = [
  ['tests/integration.test.ts', 'consumer/http.test.ts'],
  ['tests/interfaces.test.ts', 'consumer/interfaces.test.ts'],
  ['tests/contracts.test.ts', 'consumer/contracts.test.ts'],
  ['tests/toolkit.test.ts', 'consumer/toolkit.test.ts'],
  ['examples/react-vitest/dashboard.test.tsx', 'consumer/dashboard.test.tsx'],
  ['examples/appdb-crud/todo.test.ts', 'consumer/todo.test.ts'],
  ['examples/vanilla-typescript/sales.test.ts', 'consumer/sales.test.ts'],
  ['examples/dataset-dashboard/mapping.test.ts', 'consumer/mapping.test.ts'],
];
for (const [source, target] of sources) {
  const text = readFileSync(resolve(root, source), 'utf8')
    .replaceAll(/(['"])\.\.\/(?:\.\.\/)?src\/index\.js\1/g, "'domo-testkit'")
    .replaceAll(
      /(['"])\.\.\/(?:\.\.\/)?src\/vitest\.js\1/g,
      "'domo-testkit/vitest'",
    );
  assert(
    !text.includes('/src/'),
    `Consumer test still imports source: ${source}`,
  );
  save(target, text);
}
save(
  'consumer/fixtures/appdb-contracts.json',
  readFileSync(resolve(root, 'tests/fixtures/appdb-contracts.json')),
);
save(
  'vitest.consumer.config.ts',
  `import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['consumer/**/*.test.{ts,tsx}'] } });
`,
);
step('Published public-API contract, HTTP, Toolkit and React suites', () => {
  save(
    'consumer.log',
    run([
      cli,
      'test',
      '--config',
      'vitest.consumer.config.ts',
      '--reporter',
      'json',
      '--outputFile',
      'consumer.json',
    ]),
  );
  const report = JSON.parse(
    readFileSync(resolve(project, 'consumer.json'), 'utf8'),
  );
  assert.equal(report.numFailedTests, 0);
  assert(report.numPassedTests >= 90);
  return { passed: report.numPassedTests, failed: report.numFailedTests };
});
save(
  'consumer/blackbox.test.ts',
  `import { expect, test } from 'vitest';
import { z } from 'zod';
import { createDomoTestKit } from 'domo-testkit';
test('malicious fixture cannot pollute prototypes', () => {
  expect(() => createDomoTestKit({ datasets: { sales: JSON.parse('[{"__proto__":{"polluted":true}}]') } })).toThrow();
  expect(({}).polluted).toBeUndefined();
});
test('row validators reject invalid source data and leave baseline intact', () => {
  const kit = createDomoTestKit({ datasets: { sales: [{ amount: 1 }] }, datasetSchemas: { sales: z.object({ amount: z.number() }) } });
  expect(() => kit.datasets.set('sales', [{ amount: 'bad' }])).toThrow();
  expect(kit.datasets.get('sales')).toEqual([{ amount: 1 }]);
});
test('actual external HTTP server receives no request by default', async () => {
  const { createServer } = await import('node:http'); let hits = 0;
  const server = createServer((_req, res) => { hits++; res.end('unexpected real traffic'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const kit = createDomoTestKit(); await kit.start();
  try { const response = await fetch('http://127.0.0.1:' + server.address().port + '/outside');
    expect(response.status).toBe(501); expect(hits).toBe(0); expect(() => kit.assertNoUnhandledRequests()).toThrow();
  } finally { await kit.stop(); await new Promise(resolve => server.close(resolve)); }
});
test('seed reset, nested content and source-input isolation', async () => {
  const fixture = { id: 'one', content: { nested: { n: 1 } } };
  const kit = createDomoTestKit({ appdb: { Todos: [fixture] } }); fixture.content.nested.n = 99;
  await kit.start(); try {
    const client = kit.createDomoClient(); const p = '/domo/datastores/v2/collections/Todos/documents';
    await client.put(p + '/update', { query: {}, operation: { $inc: { 'content.nested.n': 1 } } });
    expect(kit.appdb.get('Todos', 'one').content.nested.n).toBe(2);
    kit.reset(); expect(kit.appdb.get('Todos', 'one').content.nested.n).toBe(1);
  } finally { await kit.stop(); }
});
`,
);
step('Independent consumer safety and state probes, JUnit reporting', () => {
  save(
    'vitest.blackbox.config.ts',
    "import { defineConfig } from 'vitest/config'; export default defineConfig({ test: { include: ['consumer/blackbox.test.ts'] } });\n",
  );
  save(
    'blackbox.log',
    run([
      cli,
      'test',
      '--config',
      'vitest.blackbox.config.ts',
      '--reporter',
      'junit',
      '--outputFile',
      'blackbox.xml',
    ]),
  );
  assert.match(
    readFileSync(resolve(project, 'blackbox.xml'), 'utf8'),
    /failures="0"/,
  );
});
save(
  'failure.test.ts',
  `import { test, expect } from 'vitest';
import { useDomoTestKit } from 'domo-testkit/vitest';
const kit = useDomoTestKit({ datasets: { sales: [{ amount: 100 }] } });
test('caught unhandled request must still fail the test', async () => { await kit.fetch('/unsupported'); });
test('test after failure has clean state', async () => { expect(kit.requests()).toEqual([]); expect(await kit.createDomoClient().get('/data/v1/sales')).toEqual([{ amount: 100 }]); });
`,
);
save(
  'vitest.failure.config.ts',
  "import { defineConfig } from 'vitest/config'; export default defineConfig({ test: { include: ['failure.test.ts'] } });\n",
);
step('Offline violation fails the suite and subsequent test recovers', () => {
  let status;
  try {
    run([
      cli,
      'test',
      '--config',
      'vitest.failure.config.ts',
      '--reporter',
      'json',
      '--outputFile',
      'failure.json',
    ]);
  } catch (error) {
    status = error.status;
    save('failure.log', String(error.stdout) + String(error.stderr));
  }
  assert.equal(status, 1);
  const report = JSON.parse(
    readFileSync(resolve(project, 'failure.json'), 'utf8'),
  );
  assert.equal(report.numFailedTests, 1);
  assert.equal(report.numPassedTests, 1);
});
step('Published README provides npm installation instructions', () => {
  const readme = readFileSync(
    resolve(project, 'node_modules/domo-testkit/README.md'),
    'utf8',
  );
  assert(
    !/package is not yet published/i.test(readme),
    'Published README still states the package is not yet published',
  );
  assert(
    /npm (?:install|i)\b[^\n]*domo-testkit/.test(readme),
    'No direct npm install command for domo-testkit',
  );
});
console.log(
  JSON.stringify(
    {
      version: metadata.version,
      project,
      passed: results.filter((r) => r.passed).length,
      failed: results.filter((r) => !r.passed).length,
    },
    null,
    2,
  ),
);
if (results.some((r) => !r.passed)) process.exitCode = 1;
