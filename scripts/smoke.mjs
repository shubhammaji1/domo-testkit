import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
} from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npmCli = process.env.npm_execpath;
assert(npmCli, 'Run this verification with npm run smoke');
const lock = JSON.parse(
  readFileSync(resolve(root, 'package-lock.json'), 'utf8'),
);
const consumerDependencies = [
  'msw',
  'vitest',
  '@vitest/coverage-v8',
  'react',
  'react-dom',
  'jsdom',
  '@testing-library/react',
  'typescript',
  '@types/node',
].map((name) => {
  const version = lock.packages[`node_modules/${name}`]?.version;
  assert(version, `Missing locked smoke dependency: ${name}`);
  return `${name}@${version}`;
});
const run = (args, cwd = root) =>
  execFileSync(process.execPath, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
run([npmCli, 'run', 'build']);
const [pack] = JSON.parse(run([npmCli, 'pack', '--json', '--ignore-scripts']));
for (const entry of pack.files) {
  assert(
    !/^(src|tests|\.research|node_modules|coverage|examples)\//.test(
      entry.path,
    ),
    `Unexpected packed file: ${entry.path}`,
  );
  assert(
    !/\.env|\.map$|Pasted text/i.test(entry.path),
    `Unsafe packed file: ${entry.path}`,
  );
}
assert(pack.files.some((f) => f.path === 'dist/index.d.ts'));
assert(pack.files.some((f) => f.path === 'dist/cli.js'));
mkdirSync(resolve(root, '.smoke'), { recursive: true });
const project = mkdtempSync(resolve(root, '.smoke', 'install-'));
writeFileSync(
  resolve(project, 'package.json'),
  JSON.stringify({
    name: 'domo-testkit-install-smoke',
    private: true,
    type: 'module',
  }),
);
run(
  [
    npmCli,
    'install',
    '--prefer-offline',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    resolve(root, pack.filename),
    ...consumerDependencies,
  ],
  project,
);
writeFileSync(
  resolve(project, 'smoke.mjs'),
  `import assert from 'node:assert/strict';
import { createDomoTestKit } from 'domo-testkit';
const kit = createDomoTestKit({ datasets: { sales: [{ amount: 100 }] }, appdb: { Todos: [] } });
await kit.start();
try {
  assert.deepEqual(await kit.createDomoClient().get('/data/v1/sales'), [{ amount: 100 }]);
  const p = '/domo/datastores/v2/collections/Todos/documents';
  const doc = await kit.createDomoClient().post(p, { content: { done: false } });
  assert.equal(await kit.createDomoClient().put(p + '/update', { query: { id: doc.id }, operation: { $set: { 'content.done': true } } }), 1);
  await kit.createDomoClient().delete(p + '/' + doc.id);
  assert.deepEqual(kit.appdb.list('Todos'), []);
  kit.assertNoUnhandledRequests();
} finally { await kit.stop(); }
console.log('Installed ESM runtime smoke passed');
`,
);
console.log(run(['smoke.mjs'], project).trim());
writeFileSync(
  resolve(project, 'api.ts'),
  `import { createDomoTestKit, type Document, type TestKitConfig } from 'domo-testkit';
import { useDomoTestKit } from 'domo-testkit/vitest';
const config: TestKitConfig = { datasets: { sales: [{ amount: 1 }] } };
const kit = createDomoTestKit(config);
const doc: Document = { id: 'one', content: { title: 'typed' } };
kit.seed({ appdb: { Todos: [doc] } });
void useDomoTestKit;
`,
);
run(
  [
    'node_modules/typescript/bin/tsc',
    '--noEmit',
    '--strict',
    '--skipLibCheck',
    '--module',
    'NodeNext',
    '--target',
    'ES2022',
    'api.ts',
  ],
  project,
);
const cli = 'node_modules/domo-testkit/dist/cli.js';
assert.match(run([cli, '--help'], project), /init/);
// POSIX npm bins are symlinks. A directory junction exercises the same
// realpath-vs-argv distinction on Windows without file-symlink privileges.
symlinkSync(
  resolve(project, 'node_modules/domo-testkit/dist'),
  resolve(project, 'linked-cli'),
  process.platform === 'win32' ? 'junction' : 'dir',
);
assert.match(run(['linked-cli/cli.js', '--help'], project), /init/);
assert.match(
  run([npmCli, 'exec', '--offline', '--', 'domo-testkit', '--help'], project),
  /init/,
);
assert.match(
  run([cli, 'init', '--dry-run', '--non-interactive'], project),
  /Would create/,
);
assert.match(run([cli, 'init', '--yes'], project), /Created/);
assert.match(run([cli, 'check', '--doctor'], project), /PASS/);
const initConfig = readFileSync(resolve(project, 'domo-testkit.json'), 'utf8');
assert.throws(() => run([cli, 'init', '--yes'], project));
assert.equal(
  readFileSync(resolve(project, 'domo-testkit.json'), 'utf8'),
  initConfig,
);
assert.match(
  run(
    [
      cli,
      'test',
      '--config',
      'vitest.domo.config.ts',
      '--reporter',
      'json',
      '--coverage',
      '--outputFile',
      'report.json',
    ],
    project,
  ),
  /JSON report written/,
);
assert.equal(
  JSON.parse(readFileSync(resolve(project, 'report.json'), 'utf8'))
    .numPassedTests,
  1,
);
writeFileSync(
  resolve(project, 'domo-testkit.example.test.ts'),
  `import { test, expect } from 'vitest';
import { useDomoTestKit } from 'domo-testkit/vitest';
const kit = useDomoTestKit({ datasets: { sales: [{ amount: 100 }] } });
test('caught offline violation still fails via lifecycle hook', async () => { await kit.fetch('/unsupported'); });
test('next test has clean fixtures and diagnostics after failure', async () => {
  expect(kit.requests()).toEqual([]);
  expect(await kit.createDomoClient().get('/data/v1/sales')).toEqual([{ amount: 100 }]);
});
`,
);
let failed;
try {
  run(
    [
      cli,
      'test',
      '--config',
      'vitest.domo.config.ts',
      '--reporter',
      'json',
      '--outputFile',
      'failure.json',
    ],
    project,
  );
} catch (error) {
  failed = error.status;
}
assert.equal(failed, 1, 'CLI must preserve failing Vitest exit status');
const failedReport = JSON.parse(
  readFileSync(resolve(project, 'failure.json'), 'utf8'),
);
assert.equal(failedReport.numFailedTests, 1);
assert.equal(failedReport.numPassedTests, 1);
writeFileSync(
  resolve(project, 'react.test.ts'),
  `// @vitest-environment jsdom
import { createElement, useEffect, useState } from 'react';
import { expect, test, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { useDomoTestKit } from 'domo-testkit/vitest';
const kit = useDomoTestKit({ datasets: { sales: [{ amount: 100 }] } });
const domo = kit.createDomoClient();
function App() {
  const [text, setText] = useState('Loading');
  useEffect(() => { domo.get('/data/v1/sales').then(rows => setText('Revenue: ' + rows[0].amount)); }, []);
  return createElement('p', null, text);
}
afterEach(cleanup);
test('installed package supports React application integration', async () => { render(createElement(App)); expect(await screen.findByText('Revenue: 100')).toBeTruthy(); });
`,
);
writeFileSync(
  resolve(project, 'vitest.react.config.ts'),
  "import { defineConfig } from 'vitest/config'; export default defineConfig({ test: { include: ['react.test.ts'] } });\n",
);
run(
  [
    cli,
    'test',
    '--config',
    'vitest.react.config.ts',
    '--reporter',
    'junit',
    '--outputFile',
    'react.xml',
  ],
  project,
);
assert.match(
  readFileSync(resolve(project, 'react.xml'), 'utf8'),
  /failures="0"/,
);
console.log(
  `Tarball, declarations, CLI init/check/test, JSON/JUnit/coverage reporting, React, and failed-test cleanup passed.\nArtifact: ${resolve(root, pack.filename)}\nClean install: ${project}`,
);
