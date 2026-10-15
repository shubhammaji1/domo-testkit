import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createDomoTestKit, TestKitError } from '../src/index.js';
import type {
  DomoTestKit,
  Document,
  Json,
  ScenarioName,
} from '../src/index.js';

let kit: DomoTestKit;
const root = '/domo/datastores/v2/collections/TodoList/documents';
beforeEach(async () => {
  kit = createDomoTestKit({
    datasets: { sales: [{ amount: 10 }, { amount: null }, { amount: 30 }] },
    appdb: {
      TodoList: [
        {
          id: 'todo-1',
          content: { title: 'Initial', count: 2, nested: { active: true } },
        },
      ],
      Other: [],
    },
    appdbVersions: ['v1', 'v2'],
    captureBodies: true,
    secrets: ['private-value'],
  });
  await kit.start();
});
afterEach(async () => {
  await kit.stop();
  vi.useRealTimers();
});
const client = () => kit.createDomoClient();
async function send(path: string, method: string, body?: Json) {
  return kit.fetch(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe('dataset HTTP contracts', () => {
  test('native fetch interception, projection and pagination', async () => {
    const response = await fetch(
      'https://domo.test/data/v1/sales?offset=1&limit=1&fields=amount',
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ amount: null }]);
    expect(kit.requests()[0]).toMatchObject({
      method: 'GET',
      path: '/data/v1/sales',
      status: 200,
      outcome: 'mock',
    });
  });
  test('empty, missing, overrides, deep isolation and reset', async () => {
    const rows = [{ amount: 99 }];
    kit.datasets.set('sales', rows);
    rows[0]!.amount = 1;
    expect(await client().get('data/v1/sales')).toEqual([{ amount: 99 }]);
    kit.datasets.set('sales', []);
    expect(await client().get('/data/v1/sales')).toEqual([]);
    expect((await kit.fetch('/data/v1/missing')).status).toBe(404);
    kit.reset();
    expect(kit.requests()).toEqual([]);
    expect(kit.datasets.get('sales')).toHaveLength(3);
  });
  test.each([
    'groupby=x',
    'filter=x',
    'limit=-1',
    'offset=nope',
    'limit=9007199254740992',
  ])('rejects unsupported/invalid query %s', async (query) => {
    expect((await kit.fetch(`/data/v1/sales?${query}`)).status).toBe(
      query.startsWith('group') || query.startsWith('filter') ? 501 : 400,
    );
  });
  test('preserves duplicate records, nulls and mixed values', async () => {
    const rows = [{ x: null }, { x: 1 }, { x: '1' }, { x: 1 }];
    kit.datasets.set('sales', rows);
    expect(await client().get('/data/v1/sales')).toEqual(rows);
  });
  test('large fixture request', async () => {
    const rows = Array.from({ length: 10_000 }, (_, i) => ({ i }));
    kit.datasets.set('large', rows);
    expect(await client().get('/data/v1/large?offset=9999')).toEqual([
      { i: 9999 },
    ]);
  });
});

describe.each(['v1', 'v2'] as const)(
  'AppDB %s independent HTTP expectations',
  (version) => {
    const path = `/domo/datastores/${version}/collections/Other/documents`;
    test('create/list/get/replace/delete, numeric versus string metadata', async () => {
      const created = await client().post<Document>(path, {
        content: { title: 'hello' },
      });
      expect(created).toEqual({
        id: '00000000-0000-4000-8000-000000000001',
        content: { title: 'hello' },
        owner: version === 'v1' ? 1 : '1',
        createdBy: version === 'v1' ? 1 : '1',
        updatedBy: version === 'v1' ? 1 : '1',
        createdOn: '2026-01-01T00:00:00.000Z',
        updatedOn: '2026-01-01T00:00:00.000Z',
        syncRequired: false,
      });
      expect(await client().get(path)).toEqual([created]);
      expect(await client().get(`${path}/${created.id}`)).toEqual(created);
      expect(
        await client().put(`${path}/${created.id}`, {
          content: { replacement: true },
        }),
      ).toMatchObject({ id: created.id, content: { replacement: true } });
      expect(kit.appdb.list('TodoList')).toHaveLength(1);
      const deletion = await send(`${path}/${created.id}`, 'DELETE');
      expect(deletion.status).toBe(200);
      expect(await deletion.text()).toBe('');
      expect(await client().get(path)).toEqual([]);
      expect((await send(`${path}/${created.id}`, 'DELETE')).status).toBe(404);
    });
    test.each(['GET', 'PUT', 'DELETE'])(
      'missing document %s',
      async (method) => {
        expect(
          (
            await send(
              `${path}/absent`,
              method,
              method === 'PUT' ? { content: {} } : undefined,
            )
          ).status,
        ).toBe(404);
      },
    );
    test('query body is the filter directly, updates use operation and return count', async () => {
      const p = root.replace('v2', version);
      expect(
        await client().post(`${p}/query`, { 'content.count': { $gte: 2 } }),
      ).toEqual([expect.objectContaining({ id: 'todo-1' })]);
      expect(
        await client().put(`${p}/update`, {
          query: { id: 'todo-1' },
          operation: {
            $inc: { 'content.count': 3 },
            $set: { 'content.nested.name': 'changed' },
            $unset: { 'content.title': '' },
          },
        }),
      ).toBe(1);
      expect(kit.appdb.get('TodoList', 'todo-1').content).toEqual({
        count: 5,
        nested: { active: true, name: 'changed' },
      });
      expect(
        await client().put(`${p}/update`, {
          query: { id: 'missing' },
          operation: { $set: { 'content.x': 1 } },
        }),
      ).toBe(0);
    });
  },
);

describe('malformed contracts and transaction boundaries', () => {
  test.each<Json>([
    {},
    [],
    null,
    { content: [] },
    { content: {}, id: 'changed' },
  ])('rejects invalid create %j', async (body) => {
    expect((await send(root, 'POST', body)).status).toBe(400);
    expect(kit.appdb.list('TodoList')).toHaveLength(1);
  });
  test('invalid JSON and unknown collection', async () => {
    expect((await kit.fetch(root, { method: 'POST', body: '{' })).status).toBe(
      400,
    );
    expect((await kit.fetch(root.replace('TodoList', 'absent'))).status).toBe(
      404,
    );
  });
  test('missing body and malformed partial update', async () => {
    expect((await send(root, 'POST')).status).toBe(400);
    expect((await send(`${root}/update`, 'PUT', { query: {} })).status).toBe(
      400,
    );
  });
  test('partial update validates whole batch before committing', async () => {
    kit.seed({
      appdb: {
        TodoList: [
          { id: 'a', content: { n: 1 } },
          { id: 'b', content: { n: 'bad' } },
        ],
      },
    });
    expect(
      (
        await send(`${root}/update`, 'PUT', {
          query: {},
          operation: { $inc: { 'content.n': 1 } },
        })
      ).status,
    ).toBe(400);
    expect(kit.appdb.get('TodoList', 'a').content.n).toBe(1);
  });
  test('predictable IDs after reset, injectable clocks, concurrent create', async () => {
    const docs = await Promise.all(
      [1, 2].map((n) => client().post<Document>(root, { content: { n } })),
    );
    expect(new Set(docs.map((d) => d.id)).size).toBe(2);
    kit.reset();
    expect((await client().post<Document>(root, { content: {} })).id).toBe(
      docs[0]!.id,
    );
  });
  test('seed replaces current fixtures; reset baseline is explicit', () => {
    kit.seed({ datasets: { x: [] } });
    expect(kit.datasets.get('x')).toEqual([]);
    expect(() => kit.appdb.list('TodoList')).toThrow();
    kit.reset();
    expect(kit.appdb.list('TodoList')).toHaveLength(1);
    kit.seed({ datasets: { x: [{ n: 1 }] } }, { replaceInitial: true });
    kit.datasets.set('x', []);
    kit.reset();
    expect(kit.datasets.get('x')).toEqual([{ n: 1 }]);
    expect(() =>
      kit.seed({
        appdb: {
          Bad: [
            { id: 'x', content: {} },
            { id: 'x', content: {} },
          ],
        },
      }),
    ).toThrow('Duplicate');
    expect(kit.datasets.get('x')).toHaveLength(1);
  });
});

describe('fault scenarios', () => {
  test.each([400, 401, 403, 404, 429, 500, 503])(
    'HTTP %i with synthetic error marker',
    async (status) => {
      kit.setScenario('http:error', { alias: 'sales', status });
      const response = await kit.fetch('/data/v1/sales');
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({
        status,
        toe: 'DOMO-TESTKIT-SYNTHETIC',
      });
    },
  );
  test('scoping, once and clear', async () => {
    kit.setScenario('dataset:empty', { alias: 'other' });
    expect(await client().get('/data/v1/sales')).toHaveLength(3);
    kit.setScenario('dataset:empty', { alias: 'sales', once: true });
    expect(await client().get('/data/v1/sales')).toEqual([]);
    expect(await client().get('/data/v1/sales')).toHaveLength(3);
    kit.clearScenario();
  });
  test('network failure rejects fetch', async () => {
    kit.setScenario('network:error');
    await expect(kit.fetch('/data/v1/sales')).rejects.toThrow();
    expect(kit.requests()[0]?.outcome).toBe('network-error');
  });
  test('malformed JSON and arbitrary data override', async () => {
    kit.setScenario('dataset:invalid-json');
    await expect(client().get('/data/v1/sales')).rejects.toThrow();
    kit.clearScenario('dataset:invalid-json');
    kit.setScenario('response:override', { body: { unexpected: null } });
    expect(await client().get('/data/v1/sales')).toEqual({ unexpected: null });
    kit.reset();
    expect(await client().get('/data/v1/sales')).toHaveLength(3);
  });
  test.each([
    ['appdb:permission-denied', 'GET', '', 403],
    ['appdb:collection-not-found', 'GET', '', 404],
    ['appdb:document-not-found', 'GET', '/todo-1', 404],
    ['appdb:create-failure', 'POST', '', 500],
    ['appdb:update-failure', 'PUT', '/todo-1', 500],
    ['appdb:delete-failure', 'DELETE', '/todo-1', 500],
    ['appdb:query-failure', 'POST', '/query', 500],
  ] as const)(
    '%s only affects selected collection',
    async (scenario, method, suffix, status) => {
      kit.setScenario(scenario, { collection: 'TodoList' });
      expect(
        (
          await send(
            root + suffix,
            method,
            method === 'GET' ? undefined : { content: {} },
          )
        ).status,
      ).toBe(status);
      expect((await kit.fetch(root.replace('TodoList', 'Other'))).status).toBe(
        200,
      );
    },
  );
  test('operation-specific faults do not affect reads', async () => {
    for (const name of [
      'appdb:create-failure',
      'appdb:update-failure',
      'appdb:delete-failure',
      'appdb:query-failure',
    ] as const)
      kit.setScenario(name);
    expect((await kit.fetch(root)).status).toBe(200);
  });
  test('bounded delay and abort without waiting seconds', async () => {
    vi.useFakeTimers();
    kit.setScenario('network:slow', { delayMs: 3000 });
    const promise = kit.fetch('/data/v1/sales');
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(3000);
    expect((await promise).status).toBe(200);
  });
  test('reset cancels pending writes', async () => {
    kit.setScenario('network:slow', { delayMs: 100 });
    const pending = send(root, 'POST', { content: { n: 5 } });
    await vi.waitFor(() => expect(kit.requests()).toHaveLength(1));
    kit.reset();
    expect((await pending).status).toBe(499);
    expect(kit.appdb.list('TodoList')).toHaveLength(1);
  });
  test('invalid scenario names and options are rejected', () => {
    expect(() => kit.setScenario('unknown' as ScenarioName)).toThrow();
    expect(() => kit.setScenario('http:error', { status: 200 })).toThrow();
  });
});

describe('offline enforcement and lifecycle', () => {
  test('nested global installations restore in reverse order; restorers are idempotent', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'domo');
    const restore = kit.installDomoGlobal();
    kit.installDomoGlobal({ overwrite: true });
    await kit.stop();
    restore();
    expect(Object.getOwnPropertyDescriptor(globalThis, 'domo')).toEqual(
      original,
    );
  });
  test('abort interrupts a timeout scenario and prevents mutation', async () => {
    kit.setScenario('dataset:timeout', { delayMs: 30_000 });
    const controller = new AbortController();
    const request = kit.fetch('/data/v1/sales', { signal: controller.signal });
    const settled = request.catch(() => null);
    await vi.waitFor(() => expect(kit.requests()).toHaveLength(1));
    controller.abort();
    await settled;
    expect(kit.datasets.get('sales')).toHaveLength(3);
  });
  test('AppDB list observes the documented 10,000-document ceiling', async () => {
    kit.seed({
      appdb: {
        TodoList: Array.from({ length: 10_001 }, (_, n) => ({
          id: `doc-${n}`,
          content: {},
        })),
      },
    });
    expect(await client().get(`${root}?limit=10001`)).toHaveLength(10_000);
    expect(await client().get(`${root}?offset=10000`)).toEqual([
      { id: 'doc-10000', content: {} },
    ]);
  });
  test.each([
    '/domo/datastores/v3/collections/x/documents',
    '/sql/v1/sales',
    '/api/datastores/v2/x',
    '/domo/codeengine/v2/x',
    '/data/v1/sales/extra',
  ])('blocks unknown Domo path %s', async (path) => {
    expect((await kit.fetch(path)).status).toBe(501);
    expect(() => kit.assertNoUnhandledRequests()).toThrow(
      'Offline request blocked',
    );
    expect(kit.summary().unhandled).toBe(1);
  });
  test.each(['PATCH', 'HEAD', 'POST'])(
    'blocks wrong dataset method %s',
    async (method) => {
      expect((await send('/data/v1/sales', method)).status).toBe(501);
    },
  );
  test.each([
    ['/bulk', 'POST'],
    ['/query', 'GET'],
    ['/update', 'POST'],
    ['/todo-1', 'PATCH'],
    ['', 'PUT'],
  ])('blocks unsupported AppDB method %s %s', async (suffix, method) => {
    expect((await send(root + suffix, method!)).status).toBe(501);
  });
  test('blocks all external HTTP by default', async () => {
    const response = await fetch('https://example.invalid/anything');
    expect(response.status).toBe(501);
    expect(() => kit.assertNoUnhandledRequests()).toThrow();
    kit.reset();
    expect(() => kit.assertNoUnhandledRequests()).not.toThrow();
  });
  test('idempotent lifecycle and another active kit rejected', async () => {
    await kit.start();
    const other = createDomoTestKit();
    await expect(other.start()).rejects.toThrow('Another');
    await other.stop();
    await kit.stop();
    await kit.stop();
    await expect(kit.fetch('/data/v1/sales')).rejects.toThrow('Start');
    await other.start();
    await other.stop();
    await kit.start();
  });
  test('global shim requires explicit overwrite and restores descriptors', async () => {
    const old = Object.getOwnPropertyDescriptor(globalThis, 'domo');
    Object.defineProperty(globalThis, 'domo', {
      value: 'previous',
      writable: false,
      configurable: true,
      enumerable: false,
    });
    expect(() => kit.installDomoGlobal()).toThrow('already exists');
    kit.installDomoGlobal({ overwrite: true });
    expect(
      (globalThis as typeof globalThis & { domo: unknown }).domo,
    ).toHaveProperty('get');
    await kit.stop();
    expect(Object.getOwnPropertyDescriptor(globalThis, 'domo')).toEqual({
      value: 'previous',
      writable: false,
      configurable: true,
      enumerable: false,
    });
    if (old) Object.defineProperty(globalThis, 'domo', old);
    else Reflect.deleteProperty(globalThis, 'domo');
    const restore = kit.installDomoGlobal();
    restore();
    expect(Object.getOwnPropertyDescriptor(globalThis, 'domo')).toEqual(old);
  });
  test('Domo adapter rejects HTTP failures and returns undefined for delete', async () => {
    await expect(client().get('/data/v1/missing')).rejects.toBeInstanceOf(
      TestKitError,
    );
    expect(await client().delete(`${root}/todo-1`)).toBeUndefined();
  });
  test('history copies, header and body redaction', async () => {
    await kit.fetch(root, {
      method: 'POST',
      body: JSON.stringify({
        content: {
          token: 'abc',
          note: 'private-value',
          nested: { password: 'hide' },
        },
      }),
      headers: {
        authorization: 'Bearer hidden',
        cookie: 'hidden',
        'x-custom': 'hidden',
        accept: 'application/json',
      },
    });
    const text = JSON.stringify(kit.requests());
    expect(text).not.toContain('hidden');
    expect(text).not.toContain('private-value');
    expect(text).not.toContain('"abc"');
    expect(kit.requests()[0]?.body).toEqual({
      content: {
        token: '[REDACTED]',
        note: '[REDACTED]',
        nested: { password: '[REDACTED]' },
      },
    });
    kit.requests().length = 0;
    expect(kit.requests()).toHaveLength(1);
  });
  test('sensitive URL values and configured secrets do not appear in diagnostics', async () => {
    await kit.fetch(
      '/unknown/private-value?token=hide&sessionId=hide&other=private-value',
    );
    expect(JSON.stringify(kit.requests())).not.toMatch(/hide|private-value/);
    expect(() => kit.assertNoUnhandledRequests()).toThrow('[REDACTED]');
  });
});
