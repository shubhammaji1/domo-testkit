import type { ApiVersion, Document } from './types.js';
const source = 'https://www.domo.com/docs/openapi/framework/appdb.yaml';
export const contracts = Object.freeze(
  (['v1', 'v2'] as const).flatMap((version) =>
    [
      { version, method: 'GET', suffix: '', response: 'Document[]' },
      { version, method: 'POST', suffix: '', response: 'Document' },
      { version, method: 'GET', suffix: '/{documentId}', response: 'Document' },
      { version, method: 'PUT', suffix: '/{documentId}', response: 'Document' },
      {
        version,
        method: 'DELETE',
        suffix: '/{documentId}',
        response: 'empty body',
      },
      { version, method: 'POST', suffix: '/query', response: 'Document[]' },
      { version, method: 'PUT', suffix: '/update', response: 'number' },
    ].map((c) =>
      Object.freeze({
        ...c,
        path: `/domo/datastores/${version}/collections/{name}/documents${c.suffix}`,
        status: 200,
        source,
      }),
    ),
  ),
);
// Separate output adapters: v1 identity metadata must not inherit v2 string types.
export function serializeV1(doc: Document) {
  const result: Record<string, unknown> = { ...doc };
  for (const key of ['owner', 'createdBy', 'updatedBy'] as const)
    if (doc[key] !== undefined) {
      const n = Number(doc[key]);
      if (!Number.isSafeInteger(n))
        throw new Error('v1 identity metadata must be safe integers');
      result[key] = n;
    }
  return result;
}
export function serializeV2(doc: Document) {
  return { ...doc };
}
export function serializeDocument(doc: Document, version: ApiVersion) {
  return version === 'v1' ? serializeV1(doc) : serializeV2(doc);
}
