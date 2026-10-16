#!/usr/bin/env node
import { Command } from 'commander';
import pc from 'picocolors';
import { readFile, writeFile, access, lstat } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createDomoTestKit, validateConfig } from './index.js';
import { jsonClone, TestKitError } from './security.js';
import type { TestKitConfig } from './types.js';

const packageVersion = (
  createRequire(import.meta.url)('../package.json') as { version: string }
).version;

async function exists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
function localRequire(cwd: string) {
  return createRequire(resolve(cwd, 'package.json'));
}
function vitestPath(cwd: string) {
  return resolve(
    localRequire(cwd).resolve('vitest/package.json'),
    '..',
    'vitest.mjs',
  );
}
async function readJson(path: string) {
  const stat = await lstat(path);
  if (stat.size > 8_000_000 || stat.isSymbolicLink())
    throw new TestKitError(
      'Configuration must be a regular JSON file under 8 MB',
    );
  return jsonClone(JSON.parse(await readFile(path, 'utf8')) as TestKitConfig);
}
async function configAt(cwd: string, file: string) {
  const path = resolve(cwd, file);
  if (!(await exists(path))) {
    if (file !== 'domo-testkit.json')
      throw new TestKitError('Configuration file not found');
    return {};
  }
  return readJson(path);
}
export async function runCli(argv = process.argv, cwd = process.cwd()) {
  const program = new Command()
    .name('domo-testkit')
    .description('Test Domo Apps Before Domo Tests You.')
    .version(packageVersion);
  program
    .command('init')
    .description(
      'Add a separate example suite without overwriting project files',
    )
    .option('--dry-run')
    .option('--yes', 'Use defaults without prompts (never overwrite)')
    .option('--non-interactive', 'Use defaults without prompts')
    .action(async (options) => {
      const req = localRequire(cwd);
      let installed = false;
      try {
        req.resolve('vitest/package.json');
        installed = true;
      } catch {
        /* Report installation instructions below. */
      }
      const manager = (await exists(resolve(cwd, 'pnpm-lock.yaml')))
        ? 'pnpm'
        : (await exists(resolve(cwd, 'yarn.lock')))
          ? 'yarn'
          : 'npm';
      console.log(
        `Project: ${(await exists(resolve(cwd, 'package.json'))) ? 'package.json found' : 'no package.json'}; manager: ${manager}; Vitest: ${installed ? 'installed' : 'missing'}; manifest: ${(await exists(resolve(cwd, 'manifest.json'))) ? 'found' : 'absent'}`,
      );
      const files = {
        'domo-testkit.json':
          JSON.stringify(
            { datasets: { sales: [{ amount: 100 }] }, appdb: { TodoList: [] } },
            null,
            2,
          ) + '\n',
        'domo-testkit.example.test.ts': `import { expect, test } from 'vitest';\nimport { useDomoTestKit } from 'domo-testkit/vitest';\nconst kit = useDomoTestKit({ datasets: { sales: [{ amount: 100 }] } });\ntest('loads sales offline', async () => {\n  expect(await kit.createDomoClient().get('/data/v1/sales')).toEqual([{ amount: 100 }]);\n});\n`,
        'vitest.domo.config.ts': `import { defineConfig } from 'vitest/config';\nexport default defineConfig({ test: { include: ['domo-testkit.example.test.ts'] } });\n`,
      };
      // Preflight every target before creating any file. Exclusive writes also guard races.
      for (const file of Object.keys(files))
        if (await exists(resolve(cwd, file)))
          throw new TestKitError(`Refusing to overwrite ${file}`);
      for (const [file, content] of Object.entries(files)) {
        if (!options.dryRun)
          await writeFile(resolve(cwd, file), content, { flag: 'wx' });
        console.log(`${options.dryRun ? 'Would create' : 'Created'} ${file}`);
      }
      console.log(
        'Install dev dependencies: domo-testkit msw vitest. Run: domo-testkit test --config vitest.domo.config.ts',
      );
    });
  program
    .command('check')
    .description('Validate JSON fixtures and the local test environment')
    .option('--config <path>', 'JSON configuration path', 'domo-testkit.json')
    .option('--doctor', 'Explain the optional Doctor integration boundary')
    .action(async (options) => {
      const config = await configAt(cwd, options.config);
      const validated = validateConfig(config);
      const kit = createDomoTestKit(config);
      vitestPath(cwd);
      console.log(
        pc.green(
          `PASS: Vitest installed; fixtures valid; fetch and Domo adapters; AppDB ${validated.appdbVersions.join(', ')}; offline interception blocks unmatched HTTP requests.`,
        ),
      );
      console.log(JSON.stringify(kit.summary()));
      if (options.doctor) {
        let doctor = 'not installed';
        try {
          localRequire(cwd).resolve('domo-doctor');
          doctor = 'installed';
        } catch {
          /* optional */
        }
        console.log(
          `Domo Doctor ${doctor}. Automated invocation is deferred: its report API is not verified. Run its CLI separately; findings remain independent.`,
        );
      }
    });
  program
    .command('test')
    .description('Run the project-local Vitest CLI; forward all arguments')
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .action(async (_options, command: Command) => {
      const bin = vitestPath(cwd);
      await new Promise<void>((resolveRun, reject) => {
        const child = spawn(process.execPath, [bin, 'run', ...command.args], {
          cwd,
          stdio: 'inherit',
          shell: false,
        });
        const interrupt = () => child.kill('SIGINT');
        process.on('SIGINT', interrupt);
        child.once('error', (error) => {
          process.removeListener('SIGINT', interrupt);
          reject(error);
        });
        child.once('exit', (code, signal) => {
          process.removeListener('SIGINT', interrupt);
          process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1);
          resolveRun();
        });
      });
    });
  await program.parseAsync(argv);
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href
) {
  runCli().catch((error) => {
    console.error(
      pc.red(
        error instanceof TestKitError
          ? error.message
          : 'Command failed. Check installed dependencies and JSON configuration.',
      ),
    );
    process.exitCode = 1;
  });
}
