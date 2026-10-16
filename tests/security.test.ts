import { createServer } from 'node:http';
import { afterEach, expect, test } from 'vitest';
import { z } from 'zod';
import {
  createDomoTestKit,
  normalizeManifest,
  validateConfig,
} from '../src/index.js';
import type { DomoTestKit, Row, TestKitConfig } from '../src/index.js';
import { jsonClone, redact, safePath, sanitizedUrl } from '../src/security.js';
import { serializeV1, serializeV2 } from '../src/contracts.js';

let active: DomoTestKit | undefined;
afterEach(async () => {
  await active?.stop();
  active = undefined;
});
test.each([
  JSON.parse('{"__proto__":{"polluted":true}}'),
  JSON.parse('{"constructor":{}}'),
  { n: NaN },
  { n: Infinity },
  { n: undefined },
  { n: () => 1 },
  new Date(),
  new Map(),
  Object.create({ x: 1 }),
])('rejects non-JSON and pollution fixtures %#', (input) => {
  expect(() => jsonClone(input)).toThrow();
  expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
});
// This stress case enumerates 500,001 entries; allow CPU contention on CI workers.
test('rejects cycles, accessors, depth, node and byte exhaustion without execution', () => {
  const cycle: Record<string, unknown> = {};
  cycle.x = cycle;
  expect(() => jsonClone(cycle)).toThrow('Cyclic');
  let executed = false;
  const getter = Object.defineProperty({}, 'x', {
    enumerable: true,
    get() {
      executed = true;
      return 1;
    },
  });
  expect(() => jsonClone(getter)).toThrow('Unsafe');
  expect(executed).toBe(false);
  let nested: unknown = {};
  for (let i = 0; i < 40; i++) nested = { nested };
  expect(() => jsonClone(nested)).toThrow('complexity');
  expect(() =>
    jsonClone(
      Array.from({ length: 500_001 }, () => null),
      100_000_000,
    ),
  ).toThrow('complexity');
  expect(() => jsonClone({ x: 'long text' }, 2)).toThrow('size');
  expect(() => jsonClone({ aaaaaaaa: 1 }, 2)).toThrow('size');
}, 15_000);
test('safe path rejects excessive, empty and unsafe segments', () => {
  for (const path of [
    '',
    'a..b',
    'a.prototype.b',
    Array(34).fill('a').join('.'),
  ])
    expect(() => safePath(path)).toThrow();
});
test('nested redaction and URL credentials, query secrets, fragments', () => {
  expect(
    redact(
      [
        {
          session: 'abc',
          n: null,
          ok: true,
          value: 1,
          note: 'contains private value',
        },
      ],
      ['private value'],
    ),
  ).toEqual([
    {
      session: '[REDACTED]',
      n: null,
      ok: true,
      value: 1,
      note: 'contains [REDACTED]',
    },
  ]);
  const url = sanitizedUrl(
    'https://user:password@example.invalid/private%20value?api_key=hide&note=private+value#token',
    ['private value'],
  );
  expect(url).not.toMatch(/user|password|hide|private|#token/);
});
test.each([
  { baseUrl: 'ftp://example.com' },
  { baseUrl: 'https://x/with-path' },
  { baseUrl: 'https://u:p@x' },
  { allowOrigins: ['https://x/?token=x'] },
  { appdbVersions: ['v3'] },
  { appdbVersions: ['v1'], userId: '9007199254740993' },
  { maxFixtureBytes: -1 },
  { maxRequestBytes: 4_000_000 },
  { unexpected: true },
])('invalid configuration %#', (config) => {
  expect(() => validateConfig(config as TestKitConfig)).toThrow();
});
test('current and explicit alternate manifest mappings', () => {
  const mapping = {
    alias: 'sales',
    dataSetId: 'source-id',
    fields: [{ alias: 'amount', columnName: 'Sales Amount' }],
  };
  const collection = { name: 'Notes' };
  expect(
    normalizeManifest({
      datasetsMapping: [mapping],
      collections: [collection],
    }),
  ).toEqual({ datasets: [mapping], collections: [collection] });
  expect(
    normalizeManifest({ mapping: [mapping] }, 'legacy-mapping').datasets,
  ).toEqual([mapping]);
  expect(
    normalizeManifest(
      { collectionsMapping: [collection] },
      'collections-mapping',
    ).collections,
  ).toEqual([collection]);
  expect(() => normalizeManifest({ mapping: [] })).toThrow('Legacy');
  expect(() => normalizeManifest({ collectionsMapping: [] })).toThrow(
    'collectionsMapping',
  );
  expect(() =>
    normalizeManifest({ mapping: [], datasetsMapping: [] }, 'legacy-mapping'),
  ).toThrow('Ambiguous');
  expect(() =>
    normalizeManifest(
      { collections: [], collectionsMapping: [] },
      'collections-mapping',
    ),
  ).toThrow('Ambiguous');
  expect(() =>
    normalizeManifest({ datasetsMapping: [mapping, mapping] }),
  ).toThrow('Duplicate');
  expect(() =>
    normalizeManifest({ collections: [collection, collection] }),
  ).toThrow('Duplicate');
  expect(() =>
    normalizeManifest({
      datasetsMapping: [
        { ...mapping, fields: [mapping.fields[0]!, mapping.fields[0]!] },
      ],
    }),
  ).toThrow('Duplicate');
});
test('field aliases select source columns; empty fields preserve originals', () => {
  const kit = createDomoTestKit({
    datasets: {
      mapped: [{ 'Sales Amount': 100, unwanted: true }, {}],
      raw: [{ 'Raw Name': null }],
    },
    manifest: {
      datasetsMapping: [
        {
          alias: 'mapped',
          dataSetId: 'id',
          fields: [{ alias: 'amount', columnName: 'Sales Amount' }],
        },
        { alias: 'raw', dataSetId: 'id2', fields: [] },
      ],
      collections: [{ name: 'Notes' }],
    },
  });
  expect(kit.datasets.get('mapped')).toEqual([{ amount: 100 }, {}]);
  expect(kit.datasets.get('raw')).toEqual([{ 'Raw Name': null }]);
  expect(kit.appdb.list('Notes')).toEqual([]);
});
test('manifest declares empty datasets and optional schemas', () => {
  const kit = createDomoTestKit({
    manifest: {
      datasetsMapping: [{ alias: 'empty', dataSetId: 'id', fields: [] }],
    },
  });
  expect(kit.datasets.get('empty')).toEqual([]);
});
test('Zod row and collection validation applies to initial, seed and overrides', async () => {
  const config = {
    datasets: { sales: [{ amount: 10 }] },
    appdb: { Notes: [] },
    datasetSchemas: { sales: z.object({ amount: z.number() }) },
    collectionSchemas: { Notes: z.object({ text: z.string() }) },
  };
  active = createDomoTestKit(config);
  await active.start();
  expect(() => active!.datasets.set('sales', [{ amount: null }])).toThrow();
  expect(active.datasets.get('sales')).toEqual([{ amount: 10 }]);
  expect(() =>
    active!.seed({ appdb: { Notes: [{ id: 'x', content: { text: 1 } }] } }),
  ).toThrow();
  const response = await active.fetch(
    '/domo/datastores/v2/collections/Notes/documents',
    { method: 'POST', body: JSON.stringify({ content: { text: 'ok' } }) },
  );
  expect(response.status).toBe(200);
});
test('manifest metadata schemas validate provided types but allow null/missing', async () => {
  active = createDomoTestKit({
    manifest: {
      collections: [
        {
          name: 'Types',
          syncEnabled: true,
          schema: {
            columns: [
              { name: 's', type: 'STRING' },
              { name: 'l', type: 'LONG' },
              { name: 'd', type: 'DOUBLE' },
              { name: 'date', type: 'DATE' },
            ],
          },
        },
      ],
    },
    clock: () => new Date('2025-12-31T00:00:00Z'),
    idFactory: (n) => `doc-${n}`,
  });
  await active.start();
  const url = '/domo/datastores/v2/collections/Types/documents';
  const client = active.createDomoClient();
  expect(
    await client.post(url, {
      content: { s: 'ok', l: 1, d: 1.25, date: '2026-01-01' },
    }),
  ).toMatchObject({
    id: 'doc-1',
    syncRequired: true,
    createdOn: '2025-12-31T00:00:00.000Z',
  });
  expect(await client.post(url, { content: { s: null } })).toMatchObject({
    id: 'doc-2',
  });
  for (const content of [
    { s: 1 },
    { l: 1.2 },
    { d: 'no' },
    { date: 'invalid' },
  ] as Row[])
    await expect(client.post(url, { content })).rejects.toThrow('400');
});
test('v1 identity output refuses lossy integers and v2 preserves string identities', () => {
  expect(() =>
    serializeV1({ id: 'x', content: {}, owner: '9007199254740993' }),
  ).toThrow('safe');
  expect(serializeV1({ id: 'x', content: {} })).toEqual({
    id: 'x',
    content: {},
  });
  expect(
    serializeV2({ id: 'x', content: {}, owner: '9007199254740993' }).owner,
  ).toBe('9007199254740993');
});
test('payload caps reject requests and state growth before mutation', async () => {
  active = createDomoTestKit({
    appdb: { Notes: [] },
    maxRequestBytes: 40,
    maxFixtureBytes: 200,
    maxHistory: 2,
  });
  await active.start();
  const root = '/domo/datastores/v2/collections/Notes/documents';
  expect(
    (
      await active.fetch(root, {
        method: 'POST',
        body: JSON.stringify({ content: { text: 'a'.repeat(100) } }),
      })
    ).status,
  ).toBe(413);
  expect(
    (await active.fetch(root, { method: 'POST', body: '{"content":{}}' }))
      .status,
  ).toBe(413);
  expect(active.appdb.list('Notes')).toEqual([]);
  expect(() =>
    active!.datasets.set('large', [{ text: 'a'.repeat(300) }]),
  ).toThrow('size');
  await active.fetch('/data/v1/missing');
  expect(active.requests()).toHaveLength(2);
});
test('unsafe request payloads cannot pollute prototypes', async () => {
  active = createDomoTestKit({ appdb: { Notes: [] } });
  await active.start();
  expect(
    (
      await active.fetch('/domo/datastores/v2/collections/Notes/documents', {
        method: 'POST',
        body: '{"content":{"__proto__":{"polluted":true}}}',
      })
    ).status,
  ).toBe(400);
  expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
});
test('allowlist permits only unrelated origins; no recognized Domo bypass', async () => {
  let calls = 0;
  const server = createServer((_req, res) => {
    calls++;
    res.end('allowed-local');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No address');
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    active = createDomoTestKit({
      allowOrigins: [origin, 'https://company.domo.com'],
    });
    await active.start();
    expect(await (await fetch(origin + '/static')).text()).toBe(
      'allowed-local',
    );
    expect(calls).toBe(1);
    expect((await fetch(origin + '/api/unimplemented')).status).toBe(501);
    expect(calls).toBe(1);
    expect((await fetch('https://company.domo.com/unknown')).status).toBe(501);
    expect(active.requests()[0]?.outcome).toBe('allowed');
  } finally {
    await active?.stop();
    await new Promise<void>((r, reject) =>
      server.close((error) => (error ? reject(error) : r())),
    );
  }
});
test('v1 is opt-in and history bodies are absent by default', async () => {
  active = createDomoTestKit({ appdb: { Notes: [] } });
  await active.start();
  expect(
    (await active.fetch('/domo/datastores/v1/collections/Notes/documents'))
      .status,
  ).toBe(501);
  await active
    .createDomoClient()
    .post('/domo/datastores/v2/collections/Notes/documents', {
      content: { token: 'hidden' },
    });
  expect(active.requests()[1]).not.toHaveProperty('body');
});
