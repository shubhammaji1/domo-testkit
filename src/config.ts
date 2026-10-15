import { z } from 'zod';
import { jsonClone, TestKitError } from './security.js';
import type {
  CollectionDefinition,
  DatasetMapping,
  Manifest,
  TestKitConfig,
} from './types.js';

const name = z
  .string()
  .min(1)
  .max(256)
  .refine(
    (v) =>
      ![
        '__proto__',
        'constructor',
        'prototype',
        'bulk',
        'query',
        'update',
      ].includes(v) && !/[\\/\u0000]/.test(v),
    'Unsafe or reserved name',
  );
export const rowSchema = z.record(z.string(), z.json());
export const fixturesSchema = z
  .object({
    datasets: z.record(name, z.array(rowSchema)).optional(),
    appdb: z
      .record(
        name,
        z.array(
          z
            .object({
              id: name,
              content: rowSchema,
              owner: z.string().regex(/^\d+$/).optional(),
              createdBy: z.string().regex(/^\d+$/).optional(),
              updatedBy: z.string().regex(/^\d+$/).optional(),
              createdOn: z.iso.datetime().optional(),
              updatedOn: z.iso.datetime().optional(),
              datastoreId: z.string().optional(),
              collectionId: z.string().optional(),
              syncRequired: z.boolean().optional(),
            })
            .strict(),
        ),
      )
      .optional(),
  })
  .strict();
const field = z.object({ alias: name, columnName: name }).strict();
const mapping = z
  .object({ alias: name, dataSetId: name, fields: z.array(field) })
  .strict();
const collection = z
  .object({
    name,
    syncEnabled: z.boolean().optional(),
    schema: z
      .object({
        columns: z.array(
          z.object({
            name,
            type: z.enum([
              'STRING',
              'LONG',
              'DECIMAL',
              'DOUBLE',
              'DATE',
              'DATETIME',
            ]),
          }),
        ),
      })
      .optional(),
  })
  .passthrough();
const manifestSchema = z
  .object({
    datasetsMapping: z.array(mapping).optional(),
    mapping: z.array(mapping).optional(),
    collections: z.array(collection).optional(),
    collectionsMapping: z.array(collection).optional(),
  })
  .passthrough();
const validator = z.custom<{ parse(input: unknown): unknown }>(
  (v) => !!v && typeof (v as { parse?: unknown }).parse === 'function',
);
const configSchema = z
  .object({
    datasets: fixturesSchema.shape.datasets,
    appdb: fixturesSchema.shape.appdb,
    baseUrl: z.url().default('https://domo.test'),
    appdbVersions: z
      .array(z.enum(['v1', 'v2']))
      .min(1)
      .default(['v2']),
    manifest: manifestSchema.optional(),
    manifestAdapter: z
      .enum(['modern', 'legacy-mapping', 'collections-mapping'])
      .default('modern'),
    datasetSchemas: z.record(name, validator).default({}),
    collectionSchemas: z.record(name, validator).default({}),
    clock: z
      .custom<() => Date>((v) => typeof v === 'function')
      .default(() => () => new Date('2026-01-01T00:00:00.000Z')),
    idFactory: z
      .custom<(sequence: number) => string>((v) => typeof v === 'function')
      .default(
        () => (n: number) =>
          `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
      ),
    userId: z.string().regex(/^\d+$/).default('1'),
    allowOrigins: z.array(z.url()).default([]),
    secrets: z.array(z.string().min(1)).default([]),
    captureBodies: z.boolean().default(false),
    maxFixtureBytes: z
      .number()
      .int()
      .min(1)
      .max(100_000_000)
      .default(8_000_000),
    maxRequestBytes: z.number().int().min(1).max(2_000_000).default(2_000_000),
    maxHistory: z.number().int().min(1).max(100_000).default(1000),
  })
  .strict();
export function normalizeManifest(
  manifest: Manifest = {},
  adapter: TestKitConfig['manifestAdapter'] = 'modern',
): { datasets: DatasetMapping[]; collections: CollectionDefinition[] } {
  jsonClone(manifest);
  const parsed = manifestSchema.parse(manifest);
  if (parsed.mapping && adapter !== 'legacy-mapping')
    throw new TestKitError(
      'Legacy mapping requires manifestAdapter: legacy-mapping',
    );
  if (parsed.collectionsMapping && adapter !== 'collections-mapping')
    throw new TestKitError(
      'collectionsMapping requires manifestAdapter: collections-mapping',
    );
  if (
    (parsed.mapping && parsed.datasetsMapping) ||
    (parsed.collections && parsed.collectionsMapping)
  )
    throw new TestKitError('Ambiguous manifest mapping definitions');
  const datasets = parsed.datasetsMapping ?? parsed.mapping ?? [];
  const collections = parsed.collections ?? parsed.collectionsMapping ?? [];
  if (
    new Set(datasets.map((d) => d.alias)).size !== datasets.length ||
    new Set(collections.map((c) => c.name)).size !== collections.length
  )
    throw new TestKitError('Duplicate manifest alias or collection');
  for (const dataset of datasets)
    if (
      new Set(dataset.fields.map((f) => f.alias)).size !== dataset.fields.length
    )
      throw new TestKitError('Duplicate field alias');
  return { datasets, collections };
}
export function validateConfig(input: TestKitConfig = {}) {
  // Bound untrusted JSON before passing it to recursive schema validation.
  jsonClone(
    {
      datasets: input.datasets ?? {},
      appdb: input.appdb ?? {},
      manifest: input.manifest ?? {},
    },
    input.maxFixtureBytes ?? 8_000_000,
  );
  const config = configSchema.parse(input);
  for (const raw of [config.baseUrl, ...config.allowOrigins]) {
    const url = new URL(raw);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      throw new TestKitError(
        'URLs must be HTTP(S) origins without credentials, paths, or queries',
      );
  }
  if (
    config.appdbVersions.includes('v1') &&
    !Number.isSafeInteger(Number(config.userId))
  )
    throw new TestKitError('v1 requires a safely representable numeric userId');
  return {
    ...config,
    baseUrl: new URL(config.baseUrl).origin,
    allowOrigins: config.allowOrigins.map((v) => new URL(v).origin),
    mappings: normalizeManifest(config.manifest, config.manifestAdapter),
  };
}
