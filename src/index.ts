import { http, HttpResponse } from 'msw/http';
import { passthrough } from 'msw';
import { setupServer } from 'msw/node';
import { z } from 'zod';
import { validateConfig } from './config.js';
import { serializeDocument } from './contracts.js';
import { State, parseContent } from './state.js';
import {
  isRecord,
  jsonClone,
  redact,
  redactText,
  sanitizedHeaders,
  sanitizedUrl,
  TestKitError,
} from './security.js';
import type {
  ApiVersion,
  DomoClient,
  Fixtures,
  Json,
  RequestRecord,
  Row,
  Scenario,
  ScenarioName,
  TestKitConfig,
} from './types.js';

export type * from './types.js';
export { TestKitError } from './security.js';
export { validateConfig, normalizeManifest } from './config.js';
export { contracts } from './contracts.js';
export { validateQuery } from './query.js';

const ownerKey = Symbol.for('domo-testkit.active-interceptor');
const owners = globalThis as typeof globalThis & { [ownerKey]?: object };
const scenarioNames = [
  'http:error',
  'network:error',
  'network:slow',
  'dataset:timeout',
  'dataset:empty',
  'dataset:invalid-json',
  'response:override',
  'appdb:permission-denied',
  'appdb:collection-not-found',
  'appdb:document-not-found',
  'appdb:create-failure',
  'appdb:update-failure',
  'appdb:delete-failure',
  'appdb:query-failure',
] as const;
const scenarioSchema = z
  .object({
    alias: z.string().optional(),
    collection: z.string().optional(),
    method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).optional(),
    status: z.number().int().min(400).max(599).optional(),
    delayMs: z.number().int().min(0).max(60_000).optional(),
    body: z.json().optional(),
    once: z.boolean().optional(),
  })
  .strict();
function recognizedDomo(url: URL) {
  return (
    /(^|\.)domo\.com$/.test(url.hostname) ||
    /(^|\.)domoapps\./.test(url.hostname) ||
    /^\/(data|sql|domo|api)\//.test(url.pathname)
  );
}
function page(rows: unknown[], url: URL, allowed: string[], max = Infinity) {
  for (const key of url.searchParams.keys())
    if (!allowed.includes(key))
      throw new TestKitError(
        'Unsupported query parameter (see supported-contracts.md)',
        501,
      );
  const values = ['offset', 'limit'].map((key) => {
    const raw = url.searchParams.get(key);
    if (raw === null) return key === 'offset' ? 0 : rows.length;
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)))
      throw new TestKitError('Pagination requires nonnegative safe integers');
    return Number(raw);
  });
  return rows.slice(values[0], values[0]! + Math.min(values[1]!, max));
}

export function createDomoTestKit(input: TestKitConfig = {}) {
  const config = validateConfig(input);
  const state = new State(config);
  const scenarios = new Map<ScenarioName, Scenario>();
  const history: RequestRecord[] = [];
  const violations: string[] = [];
  const restorers = new Set<() => void>();
  const pending = new Map<ReturnType<typeof setTimeout>, () => void>();
  let started = false;
  let epoch = 0;
  function capture(record: RequestRecord) {
    if (history.length === config.maxHistory) history.shift();
    history.push(record);
  }
  function failure(message: string, status: number) {
    return HttpResponse.json(
      {
        status,
        statusReason: redactText(message, config.secrets),
        toe: 'DOMO-TESTKIT-SYNTHETIC',
      },
      { status },
    );
  }
  function block(record: RequestRecord) {
    const message = `Offline request blocked: ${record.method} ${record.path}. Add a supported mock; recognized Domo surfaces cannot be allowlisted.`;
    record.outcome = 'blocked';
    record.status = 501;
    if (violations.length < config.maxHistory) violations.push(message);
    return failure(message, 501);
  }
  function wait(ms: number, signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      const cancel = () => {
        clearTimeout(timer);
        pending.delete(timer);
        signal.removeEventListener('abort', abort);
        reject(new TestKitError('Mock request canceled', 499));
      };
      const abort = () => cancel();
      const timer = setTimeout(() => {
        pending.delete(timer);
        signal.removeEventListener('abort', abort);
        resolve();
      }, ms);
      pending.set(timer, cancel);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) cancel();
    });
  }
  function cancelPending() {
    for (const cancel of pending.values()) cancel();
  }
  async function readBody(request: Request): Promise<Json> {
    if (!request.body) throw new TestKitError('JSON request body required');
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > config.maxRequestBytes) {
          await reader.cancel();
          throw new TestKitError('Request body size limit exceeded', 413);
        }
        chunks.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
    try {
      return jsonClone(
        JSON.parse(Buffer.concat(chunks).toString('utf8')) as Json,
        config.maxRequestBytes,
      );
    } catch (error) {
      if (error instanceof TestKitError) throw error;
      throw new TestKitError('Malformed JSON request body');
    }
  }
  const server = setupServer(
    http.all('*', async ({ request }) => {
      const requestEpoch = epoch;
      const url = new URL(request.url);
      const sanitized = new URL(sanitizedUrl(request.url, config.secrets));
      const record: RequestRecord = {
        method: request.method,
        url: sanitized.toString(),
        path: sanitized.pathname,
        headers: sanitizedHeaders(request.headers, config.secrets),
        outcome: 'mock',
      };
      capture(record);
      try {
        const dataset = /^\/data\/v1\/([^/]+)$/.exec(url.pathname);
        const appdb =
          /^\/domo\/datastores\/(v1|v2)\/collections\/([^/]+)\/documents(?:\/([^/]+))?\/?$/.exec(
            url.pathname,
          );
        if (!dataset && !appdb) {
          if (
            !recognizedDomo(url) &&
            config.allowOrigins.includes(url.origin)
          ) {
            record.outcome = 'allowed';
            return passthrough();
          }
          return block(record);
        }
        const version = appdb?.[1] as ApiVersion | undefined;
        const alias = dataset ? decodeURIComponent(dataset[1]!) : undefined;
        const collection = appdb ? decodeURIComponent(appdb[2]!) : undefined;
        const suffix = appdb?.[3] ? decodeURIComponent(appdb[3]) : undefined;
        const method = request.method;
        if (dataset && method !== 'GET') return block(record);
        if (
          appdb &&
          (!config.appdbVersions.includes(version!) ||
            (suffix === 'query'
              ? method !== 'POST'
              : suffix === 'update'
                ? method !== 'PUT'
                : suffix === 'bulk'
                  ? true
                  : suffix
                    ? !['GET', 'PUT', 'DELETE'].includes(method)
                    : !['GET', 'POST'].includes(method)))
        )
          return block(record);
        for (const [name, scenario] of scenarios) {
          if (
            (name.startsWith('dataset:') && !dataset) ||
            (name.startsWith('appdb:') && !appdb) ||
            (scenario.alias && scenario.alias !== alias) ||
            (scenario.collection && scenario.collection !== collection) ||
            (scenario.method && scenario.method !== method)
          )
            continue;
          if (
            (name === 'appdb:create-failure' &&
              !(method === 'POST' && !suffix)) ||
            (name === 'appdb:update-failure' && method !== 'PUT') ||
            (name === 'appdb:delete-failure' && method !== 'DELETE') ||
            (name === 'appdb:query-failure' && suffix !== 'query')
          )
            continue;
          if (scenario.once) scenarios.delete(name);
          if (scenario.delayMs) await wait(scenario.delayMs, request.signal);
          if (requestEpoch !== epoch || request.signal.aborted)
            return failure('Request canceled by reset or abort', 499);
          if (name === 'network:error') {
            record.outcome = 'network-error';
            return HttpResponse.error();
          }
          if (name === 'network:slow' || name === 'dataset:timeout') continue;
          if (name === 'dataset:empty') {
            record.status = 200;
            return HttpResponse.json([]);
          }
          if (name === 'dataset:invalid-json') {
            record.status = 200;
            return new HttpResponse('{invalid-json', {
              headers: { 'content-type': 'application/json' },
            });
          }
          if (name === 'response:override') {
            record.status = scenario.status ?? 200;
            return HttpResponse.json(scenario.body ?? null, {
              status: record.status,
            });
          }
          record.status =
            scenario.status ??
            (name === 'appdb:permission-denied'
              ? 403
              : name.endsWith('not-found')
                ? 404
                : 500);
          return failure(`Test-generated ${name}`, record.status);
        }
        if (requestEpoch !== epoch || request.signal.aborted)
          return failure('Request canceled by reset or abort', 499);
        if (dataset) {
          let rows = state.getDataset(alias!);
          rows = page(rows, url, ['offset', 'limit', 'fields']) as Row[];
          const fields = url.searchParams.get('fields');
          if (fields !== null)
            rows = rows.map((row) =>
              Object.fromEntries(
                fields
                  .split(',')
                  .filter((f) => Object.hasOwn(row, f))
                  .map((f) => [f, row[f]!]),
              ),
            );
          record.status = 200;
          return HttpResponse.json(rows);
        }
        if (suffix === undefined && method === 'GET') {
          const docs = page(
            state.list(collection!),
            url,
            ['offset', 'limit'],
            10_000,
          );
          record.status = 200;
          return HttpResponse.json(
            docs.map((d) =>
              serializeDocument(d as import('./types.js').Document, version!),
            ),
          );
        }
        page([], url, []);
        let body: Json | undefined;
        if (method === 'POST' || method === 'PUT') {
          body = await readBody(request);
          if (config.captureBodies) record.body = redact(body, config.secrets);
          if (requestEpoch !== epoch || request.signal.aborted)
            return failure('Request canceled by reset or abort', 499);
        }
        record.status = 200;
        if (suffix === 'query')
          return HttpResponse.json(
            state
              .query(collection!, body as Row)
              .map((d) => serializeDocument(d, version!)),
          );
        if (suffix === 'update') {
          if (
            !isRecord(body) ||
            Object.keys(body).some((k) => k !== 'query' && k !== 'operation') ||
            !isRecord(body.query) ||
            !isRecord(body.operation)
          )
            throw new TestKitError(
              'Expected { query: {...}, operation: {...} }',
            );
          return HttpResponse.json(
            state.update(collection!, body.query as Row, body.operation as Row),
          );
        }
        if (!suffix)
          return HttpResponse.json(
            serializeDocument(
              state.create(collection!, parseContent(body)),
              version!,
            ),
          );
        if (method === 'GET')
          return HttpResponse.json(
            serializeDocument(state.get(collection!, suffix), version!),
          );
        if (method === 'PUT')
          return HttpResponse.json(
            serializeDocument(
              state.replace(collection!, suffix, parseContent(body)),
              version!,
            ),
          );
        state.delete(collection!, suffix);
        return new HttpResponse(null, { status: 200 });
      } catch (error) {
        record.status = error instanceof TestKitError ? error.status : 400;
        if (record.status === 501) return block(record);
        // Validation libraries can include fixture values in errors. Never expose them.
        return failure(
          error instanceof TestKitError
            ? error.message
            : 'Invalid request or fixture schema',
          record.status,
        );
      }
    }),
  );
  const kit = {
    async start() {
      if (started) return;
      if (owners[ownerKey])
        throw new TestKitError(
          'Another Domo TestKit is active in this worker. Use sequential suites or isolated workers.',
        );
      owners[ownerKey] = kit;
      try {
        server.listen({ onUnhandledFrame: 'error' });
        started = true;
      } catch (error) {
        delete owners[ownerKey];
        throw error;
      }
    },
    async stop() {
      cancelPending();
      epoch++;
      try {
        for (const restore of [...restorers].reverse()) restore();
      } finally {
        if (started) {
          server.close();
          if (owners[ownerKey] === kit) delete owners[ownerKey];
          started = false;
        }
      }
    },
    reset() {
      cancelPending();
      epoch++;
      state.reset();
      scenarios.clear();
      history.length = 0;
      violations.length = 0;
    },
    seed(fixtures: Fixtures, options?: { replaceInitial?: boolean }) {
      state.seed(fixtures, options);
    },
    datasets: {
      set: (alias: string, rows: object[]) => state.setDataset(alias, rows),
      get: (alias: string) => state.getDataset(alias),
    },
    appdb: {
      list: (name: string) => state.list(name),
      get: (name: string, id: string) => state.get(name, id),
      query: (name: string, query: object) => state.query(name, query),
    },
    requests: () => jsonClone(history),
    setScenario(name: ScenarioName, scenario: Scenario = {}) {
      z.enum(scenarioNames).parse(name);
      const validated = scenarioSchema.parse(jsonClone(scenario));
      scenarios.set(name, validated);
    },
    clearScenario(name?: ScenarioName) {
      if (name) scenarios.delete(name);
      else scenarios.clear();
    },
    assertNoUnhandledRequests() {
      if (violations.length) throw new TestKitError(violations.join('\n'));
    },
    summary() {
      return {
        mode: 'offline-mock' as const,
        requests: history.length,
        unhandled: violations.length,
        contracts: [...config.appdbVersions],
      };
    },
    async fetch(path: string, init?: RequestInit) {
      if (!started)
        throw new TestKitError(
          'Start the testkit before using its fetch adapter',
        );
      return globalThis.fetch(new URL(path, config.baseUrl), init);
    },
    createDomoClient(): DomoClient {
      async function call<T>(
        method: string,
        url: string,
        body?: Json | object,
      ): Promise<T> {
        const response = await kit.fetch(url, {
          method,
          ...(body === undefined
            ? {}
            : {
                body: JSON.stringify(jsonClone(body, config.maxRequestBytes)),
                headers: { 'content-type': 'application/json' },
              }),
        });
        if (!response.ok)
          throw new TestKitError(
            `Domo test adapter HTTP ${response.status}`,
            response.status,
          );
        const text = await response.text();
        return (text ? JSON.parse(text) : undefined) as T;
      }
      return {
        get: (url) => call('GET', url),
        post: (url, body) => call('POST', url, body),
        put: (url, body) => call('PUT', url, body),
        delete: (url) => call('DELETE', url),
      };
    },
    installDomoGlobal(options: { overwrite?: boolean } = {}) {
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'domo');
      if (descriptor && !options.overwrite)
        throw new TestKitError(
          'globalThis.domo already exists; pass overwrite: true explicitly',
        );
      const shim = kit.createDomoClient();
      Object.defineProperty(globalThis, 'domo', {
        value: shim,
        writable: true,
        configurable: true,
        enumerable: descriptor?.enumerable ?? true,
      });
      const restore = () => {
        if (!restorers.has(restore)) return;
        if (descriptor) Object.defineProperty(globalThis, 'domo', descriptor);
        else Reflect.deleteProperty(globalThis, 'domo');
        restorers.delete(restore);
      };
      restorers.add(restore);
      return restore;
    },
  };
  return kit;
}
export type DomoTestKit = ReturnType<typeof createDomoTestKit>;
