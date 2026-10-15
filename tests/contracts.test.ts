import { expect, test } from 'vitest';
import cases from './fixtures/appdb-contracts.json';
import { createDomoTestKit, contracts } from '../src/index.js';
for (const version of ['v1', 'v2'] as const) {
  test.each(cases.cases)(
    `${version} reference: $method $suffix -> $status $shape`,
    async (reference) => {
      const kit = createDomoTestKit({
        appdbVersions: [version],
        appdb: { Students: [{ id: 'known', content: { name: 'Initial' } }] },
      });
      await kit.start();
      try {
        const response = await kit.fetch(
          `/domo/datastores/${version}/collections/Students/documents${reference.suffix}`,
          {
            method: reference.method,
            ...(reference.body === undefined
              ? {}
              : { body: JSON.stringify(reference.body) }),
          },
        );
        expect(response.status).toBe(reference.status);
        if (reference.shape === 'empty') expect(await response.text()).toBe('');
        else {
          const body = await response.json();
          if (reference.shape === 'array')
            expect(Array.isArray(body)).toBe(true);
          if (reference.shape === 'document') {
            expect(body).toHaveProperty('id');
            expect(body).toHaveProperty('content.name');
          }
          if (reference.shape === 'count') expect(body).toBe(1);
          if (reference.shape === 'error')
            expect(body).toMatchObject({ status: 404 });
        }
        kit.assertNoUnhandledRequests();
      } finally {
        await kit.stop();
      }
    },
  );
}
test('contract registry identifies every implemented method and independent source', () => {
  expect(contracts).toHaveLength(14);
  expect(new Set(contracts.map((c) => c.source))).toEqual(
    new Set([cases.source]),
  );
  expect(contracts.every((c) => Object.isFrozen(c))).toBe(true);
});
