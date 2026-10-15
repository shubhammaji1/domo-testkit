import { expect, test } from 'vitest';
import { useDomoTestKit } from '../../src/vitest.js';
const kit = useDomoTestKit({
  datasets: { sales: [{ 'Revenue USD': 100 }] },
  manifest: {
    datasetsMapping: [
      {
        alias: 'sales',
        dataSetId: 'fixture-source',
        fields: [{ alias: 'revenue', columnName: 'Revenue USD' }],
      },
    ],
  },
});
test('dashboard uses exposed column aliases', async () => {
  expect(await kit.createDomoClient().get('/data/v1/sales')).toEqual([
    { revenue: 100 },
  ]);
});
